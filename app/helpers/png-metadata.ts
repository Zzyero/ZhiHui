/**
 * 解析 ComfyUI SaveImage 输出 PNG 头部嵌入的工作流元数据。
 *
 * ComfyUI 默认在 PNG 的 tEXt chunk 中写入：
 *   - prompt   ：已解析的 API prompt（nodeId -> { class_type, inputs }），含最终 seed/提示词等真实值
 *   - workflow ：UI 工作流图（nodes/links）
 *
 * 结构：8 字节签名 -> 循环 chunk [length:4][type:4][data][crc:4]
 */

export interface IComfyPngMetadata {
    /** 已解析的 API prompt：nodeId -> { class_type, inputs } */
    prompt?: Record<string, any>;
    /** UI 工作流图（nodes/links），本期仅解析存储，暂未使用 */
    workflow?: Record<string, any>;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function parseComfyPngMetadata(buffer: Buffer): IComfyPngMetadata {
    const result: IComfyPngMetadata = {};
    if (!buffer || buffer.length < 8) return result;
    if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return result;

    try {
        let offset = 8;
        while (offset + 8 <= buffer.length) {
            const length = buffer.readUInt32BE(offset);
            const type = buffer.toString("ascii", offset + 4, offset + 8);
            const dataStart = offset + 8;
            const dataEnd = dataStart + length;
            if (dataEnd + 4 > buffer.length) break; // 还需 4 字节 CRC

            if (type === "tEXt") {
                const chunk = buffer.subarray(dataStart, dataEnd);
                const nul = chunk.indexOf(0);
                if (nul !== -1) {
                    const keyword = chunk.toString("ascii", 0, nul);
                    const text = chunk.toString("utf8", nul + 1);
                    if (keyword === "prompt" || keyword === "workflow") {
                        try {
                            result[keyword] = JSON.parse(text);
                        } catch {
                            // 非 JSON 文本，忽略
                        }
                    }
                }
            } else if (type === "IEND") {
                break;
            }

            offset = dataEnd + 4; // 跳过 CRC
        }
    } catch (error) {
        console.error("Failed to parse PNG metadata:", error);
    }

    return result;
}
