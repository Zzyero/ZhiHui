import { execFile } from "node:child_process";
import path from "node:path";

export interface ICudaDevice {
    /** ComfyUI(CUDA) 设备序号，与 --cuda-device 的值一致 */
    cudaIndex: number;
    name: string;
    /** 归一化 UUID（无 "GPU-" 前缀、小写），与 nvidia-smi 的 uuid 对齐 */
    uuid: string;
}

/** 归一化 GPU UUID，抹平 nvidia-smi "GPU-xxx" 与 torch 裸 uuid 的差异 */
export function normalizeUuid(uuid: string): string {
    return uuid.replace(/^GPU-/i, "").toLowerCase();
}

function comfyDir(): string {
    return process.env.COMFYUI_DIR || path.resolve(process.cwd(), "..", "ComfyUI");
}

let cache: ICudaDevice[] | undefined;
let pending: Promise<ICudaDevice[]> | undefined;

/**
 * 用 ComfyUI 自带的 torch 枚举 CUDA 设备顺序（uuid 为稳定标识），结果缓存。
 * nvidia-smi 的 index 顺序和 CUDA 顺序可能不同（本机 A100 在 CUDA 里排最前），
 * 因此不能直接把 nvidia-smi 的 index 当作 --cuda-device 的值。
 */
export function getCudaDeviceOrder(): Promise<ICudaDevice[]> {
    if (cache) return Promise.resolve(cache);
    if (pending) return pending;

    pending = new Promise((resolve) => {
        const python = path.join(comfyDir(), "python_embeded", "bin", "python");
        const script =
            "import torch; " +
            "print('\\n'.join('%d|%s|%s' % (i, torch.cuda.get_device_name(i), torch.cuda.get_device_properties(i).uuid) " +
            "for i in range(torch.cuda.device_count())))";
        execFile(python, ["-c", script], { timeout: 30000 }, (error, stdout) => {
            const devices: ICudaDevice[] = [];
            if (!error) {
                for (const line of stdout.split("\n")) {
                    const t = line.trim();
                    if (!t) continue;
                    const [idx, name, uuid] = t.split("|");
                    if (idx === undefined || uuid === undefined) continue;
                    devices.push({
                        cudaIndex: Number(idx) || 0,
                        name: name ?? "",
                        uuid: normalizeUuid(uuid),
                    });
                }
            }
            cache = devices;
            resolve(devices);
        });
    });
    return pending;
}
