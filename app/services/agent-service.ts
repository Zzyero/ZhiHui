import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { buildSkills, type IWorkflowSkill } from "@/app/helpers/skill-builder";
import { agentSettingsService, type IAgentSettings } from "@/app/services/agent-settings-service";
import { getComfyUIAPIService, getMimeType } from "@/app/services/comfyui-api-service";
import { ComfyWorkflow } from "@/app/models/comfy-workflow";
import { generationQueue } from "@/app/services/generation-queue";
import { statsService } from "@/app/services/stats-service";
import type { IInput } from "@/app/interfaces/input";

export interface IAgentAttachment {
    name: string;
    originalName: string;
    type: string;
}

export interface IAgentImage {
    name: string;
    workflowTitle?: string;
    workflowId?: string;
}

export interface IAgentMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    attachments?: IAgentAttachment[];
    images?: IAgentImage[];
    createdAt: number;
}

export interface IAgentSession {
    id: string;
    title: string;
    messages: IAgentMessage[];
    currentImage?: string;
    createdAt: number;
    updatedAt: number;
}

export interface IAgentSessionSummary {
    id: string;
    title: string;
    updatedAt: number;
}

const DEFAULT_DATA_DIR = path.join(process.cwd(), "data");
const dataDir = () => process.env.DATA_DIR || DEFAULT_DATA_DIR;
const sessionsDir = () => path.join(dataDir(), "agent-sessions");
const uploadsDir = () => path.join(dataDir(), "agent-uploads");
const outputsDir = () => path.join(dataDir(), "agent-outputs");

const SYSTEM_PROMPT = [
    "你是一个生成式 AI 助手，可以通过调用工具（每个工具对应一个 ComfyUI 工作流）来生成图片、视频或音频。",
    "根据用户的需求，从可用工具中选择最合适的工作流并填写参数。",
    "如果用户要求「修改/编辑/替换」上一张图片中的内容（例如「把这张图里的猫换成狗」），请选择能接收图片输入并输出图片的工作流，系统会自动把上一张图片作为输入传入。",
    "如果用户上传了图片/视频/音频，系统会自动把它们作为对应工作流的输入。",
    "回复要简洁自然。",
].join(" ");

function parseToolArguments(raw: string): Record<string, unknown> {
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

function getFileInputKeys(view: Record<string, any>): { image: string[]; video: string[]; audio: string[]; mask: string[] } {
    const result = { image: [] as string[], video: [] as string[], audio: [] as string[], mask: [] as string[] };
    const groups = [...(view.inputs || []), ...(view.advancedInputs || [])];
    for (const group of groups) {
        for (const field of group.inputs || []) {
            if (field.visibility === "deleted") continue;
            if (field.valueType === "image") result.image.push(field.key);
            else if (field.valueType === "video") result.video.push(field.key);
            else if (field.valueType === "audio") result.audio.push(field.key);
            else if (field.valueType === "image-mask") result.mask.push(field.key);
        }
    }
    return result;
}

const GENERATION_KEYWORDS = ["生成", "画", "图", "图片", "图像", "视频", "音频", "制作", "创建", "create", "generate", "draw", "image", "picture", "video", "audio", "make"];

function looksLikeGenerationRequest(text: string): boolean {
    const t = text.toLowerCase();
    return GENERATION_KEYWORDS.some((k) => t.includes(k.toLowerCase()));
}

function findLongTextKey(view: Record<string, any>): string | undefined {
    const groups = [...(view.inputs || []), ...(view.advancedInputs || [])];
    for (const group of groups) {
        for (const field of group.inputs || []) {
            if (field.visibility === "deleted") continue;
            if (field.valueType === "long-text") return field.key;
        }
    }
    return undefined;
}

interface ILlmResponse {
    content: string;
    toolCalls: { id: string; function: { name: string; arguments: string } }[];
}

async function callLlm(settings: IAgentSettings, messages: unknown[], tools: unknown[]): Promise<ILlmResponse> {
    let base = settings.baseUrl || "http://localhost:11434/v1";
    while (base.endsWith("/")) base = base.slice(0, -1);
    const res = await fetch(base + "/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(settings.apiKey ? { Authorization: "Bearer " + settings.apiKey } : {}),
        },
        body: JSON.stringify({
            model: settings.model,
            messages,
            tools,
            tool_choice: "auto",
        }),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error("模型调用失败：" + res.status + " " + text.slice(0, 200));
    }
    const data = await res.json();
    const msg = data?.choices?.[0]?.message;
    return {
        content: msg?.content || "",
        toolCalls: msg?.tool_calls || [],
    };
}

class AgentService {
    private cache = new Map<string, IAgentSession>();

    private async load(id: string): Promise<IAgentSession | undefined> {
        if (this.cache.has(id)) return this.cache.get(id);
        try {
            const raw = await fs.readFile(path.join(sessionsDir(), id + ".json"), "utf8");
            const session = JSON.parse(raw) as IAgentSession;
            this.cache.set(id, session);
            return session;
        } catch {
            return undefined;
        }
    }

    private async persist(session: IAgentSession): Promise<void> {
        this.cache.set(session.id, session);
        await fs.mkdir(sessionsDir(), { recursive: true });
        await fs.writeFile(path.join(sessionsDir(), session.id + ".json"), JSON.stringify(session, null, 2), "utf8");
    }

    async listSessions(): Promise<IAgentSessionSummary[]> {
        const out: IAgentSessionSummary[] = [];
        try {
            const files = await fs.readdir(sessionsDir());
            for (const f of files) {
                if (!f.endsWith(".json")) continue;
                const session = await this.load(f.slice(0, -5));
                if (session) out.push({ id: session.id, title: session.title || "新会话", updatedAt: session.updatedAt });
            }
        } catch {
            // 目录不存在
        }
        return out.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    async getSession(id: string): Promise<IAgentSession | undefined> {
        return this.load(id);
    }

    async createSession(): Promise<IAgentSession> {
        const now = Date.now();
        const session: IAgentSession = { id: crypto.randomUUID(), title: "", messages: [], createdAt: now, updatedAt: now };
        await this.persist(session);
        return session;
    }

    async deleteSession(id: string): Promise<boolean> {
        this.cache.delete(id);
        try {
            await fs.unlink(path.join(sessionsDir(), id + ".json"));
            return true;
        } catch {
            return false;
        }
    }

    async renameSession(id: string, title: string): Promise<boolean> {
        const session = await this.load(id);
        if (!session) return false;
        session.title = title.trim() || "新会话";
        session.updatedAt = Date.now();
        await this.persist(session);
        return true;
    }

    /** 解析媒体文件的绝对路径（uploads / outputs），带路径安全处理 */
    async resolveFilePath(kind: "uploads" | "outputs", name: string): Promise<string | undefined> {
        const dir = kind === "uploads" ? uploadsDir() : outputsDir();
        const safeName = path.basename(name);
        const abs = path.join(dir, safeName);
        try {
            await fs.access(abs);
            return abs;
        } catch {
            return undefined;
        }
    }

    /** 读输出图片为 File（用于继续改图时作为工作流输入） */
    private async readOutputAsFile(name: string): Promise<File | undefined> {
        try {
            const buf = await fs.readFile(path.join(outputsDir(), name));
            return new File([buf], name, { type: getMimeType(name) });
        } catch {
            return undefined;
        }
    }

    /** 执行一个工作流，返回生成的图片文件名（保存到 outputs 目录） */
    private async executeWorkflow(skill: IWorkflowSkill, viewComfyInputs: IInput[]): Promise<string[]> {
        const startedAt = Date.now();
        const api = getComfyUIAPIService();
        const workflow = new ComfyWorkflow(skill.workflowApiJSON);
        await workflow.setViewComfy(viewComfyInputs, api);

        const files: File[] = [];
        let status: string | undefined;
        let execError: unknown;
        await generationQueue.enqueue(crypto.randomUUID(), async () => {
            try {
                await api.startQueuePrompt(workflow.getWorkflow());
                const result = await api.waitForCompletion();
                status = result.status;
                if (result.outputFiles.length === 0) return;
                for (const file of result.outputFiles) {
                    try {
                        files.push(await api.getOutputFiles({ file }));
                    } catch {
                        // 忽略单个文件失败
                    }
                }
            } catch (e) {
                execError = e;
            }
        });

        if (execError) throw execError;
        if (files.length === 0) {
            throw new Error(status === "execution_error" ? "工作流执行出错" : "工作流没有产生输出文件");
        }

        await fs.mkdir(outputsDir(), { recursive: true });
        const names: string[] = [];
        for (const file of files) {
            const ext = path.extname(file.name) || ".png";
            const name = crypto.randomUUID() + ext;
            await fs.writeFile(path.join(outputsDir(), name), Buffer.from(await file.arrayBuffer()));
            names.push(name);
        }

        // 记录使用统计（与生图区一致）
        statsService.recordGeneration({ imageCount: names.length, elapsedMs: Date.now() - startedAt })
            .catch((err) => console.error("Failed to record agent stats", err));

        return names;
    }

    /** 发送消息并得到助手回复 */
    async chat(
        sessionId: string,
        text: string,
        attachments: { file: File }[]
    ): Promise<IAgentMessage> {
        const session = await this.load(sessionId);
        if (!session) throw new Error("会话不存在");

        const settings = await agentSettingsService.getSettings();
        if (!settings.model) throw new Error("尚未配置模型，请在「管理 → 设置」中配置模型名");

        const { skills, tools } = await buildSkills();
        if (skills.length === 0) throw new Error("view_comfy.json 中没有可用工作流");

        // 1) 保存附件
        const savedAttachments: IAgentAttachment[] = [];
        if (attachments.length) {
            await fs.mkdir(uploadsDir(), { recursive: true });
            for (const a of attachments) {
                const name = crypto.randomUUID() + (path.extname(a.file.name) || "");
                await fs.writeFile(path.join(uploadsDir(), name), Buffer.from(await a.file.arrayBuffer()));
                savedAttachments.push({ name, originalName: a.file.name, type: a.file.type });
            }
        }

        // 2) 记录用户消息
        const userMessage: IAgentMessage = {
            id: crypto.randomUUID(),
            role: "user",
            content: text,
            attachments: savedAttachments.length ? savedAttachments : undefined,
            createdAt: Date.now(),
        };
        session.messages.push(userMessage);
        if (!session.title) session.title = text.slice(0, 30) || "新会话";
        session.updatedAt = Date.now();
        await this.persist(session);

        // 3) 组装 LLM 消息
        const llmMessages: unknown[] = [{ role: "system", content: SYSTEM_PROMPT }];
        for (const m of session.messages) {
            if (m.role === "user") {
                let content = m.content;
                if (m.attachments?.length) content += "\n[用户上传了 " + m.attachments.length + " 个媒体文件]";
                llmMessages.push({ role: "user", content });
            } else {
                let content = m.content || "";
                if (m.images?.length) content += "\n[已生成 " + m.images.length + " 张图片]";
                llmMessages.push({ role: "assistant", content });
            }
        }

        // 4) 调用 LLM
        const llm = await callLlm(settings, llmMessages, tools);
        console.log("[agent] llm content:", llm.content);
        console.log("[agent] llm toolCalls:", JSON.stringify(llm.toolCalls));

        // 5) 处理 tool_call
        let assistantContent = llm.content;
        let images: IAgentImage[] | undefined;
        const toolCall = llm.toolCalls?.[0];
        if (toolCall) {
            const skill = skills.find((s) => s.toolName === toolCall.function.name);
            if (!skill) {
                assistantContent = "抱歉，我无法找到合适的工作流。";
            } else {
                try {
                    const args = parseToolArguments(toolCall.function.arguments);
                    const viewComfyInputs: IInput[] = [];
                    for (const [key, value] of Object.entries(args)) {
                        // 忽略空值：模型加载等字段留空时沿用工作流默认值，避免被空串覆盖导致校验失败
                        if (value === undefined || value === null) continue;
                        if (typeof value === "string" && value.trim() === "") continue;
                        // seed=0 视为"随机"，跳过让工作流用默认随机种子
                        if (key.includes("seed") && typeof value === "number" && value === 0) continue;
                        viewComfyInputs.push({ key, value });
                    }

                    // 附件映射 + 上下文图片
                    const fileKeys = getFileInputKeys(skill.viewComfyJSON);
                    const imageAttachment = savedAttachments.find((a) => a.type.startsWith("image/"));
                    const videoAttachment = savedAttachments.find((a) => a.type.startsWith("video/"));
                    const audioAttachment = savedAttachments.find((a) => a.type.startsWith("audio/"));

                    let imageFile: File | undefined;
                    if (imageAttachment) {
                        imageFile = await this.readUploadAsFile(imageAttachment.name);
                    } else if (session.currentImage) {
                        imageFile = await this.readOutputAsFile(session.currentImage);
                    }
                    if (imageFile && fileKeys.image.length) {
                        viewComfyInputs.push({ key: fileKeys.image[0], value: imageFile });
                    }

                    if (videoAttachment && fileKeys.video.length) {
                        viewComfyInputs.push({ key: fileKeys.video[0], value: await this.readUploadAsFile(videoAttachment.name) });
                    }
                    if (audioAttachment && fileKeys.audio.length) {
                        viewComfyInputs.push({ key: fileKeys.audio[0], value: await this.readUploadAsFile(audioAttachment.name) });
                    }

                    const generated = await this.executeWorkflow(skill, viewComfyInputs);
                    images = generated.map((name) => ({ name, workflowTitle: skill.title, workflowId: skill.workflowId }));
                    if (images.length) session.currentImage = images[0].name;
                    assistantContent = assistantContent || "已根据你的要求生成。";
                } catch (error) {
                    assistantContent = "生成失败：" + (error instanceof Error ? error.message : String(error));
                }
            }
        } else {
            // 模型未返回 tool_call（可能不支持函数调用）：若用户明显要生成，兜底用第一个文生图工作流
            const t2iSkill = skills.find((s) => findLongTextKey(s.viewComfyJSON));
            if (t2iSkill && looksLikeGenerationRequest(text)) {
                const promptKey = findLongTextKey(t2iSkill.viewComfyJSON);
                if (promptKey) {
                    try {
                        const viewComfyInputs: IInput[] = [{ key: promptKey, value: text }];
                        const generated = await this.executeWorkflow(t2iSkill, viewComfyInputs);
                        images = generated.map((name) => ({ name, workflowTitle: t2iSkill.title, workflowId: t2iSkill.workflowId }));
                        if (images.length) session.currentImage = images[0].name;
                        assistantContent = assistantContent || "已根据你的要求生成。";
                    } catch (error) {
                        assistantContent = "生成失败：" + (error instanceof Error ? error.message : String(error));
                    }
                }
            }
            if (!assistantContent) assistantContent = "我收到了你的消息。";
        }

        // 6) 记录助手消息
        const assistantMessage: IAgentMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: assistantContent,
            images,
            createdAt: Date.now(),
        };
        session.messages.push(assistantMessage);
        session.updatedAt = Date.now();
        await this.persist(session);

        return assistantMessage;
    }

    private async readUploadAsFile(name: string): Promise<File> {
        const buf = await fs.readFile(path.join(uploadsDir(), name));
        return new File([buf], name, { type: getMimeType(name) });
    }
}

export const agentService = new AgentService();
