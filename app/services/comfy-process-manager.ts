import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { loadBalancerService, type IBackendConfig } from "@/app/services/load-balancer-service";

export type ProcessStatus = "stopped" | "starting" | "running" | "stopping" | "error";

export interface IProcessInfo {
    gpuIndex: number;
    port: number;
    status: ProcessStatus;
    pid?: number;
    /** true 表示由本应用启动，false 表示外部启动后被收养 */
    managed: boolean;
    startedAt?: number;
    error?: string;
    logs: string[];
}

const LOG_LIMIT = 200;
const READY_TIMEOUT_MS = 90_000;

function comfyDir(): string {
    return process.env.COMFYUI_DIR || path.resolve(process.cwd(), "..", "ComfyUI");
}

/**
 * ComfyUI 进程管理：按配置 spawn/kill 每个后端的 ComfyUI 实例。
 * 单进程自托管场景：状态存内存；应用重启后通过端口探测"收养"仍在运行的实例。
 */
class ComfyProcessManager {
    private processes = new Map<number, IProcessInfo>();
    private children = new Map<number, ChildProcess>();
    private initPromise: Promise<void> | undefined;

    private info(gpuIndex: number, port?: number): IProcessInfo {
        const existing = this.processes.get(gpuIndex);
        if (existing) return existing;
        const created: IProcessInfo = {
            gpuIndex,
            port: port ?? 8188 + gpuIndex,
            status: "stopped",
            managed: false,
            logs: [],
        };
        this.processes.set(gpuIndex, created);
        return created;
    }

    getStatus(gpuIndex: number): IProcessInfo {
        return this.info(gpuIndex);
    }

    getAll(): IProcessInfo[] {
        return [...this.processes.values()];
    }

    /** 幂等初始化：收养已运行实例；默认只启动第一个启用实例 */
    async init(): Promise<void> {
        if (this.initPromise) return this.initPromise;
        this.initPromise = this.doInit();
        return this.initPromise;
    }

    private async doInit(): Promise<void> {
        try {
            const config = await loadBalancerService.getConfig();
            for (const b of config.backends) {
                this.info(b.gpuIndex, b.port);
            }
            await Promise.all(config.backends.map((b) => this.adoptIfRunning(b)));

            const anyRunning = config.backends.some((b) => this.getStatus(b.gpuIndex).status === "running");
            if (!anyRunning) {
                const first = config.backends.find((b) => b.enabled);
                if (first) {
                    this.start(first);
                }
            }
        } catch (error) {
            console.error("[comfy] 进程管理器初始化失败", error);
        }
    }

    private async adoptIfRunning(b: IBackendConfig): Promise<void> {
        const info = this.info(b.gpuIndex, b.port);
        if (info.status === "running" || info.status === "starting") return;
        if (await this.healthCheck(b.port)) {
            info.status = "running";
            info.managed = false;
            info.error = undefined;
            console.log(`[comfy] 收养已在运行的实例 GPU ${b.gpuIndex} :${b.port}`);
        }
    }

    private async healthCheck(port: number): Promise<boolean> {
        try {
            const res = await fetch(`http://127.0.0.1:${port}/system_stats`, {
                signal: AbortSignal.timeout(1500),
            });
            return res.ok;
        } catch {
            return false;
        }
    }

    start(backend: IBackendConfig): IProcessInfo {
        const info = this.info(backend.gpuIndex, backend.port);
        if (info.status === "running" || info.status === "starting") return info;

        const dir = comfyDir();
        const python = path.join(dir, "python_embeded", "bin", "python");
        if (!fs.existsSync(python)) {
            info.status = "error";
            info.error = `找不到 ComfyUI 的 Python：${python}`;
            return info;
        }

        const args = [
            "main.py",
            "--listen", "0.0.0.0",
            "--port", String(backend.port),
            "--cuda-device", String(backend.gpuIndex),
        ];
        // GPU 0 沿用默认 comfyui.db（保留已有数据）；其余每卡独立 db，避免多实例抢同一 SQLite
        if (backend.gpuIndex !== 0) {
            args.push("--database-url", "sqlite:///" + path.join(dir, "user", `comfyui_gpu${backend.gpuIndex}.db`));
        }

        let child: ChildProcess;
        try {
            child = spawn(python, args, { cwd: dir, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
        } catch (error) {
            info.status = "error";
            info.error = error instanceof Error ? error.message : String(error);
            return info;
        }

        info.status = "starting";
        info.managed = true;
        info.pid = child.pid;
        info.startedAt = Date.now();
        info.error = undefined;
        this.children.set(backend.gpuIndex, child);

        const log = (chunk: Buffer) => {
            const text = chunk.toString();
            info.logs.push(text);
            if (info.logs.length > LOG_LIMIT) {
                info.logs.splice(0, info.logs.length - LOG_LIMIT);
            }
        };
        child.stdout?.on("data", log);
        child.stderr?.on("data", log);

        child.on("exit", (code, signal) => {
            this.children.delete(backend.gpuIndex);
            info.pid = undefined;
            if (info.status === "stopping" || info.status === "stopped") {
                info.status = "stopped";
            } else {
                info.status = "error";
                info.error = `进程退出 code=${code} signal=${signal}`;
            }
        });

        this.waitUntilReady(backend, info);
        return info;
    }

    private async waitUntilReady(backend: IBackendConfig, info: IProcessInfo): Promise<void> {
        const deadline = Date.now() + READY_TIMEOUT_MS;
        while (Date.now() < deadline) {
            if (info.status === "stopped" || info.status === "error") return;
            if (await this.healthCheck(backend.port)) {
                if (info.status === "starting") info.status = "running";
                return;
            }
            await new Promise((r) => setTimeout(r, 2000));
        }
        if (info.status === "starting") {
            info.status = "error";
            info.error = "启动超时（90s 内未就绪）";
        }
    }

    async stop(gpuIndex: number): Promise<{ ok: boolean; message?: string }> {
        const info = this.info(gpuIndex);
        if (info.status === "stopped") return { ok: true };

        const child = this.children.get(gpuIndex);
        if (!child) {
            if (!info.managed) {
                return { ok: false, message: "该实例由外部启动，请手动停止" };
            }
            info.status = "stopped";
            return { ok: true };
        }

        info.status = "stopping";
        await new Promise<void>((resolve) => {
            const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
            child.once("exit", () => {
                clearTimeout(timer);
                resolve();
            });
            child.kill("SIGTERM");
        });
        info.status = "stopped";
        return { ok: true };
    }

    /** 等待任一实例就绪（首次启动自动拉起第一个实例时，避免首个请求落空） */
    async waitForAnyRunning(timeoutMs: number): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if ([...this.processes.values()].some((p) => p.status === "running")) return;
            const anyStarting = [...this.processes.values()].some((p) => p.status === "starting");
            if (!anyStarting) return;
            await new Promise((r) => setTimeout(r, 1000));
        }
    }
}

export const comfyProcessManager = new ComfyProcessManager();
