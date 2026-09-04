import { spawn, execFile, type ChildProcess } from "node:child_process";
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

// 去除 ANSI 转义序列（颜色码、光标控制等），避免在网页日志里显示成 [32m/[0m 乱码
const ANSI_ESCAPE_REGEX = /\u001b\[[0-9;?]*[a-zA-Z]/g;

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
                    await this.start(first);
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

    /** 端口是否已被监听（任何进程，不限本用户） */
    private isPortInUse(port: number): Promise<boolean> {
        return new Promise((resolve) => {
            execFile("ss", ["-ltn", `sport = :${port}`], { timeout: 3000 }, (error, stdout) => {
                if (error) {
                    resolve(false);
                    return;
                }
                resolve(stdout.includes("LISTEN"));
            });
        });
    }

    /** 从 startPort 起找第一个空闲端口 */
    private async findFreePort(startPort: number): Promise<number> {
        let port = startPort;
        while (await this.isPortInUse(port)) {
            port += 1;
        }
        return port;
    }

    /** 自愈：把「出错/启动中」但端口上其实已在运行的实例纠正为 running（应对历史误判或孤儿进程） */
    async reconcile(): Promise<void> {
        for (const info of this.processes.values()) {
            if (info.status === "error" || info.status === "starting") {
                if (await this.healthCheck(info.port)) {
                    info.status = "running";
                    info.error = undefined;
                }
            }
        }
    }

    async start(backend: IBackendConfig): Promise<IProcessInfo> {
        const info = this.info(backend.gpuIndex, backend.port);
        if (info.status === "running" || info.status === "starting") return info;

        // 端口上可能已有实例在跑（上次的孤儿进程/重复点击）：直接收养，避免重复 spawn
        if (await this.healthCheck(backend.port)) {
            info.status = "running";
            info.managed = false;
            info.error = undefined;
            console.log(`[comfy] 端口 :${backend.port} 已有实例在跑，直接收养`);
            return info;
        }

        // 端口被其他进程占用时，往后顺延找一个空闲端口
        const port = await this.findFreePort(backend.port);
        if (port !== backend.port) {
            console.log(`[comfy] GPU ${backend.gpuIndex} 端口 :${backend.port} 被占用，顺延到 :${port}`);
            info.port = port;
            await loadBalancerService.updateBackendPort(backend.gpuIndex, port).catch((e) => {
                console.error("[comfy] 更新端口配置失败", e);
            });
        }

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
            "--port", String(port),
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
            const text = chunk.toString().replace(ANSI_ESCAPE_REGEX, "");
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

        this.waitUntilReady(info);
        return info;
    }

    private async waitUntilReady(info: IProcessInfo): Promise<void> {
        // 一直探测到就绪或进程退出为止（多卡同时启动时加载很慢，不能设固定超时）
        while (true) {
            if (info.status === "stopped" || info.status === "error") return;
            if (await this.healthCheck(info.port)) {
                if (info.status === "starting") info.status = "running";
                return;
            }
            await new Promise((r) => setTimeout(r, 2000));
        }
    }

    async stop(gpuIndex: number): Promise<{ ok: boolean; message?: string }> {
        const info = this.info(gpuIndex);
        if (info.status === "stopped") return { ok: true };

        const child = this.children.get(gpuIndex);
        if (!child) {
            if (!info.managed) {
                // 收养的外部实例：按端口找到 PID 并终止
                const pid = await this.findPidByPort(info.port);
                if (pid) {
                    await this.killPid(pid);
                    info.status = "stopped";
                    info.pid = undefined;
                    return { ok: true };
                }
                return { ok: false, message: "该实例由外部启动，且未找到对应进程，请手动停止" };
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

    /** 按 PID 先 SIGTERM 优雅退出，超时后 SIGKILL */
    private async killPid(pid: number): Promise<void> {
        await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                try { process.kill(pid, "SIGKILL"); } catch { /* 已退出 */ }
                resolve();
            }, 10_000);
            const poll = setInterval(() => {
                try {
                    process.kill(pid, 0);
                } catch {
                    clearInterval(poll);
                    clearTimeout(timer);
                    resolve();
                }
            }, 500);
            try {
                process.kill(pid, "SIGTERM");
            } catch {
                clearInterval(poll);
                clearTimeout(timer);
                resolve();
            }
        });
    }

    /** 用 ss 查找监听指定端口的进程 PID（本用户进程无需 root） */
    private findPidByPort(port: number): Promise<number | undefined> {
        return new Promise((resolve) => {
            execFile("ss", ["-ltnp", `sport = :${port}`], { timeout: 3000 }, (error, stdout) => {
                if (error) {
                    resolve(undefined);
                    return;
                }
                const match = stdout.match(/pid=(\d+)/);
                resolve(match ? Number(match[1]) : undefined);
            });
        });
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

// Next.js 开发模式下不同路由处理器可能各自打包一份模块，用 globalThis 保证单例跨路由共享
const globalForComfyProcess = globalThis as unknown as { comfyProcessManager?: ComfyProcessManager };
export const comfyProcessManager = globalForComfyProcess.comfyProcessManager ?? (globalForComfyProcess.comfyProcessManager = new ComfyProcessManager());
