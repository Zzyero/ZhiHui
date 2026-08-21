import path from "node:path";
import fs from "node:fs/promises";
import type { IMultiValueInput } from "@/lib/workflow-api-parser";

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

function sanitizeToolName(title: string, id: string): string {
    const base = (title || "workflow")
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return (base || "workflow") + "_" + (id || "").slice(0, 8);
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
    const skills: IWorkflowSkill[] = [];

    for (const w of workflows) {
        const view = w?.viewComfyJSON;
        if (!view) continue;

        const title: string = view.title || "工作流";
        const workflowId: string = view.id || "";
        const toolName = sanitizeToolName(title, workflowId);

        const properties: Record<string, unknown> = {};
        const required: string[] = [];

        const groups: IMultiValueInput[] = [...(view.inputs || []), ...(view.advancedInputs || [])];
        for (const group of groups) {
            for (const field of group.inputs || []) {
                if (field.visibility === "deleted") continue;
                const vt = field.valueType || "string";
                if (FILE_VALUE_TYPES.has(vt)) continue;

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
                // 不强制 required：缺省字段使用工作流默认值，避免必填过多导致模型不调用工具
            }
        }

        skills.push({
            workflowId,
            title,
            description: view.description || "",
            toolName,
            tool: {
                type: "function",
                function: {
                    name: toolName,
                    description:
                        view.description ||
                        "使用工作流「" + title + "」生成内容。图片/视频/音频输入会自动由系统提供。",
                    parameters: { type: "object", properties, required },
                },
            },
            viewComfyJSON: view,
            workflowApiJSON: w.workflowApiJSON,
        });
    }

    return { skills, tools: skills.map((s) => s.tool) };
}
