import path from "node:path";
import fs from "node:fs/promises";

export interface IBackendConfig {
    /** 稳定标识，例如 "gpu-0" */
    id: string;
    /** ComfyUI(CUDA) 设备序号，与 --cuda-device 一致 */
    gpuIndex: number;
    /** 显示名 */
    name: string;
    /** ComfyUI 监听端口 */
    port: number;
    /** 是否参与调度；false 表示该卡空闲、不接任务 */
    enabled: boolean;
}

export interface ILoadBalancerConfig {
    /** 负载均衡总开关；关闭时固定只用第一个启用的实例 */
    enabled: boolean;
    backends: IBackendConfig[];
}

const DEFAULT_DATA_DIR = path.join(process.cwd(), "data");

function parsePortFromUrl(url: string): number {
    const match = url.match(/:(\d+)(?:\/|$)/);
    const port = match ? Number(match[1]) : NaN;
    return Number.isInteger(port) && port > 0 ? port : 8188;
}

function defaultConfig(): ILoadBalancerConfig {
    const url = process.env.COMFYUI_API_URL || "127.0.0.1:8188";
    const port = parsePortFromUrl(url);
    return {
        enabled: true,
        backends: [
            { id: "gpu-0", gpuIndex: 0, name: "GPU 0", port, enabled: true },
        ],
    };
}

/**
 * 负载均衡配置：持久化到 data/load-balancer.json（gitignored）。
 * 默认只有一个后端（GPU 0），其余显卡由管理页按需启用。
 */
class LoadBalancerService {
    private filePath: string;
    private cache: ILoadBalancerConfig | undefined;

    constructor() {
        this.filePath = path.join(process.env.DATA_DIR || DEFAULT_DATA_DIR, "load-balancer.json");
    }

    private async load(): Promise<ILoadBalancerConfig> {
        if (this.cache) return this.cache;
        let data: ILoadBalancerConfig;
        try {
            const raw = await fs.readFile(this.filePath, "utf8");
            data = { ...defaultConfig(), ...JSON.parse(raw) };
        } catch {
            data = defaultConfig();
        }
        this.cache = data;
        return data;
    }

    private async persist(data: ILoadBalancerConfig): Promise<void> {
        this.cache = data;
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), "utf8");
    }

    async getConfig(): Promise<ILoadBalancerConfig> {
        return this.load();
    }

    /** 更新某张卡的端口（端口被占用顺延时用），找不到该卡则原样返回 */
    async updateBackendPort(gpuIndex: number, port: number): Promise<ILoadBalancerConfig> {
        const current = await this.load();
        const backends = current.backends.map((b) =>
            b.gpuIndex === gpuIndex ? { ...b, port } : b
        );
        return this.saveConfig({ enabled: current.enabled, backends });
    }

    async saveConfig(next: Partial<ILoadBalancerConfig>): Promise<ILoadBalancerConfig> {
        const current = await this.load();
        const rawBackends = Array.isArray(next.backends) ? next.backends : current.backends;
        const backends: IBackendConfig[] = rawBackends.map((b, i) => {
            const gpuIndex = Number.isInteger(Number(b.gpuIndex)) ? Number(b.gpuIndex) : i;
            return {
                id: typeof b.id === "string" && b.id ? b.id : `gpu-${gpuIndex}`,
                gpuIndex,
                name: typeof b.name === "string" && b.name ? b.name : `GPU ${gpuIndex}`,
                port: Number.isInteger(Number(b.port)) ? Number(b.port) : 8188 + gpuIndex,
                enabled: Boolean(b.enabled),
            };
        });

        const config: ILoadBalancerConfig = {
            enabled: typeof next.enabled === "boolean" ? next.enabled : current.enabled,
            backends,
        };
        await this.persist(config);
        return config;
    }
}

// Next.js 开发模式下不同路由处理器可能各自打包一份模块，用 globalThis 保证单例跨路由共享
const globalForLoadBalancer = globalThis as unknown as { loadBalancerService?: LoadBalancerService };
export const loadBalancerService = globalForLoadBalancer.loadBalancerService ?? (globalForLoadBalancer.loadBalancerService = new LoadBalancerService());
