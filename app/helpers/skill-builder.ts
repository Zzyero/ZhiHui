import path from "node:path";
import fs from "node:fs/promises";
import type { IMultiValueInput } from "@/lib/workflow-api-parser";
import { listSkills, getSkillForWorkflow, type PromptMediaType } from "@/app/helpers/skill-registry";

export interface IAgentToolFunction {
    name: string;
    description: string;
    parameters: {
        type: "object";
        properties: Record<string, unknown>;
        required: string[];
    };
}

export interface IWorkflowSkill {
    workflowId: string;
    title: string;
    description: string;
    toolName: string;
    tool: { type: "function"; function: IAgentToolFunction };
    viewComfyJSON: Record<string, any>;
    workflowApiJSON: Record<string, any>;
    mediaType: PromptMediaType;
    skillName?: string;
}

const VALUE_TYPE_TO_JSON: Record<string, string> = {
    string: "string",
    "long-text": "string",
    number: "number",
    float: "number",
    bigint: "integer",
    boolean: "boolean",
    select: "string",
    seed: "integer",
    noise_seed: "integer",
    rand_seed: "integer",
    slider: "number",
};

// 文件类输入不进 schema，由 agent 自动挂载附件 / 上下文图片
const FILE_VALUE_TYPES = new Set(["image", "video", "audio", "image-mask"]);

const SAVE_NODE_MEDIA: Record<string, PromptMediaType> = {
    SaveImage: "image", SaveAnimatedWEBP: "image", SaveGif: "image",
    SaveVideo: "video", VHS_VideoCombine: "video",
    SaveAudio: "audio", SaveAudioAdvanced: "audio",
};

const MEDIA_LABEL: Record<PromptMediaType, string> = { image: "图片", video: "视频", audio: "音频" };

function sanitizeToolName(title: string, id: string): string {
    const base = (title || "workflow")
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return (base || "workflow") + "_" + (id || "").slice(0, 8);
}

/** 从输出保存节点 + section 兜底，推导工作流产物类型 */
function deriveMediaType(workflowApiJSON: Record<string, any>, title: string, sections: { name: string; workflows: string[] }[]): PromptMediaType {
    if (workflowApiJSON) {
        for (const node of Object.values(workflowApiJSON)) {
            const mt = SAVE_NODE_MEDIA[(node as any)?.class_type];
            if (mt) return mt;
        }
    }
    const section = sections?.find((s) => s.workflows?.includes(title));
    const name = section?.name || "";
    if (name.includes("视频")) return "video";
    if (name.includes("音频")) return "audio";
    return "image";
}

/** 从 view_comfy.json 生成所有工作流的 skills + tools */
export async function buildSkills(): Promise<{
    skills: IWorkflowSkill[];
    tools: { type: "function"; function: IAgentToolFunction }[];
}> {
    const filePath = path.join(process.cwd(), process.env.VIEW_COMFY_FILE_NAME || "view_comfy.json");
    let data: any;
    try {
        const raw = await fs.readFile(filePath, "utf8");
        data = JSON.parse(raw);
    } catch {
        return { skills: [], tools: [] };
    }

    const workflows: any[] = data?.workflows || [];
    const sections: { name: string; workflows: string[] }[] = data?.sections || [];
    const promptSkills = await listSkills();
    const skills: IWorkflowSkill[] = [];

    for (const w of workflows) {
        const view = w?.viewComfyJSON;
        if (!view) continue;
        // 智能体开关：viewComfyJSON.agentEnabled === false 时不暴露给智能体
        if (view.agentEnabled === false) continue;

        const title: string = view.title || "工作流";
        const workflowId: string = view.id || "";
        const toolName = sanitizeToolName(title, workflowId);
        const mediaType: PromptMediaType = (view.mediaType as PromptMediaType) || deriveMediaType(w.workflowApiJSON, title, sections);
        const skillName = getSkillForWorkflow(mediaType, title, promptSkills)?.name;

        const properties: Record<string, unknown> = {};
        const required: string[] = [];

        const groups: IMultiValueInput[] = [...(view.inputs || []), ...(view.advancedInputs || [])];
        for (const group of groups) {
            for (const field of group.inputs || []) {
                if (field.visibility === "deleted") continue;
                const vt = field.valueType || "string";
                if (FILE_VALUE_TYPES.has(vt)) continue;
                // 智能体参数开关：仅 agentExposed === true 暴露；long-text（提示词）默认暴露
                const exposed = field.agentExposed === true || (field.agentExposed === undefined && vt === "long-text");
                if (!exposed) continue;

                const jsonType = VALUE_TYPE_TO_JSON[vt] || "string";
                const prop: Record<string, unknown> = {
                    type: jsonType,
                    description: field.title || field.key,
                };
                if (vt === "select" && field.options?.length) {
                    prop.enum = field.options.map((o) => o.value);
                    prop.description += "（可选值：" + field.options.map((o) => o.label).join(" / ") + "）";
                }
                properties[field.key] = prop;
            }
        }

        const baseDesc = view.description || `使用工作流「${title}」生成${MEDIA_LABEL[mediaType]}内容。`;
        const skillHint = skillName
            ? ` 生成前请先调用 read_skill("${skillName}") 阅读提示词规范，再据此编写提示词。`
            : "";
        const description = baseDesc + skillHint + " 图片/视频/音频输入会自动由系统提供。";

        skills.push({
            workflowId,
            title,
            description: view.description || "",
            toolName,
            tool: {
                type: "function",
                function: {
                    name: toolName,
                    description,
                    parameters: { type: "object", properties, required },
                },
            },
            viewComfyJSON: view,
            workflowApiJSON: w.workflowApiJSON,
            mediaType,
            skillName,
        });
    }

    return { skills, tools: skills.map((s) => s.tool) };
}
