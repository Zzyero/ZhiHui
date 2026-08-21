import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { buildSkills, type IWorkflowSkill } from "@/app/helpers/skill-builder";
import { listSkills, readSkill } from "@/app/helpers/skill-registry";
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

export type IAgentOutputType = "image" | "video" | "audio";

export interface IAgentOutput {
    name: string;
    type: IAgentOutputType;
    workflowTitle?: string;
    workflowId?: string;
}

export interface IAgentMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    attachments?: IAgentAttachment[];
    outputs?: IAgentOutput[];
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

export interface IAgentProgressEvent {
    type: "status" | "done" | "error" | "queue";
    phase?: "thinking" | "reading-skill" | "generating";
    skill?: string;
    workflowTitle?: string;
    message?: IAgentMessage;
    error?: string;
    promptId?: string;
    realPromptId?: string;
    sectionName?: string;
    queueStatus?: "queued" | "running" | "completed" | "error";
}

const DEFAULT_DATA_DIR = path.join(process.cwd(), "data");
const dataDir = () => process.env.DATA_DIR || DEFAULT_DATA_DIR;
const sessionsDir = () => path.join(dataDir(), "agent-sessions");
const uploadsDir = () => path.join(dataDir(), "agent-uploads");
const outputsDir = () => path.join(dataDir(), "agent-outputs");

const SYSTEM_PROMPT = [
    "你是一个生成式 AI 助手，可以调用工具来生成图片、视频或音频。每个工作流对应一个函数工具。",
    "工作流程：① 先根据用户需求选择合适的工作流；② 若该工作流的描述里标注了对应的提示词技能（skill），先调用 read_skill 阅读该技能；③ 依据技能规范编写/优化提示词；④ 调用工作流工具生成。",
    "如果用户要求「修改/编辑/替换」上一张图片中的内容，请选择能接收图片输入并输出图片的工作流，系统会自动把上一张图片作为输入传入。",
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

function outputTypeFromMime(mime: string): IAgentOutputType {
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    return "image";
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
    toolCalls: { id: string; type?: string; function: { name: string; arguments: string } }[];
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
            ...(typeof settings.temperature === "number" ? { temperature: settings.temperature } : {}),
            ...(typeof settings.maxTokens === "number" ? { max_tokens: settings.maxTokens } : {}),
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

    private async readOutputAsFile(name: string): Promise<File | undefined> {
        try {
            const buf = await fs.readFile(path.join(outputsDir(), name));
            return new File([buf], name, { type: getMimeType(name) });
        } catch {
            return undefined;
        }
    }

    private async readUploadAsFile(name: string): Promise<File> {
        const buf = await fs.readFile(path.join(uploadsDir(), name));
        return new File([buf], name, { type: getMimeType(name) });
    }

    /** 执行一个工作流，返回产物（图片/视频/音频）并保存到 outputs 目录 */
    private async executeWorkflow(skill: IWorkflowSkill, viewComfyInputs: IInput[], emit?: (event: IAgentProgressEvent) => void): Promise<IAgentOutput[]> {
        const taskId = crypto.randomUUID();
        const sectionName = "智能体";
        const startedAt = Date.now();
        const api = getComfyUIAPIService();
        const workflow = new ComfyWorkflow(skill.workflowApiJSON);
        await workflow.setViewComfy(viewComfyInputs, api);

        emit?.({ type: "queue", promptId: taskId, sectionName, workflowTitle: skill.title, queueStatus: "queued" });

        const files: File[] = [];
        let status: string | undefined;
        let execError: unknown;
        await generationQueue.enqueue(taskId, async () => {
            try {
                const realPromptId = await api.startQueuePrompt(workflow.getWorkflow());
                emit?.({ type: "queue", promptId: taskId, realPromptId, sectionName, workflowTitle: skill.title, queueStatus: "running" });
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

        if (execError) {
            emit?.({ type: "queue", promptId: taskId, sectionName, workflowTitle: skill.title, queueStatus: "error" });
            throw execError;
        }
        if (files.length === 0) {
            emit?.({ type: "queue", promptId: taskId, sectionName, workflowTitle: skill.title, queueStatus: "error" });
            throw new Error(status === "execution_error" ? "工作流执行出错" : "工作流没有产生输出文件");
        }

        await fs.mkdir(outputsDir(), { recursive: true });
        const outputs: IAgentOutput[] = [];
        for (const file of files) {
            const ext = path.extname(file.name) || ".png";
            const name = crypto.randomUUID() + ext;
            await fs.writeFile(path.join(outputsDir(), name), Buffer.from(await file.arrayBuffer()));
            outputs.push({
                name,
                type: outputTypeFromMime(file.type || getMimeType(name)),
                workflowTitle: skill.title,
                workflowId: skill.workflowId,
            });
        }

        statsService.recordGeneration({ imageCount: outputs.length, elapsedMs: Date.now() - startedAt })
            .catch((err) => console.error("Failed to record agent stats", err));

        emit?.({ type: "queue", promptId: taskId, sectionName, workflowTitle: skill.title, queueStatus: "completed" });

        return outputs;
    }

    /** 执行一个工具调用，返回给 LLM 的文本结果 + 可能的产物 */
    private async executeToolCall(
        toolCall: { id: string; function: { name: string; arguments: string } },
        skills: IWorkflowSkill[],
        savedAttachments: IAgentAttachment[],
        session: IAgentSession,
        emit?: (event: IAgentProgressEvent) => void
    ): Promise<{ content: string; outputs?: IAgentOutput[] }> {
        const name = toolCall.function.name;

        if (name === "list_skills") {
            const skillList = await listSkills();
            const lines = skillList.map((s) => `- ${s.name}: ${s.description}`);
            return { content: lines.length ? "可用技能：\n" + lines.join("\n") : "当前没有可用技能。" };
        }

        if (name === "read_skill") {
            const args = parseToolArguments(toolCall.function.arguments);
            const skillName = typeof args.name === "string" ? args.name : "";
            emit?.({ type: "status", phase: "reading-skill", skill: skillName });
            const content = await readSkill(skillName);
            return { content: content ?? `未找到名为「${skillName}」的技能。` };
        }

        // 工作流工具
        const skill = skills.find((s) => s.toolName === name);
        if (!skill) return { content: "抱歉，我无法找到合适的工作流。" };

        try {
            const args = parseToolArguments(toolCall.function.arguments);
            const viewComfyInputs: IInput[] = [];
            for (const [key, value] of Object.entries(args)) {
                if (value === undefined || value === null) continue;
                if (typeof value === "string" && value.trim() === "") continue;
                if (key.includes("seed") && typeof value === "number" && value === 0) continue;
                viewComfyInputs.push({ key, value });
            }

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

            emit?.({ type: "status", phase: "generating", workflowTitle: skill.title });
            const outputs = await this.executeWorkflow(skill, viewComfyInputs, emit);
            return { content: `已通过工作流「${skill.title}」生成 ${outputs.length} 个文件。`, outputs };
        } catch (error) {
            return { content: "生成失败：" + (error instanceof Error ? error.message : String(error)) };
        }
    }

    /** 发送消息并得到助手回复（ReAct 多步循环） */
    async chat(
        sessionId: string,
        text: string,
        attachments: { file: File }[],
        emit?: (event: IAgentProgressEvent) => void
    ): Promise<IAgentMessage> {
        const session = await this.load(sessionId);
        if (!session) throw new Error("会话不存在");

        const settings = await agentSettingsService.getSettings();
        if (!settings.model) throw new Error("尚未配置模型，请在「管理 → 设置」中配置模型名");

        const { skills, tools } = await buildSkills();
        if (skills.length === 0) throw new Error("view_comfy.json 中没有可用工作流");

        const skillTools = [
            {
                type: "function",
                function: {
                    name: "list_skills",
                    description: "列出可用的提示词技能（例如图片/视频/音乐提示词规范）。",
                    parameters: { type: "object", properties: {}, required: [] },
                },
            },
            {
                type: "function",
                function: {
                    name: "read_skill",
                    description: "读取某个提示词技能的完整规范，用于在生成前编写/优化提示词。",
                    parameters: {
                        type: "object",
                        properties: { name: { type: "string", description: "技能名称，例如 image-prompt / video-prompt / music-prompt" } },
                        required: ["name"],
                    },
                },
            },
        ];
        const allTools = [...tools, ...skillTools];

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

        // 3) 组装 LLM 消息（历史）
        const llmMessages: unknown[] = [{ role: "system", content: SYSTEM_PROMPT }];
        for (const m of session.messages) {
            if (m.role === "user") {
                let content = m.content;
                if (m.attachments?.length) content += "\n[用户上传了 " + m.attachments.length + " 个媒体文件]";
                llmMessages.push({ role: "user", content });
            } else {
                let content = m.content || "";
                if (m.outputs?.length) content += "\n[已生成 " + m.outputs.length + " 个文件]";
                llmMessages.push({ role: "assistant", content });
            }
        }

        // 4) ReAct 多步循环
        const maxRounds = settings.maxRounds ?? 6;
        let assistantContent = "";
        let calledAnyTool = false;
        const outputs: IAgentOutput[] = [];

        for (let round = 0; round < maxRounds; round++) {
            emit?.({ type: "status", phase: "thinking" });
            const llm = await callLlm(settings, llmMessages, allTools);
            const toolCalls = llm.toolCalls || [];
            if (toolCalls.length === 0) {
                assistantContent = llm.content;
                break;
            }
            calledAnyTool = true;

            llmMessages.push({ role: "assistant", content: llm.content || "", tool_calls: toolCalls });
            for (const tc of toolCalls) {
                const result = await this.executeToolCall(tc, skills, savedAttachments, session, emit);
                llmMessages.push({ role: "tool", tool_call_id: tc.id, content: result.content });
                if (result.outputs?.length) {
                    outputs.push(...result.outputs);
                    const img = result.outputs.find((o) => o.type === "image");
                    if (img) session.currentImage = img.name;
                }
            }
        }

        // 兜底：模型未调用任何工具（可能不支持函数调用）且用户明显要生成时，用首个文生图工作流
        if (!calledAnyTool && outputs.length === 0 && looksLikeGenerationRequest(text)) {
            const t2iSkill = skills.find((s) => findLongTextKey(s.viewComfyJSON));
            const promptKey = t2iSkill ? findLongTextKey(t2iSkill.viewComfyJSON) : undefined;
            if (t2iSkill && promptKey) {
                try {
                    emit?.({ type: "status", phase: "generating", workflowTitle: t2iSkill.title });
                    const generated = await this.executeWorkflow(t2iSkill, [{ key: promptKey, value: text }], emit);
                    outputs.push(...generated);
                    const img = generated.find((o) => o.type === "image");
                    if (img) session.currentImage = img.name;
                    assistantContent = assistantContent || "已根据你的要求生成。";
                } catch (error) {
                    assistantContent = assistantContent || "生成失败：" + (error instanceof Error ? error.message : String(error));
                }
            }
        }

        if (!assistantContent) {
            assistantContent = outputs.length ? "已根据你的要求生成。" : "我收到了你的消息。";
        }

        // 5) 记录助手消息
        const assistantMessage: IAgentMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: assistantContent,
            outputs: outputs.length ? outputs : undefined,
            createdAt: Date.now(),
        };
        session.messages.push(assistantMessage);
        session.updatedAt = Date.now();
        await this.persist(session);

        return assistantMessage;
    }
}

export const agentService = new AgentService();
