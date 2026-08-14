import type { IViewComfyBase } from "@/app/providers/view-comfy-provider";
import type { IInputField, IMultiValueInput } from "@/lib/workflow-api-parser";

/** sectionName -> 路由 */
export const SECTION_ROUTES: Record<string, string> = {
    "智能生图": "/playground",
    "智能修图": "/image-edit",
    "视频生成": "/video-generate",
    "音频克隆": "/audio-clone",
};

/** 把字段 key（"6-inputs-text"）拆成 nodeId 与 fieldName */
export function splitFieldKey(key: string): { nodeId: string; fieldName: string } {
    const dash = key.indexOf("-");
    if (dash === -1) return { nodeId: key, fieldName: "" };
    const nodeId = key.slice(0, dash);
    const rest = key.slice(dash + 1); // "inputs-<fieldName>"
    const fieldName = rest.startsWith("inputs-") ? rest.slice("inputs-".length) : rest;
    return { nodeId, fieldName };
}

/** 取 prompt 中某字段的已解析值（无值时返回 undefined） */
function getPromptValue(prompt: Record<string, any> | undefined, field: IInputField): unknown {
    if (!prompt) return undefined;
    const { nodeId, fieldName } = splitFieldKey(field.key);
    const value = prompt?.[nodeId]?.inputs?.[fieldName];
    // 连接引用（["4", 0] 数组）不是可回填的控件值
    if (Array.isArray(value)) return undefined;
    return value;
}

/**
 * 把 prompt 里的真实值覆盖到表单结构上，返回新的 inputs/advancedInputs（用于一键复刻回填）。
 * 文件型输入（image/video/audio）在 prompt 里只有文件名引用，会原样写入（前端表单仍需要用户重传二进制）。
 */
export function applyPromptToInputs(
    viewComfyJSON: IViewComfyBase,
    prompt: Record<string, any> | undefined
): { inputs: IMultiValueInput[]; advancedInputs: IMultiValueInput[] } {
    const mapGroup = (group: IMultiValueInput): IMultiValueInput => ({
        ...group,
        inputs: group.inputs.map((field) => {
            const v = getPromptValue(prompt, field);
            return v === undefined ? field : { ...field, value: v };
        }),
    });
    return {
        inputs: viewComfyJSON.inputs.map(mapGroup),
        advancedInputs: viewComfyJSON.advancedInputs.map(mapGroup),
    };
}

export interface IGalleryParamEntry {
    key: string;
    title: string;
    valueType: string;
    value: unknown;
    options?: { label: string; value: string }[];
}

/** 构建用于详情展示的参数列表（跳过已删除字段与无值字段） */
export function buildParamEntries(
    viewComfyJSON: IViewComfyBase | undefined,
    prompt: Record<string, any> | undefined
): IGalleryParamEntry[] {
    if (!viewComfyJSON) return [];
    const entries: IGalleryParamEntry[] = [];
    const groups = [...viewComfyJSON.inputs, ...viewComfyJSON.advancedInputs];
    for (const group of groups) {
        for (const field of group.inputs) {
            if (field.visibility === "deleted") continue;
            const value = getPromptValue(prompt, field);
            if (value === undefined || value === null) continue;
            entries.push({
                key: field.key,
                title: field.title || field.key,
                valueType: field.valueType,
                value,
                options: field.options,
            });
        }
    }
    return entries;
}

/** 参数值可读化 */
export function formatParamValue(entry: IGalleryParamEntry): string {
    const { valueType, value, options } = entry;
    if (valueType === "boolean") return value ? "是" : "否";
    if (valueType === "select" && options) {
        const opt = options.find((o) => o.value === String(value));
        return opt?.label ?? String(value);
    }
    return String(value);
}
