import { execFile } from "node:child_process";
import os from "node:os";

export interface IGPUInfo {
    index: number;
    name: string;
    utilization: number;  // %
    memoryUsed: number;   // MiB
    memoryTotal: number;  // MiB
    temperature: number;  // °C
    powerDraw: number;    // W
    powerLimit: number;   // W
}

export interface IMonitorSnapshot {
    timestamp: number;
    platform: string;
    hostname: string;
    uptime: number;
    nodeVersion: string;
    cpu: {
        model: string;
        cores: number;
        usagePercent: number;
        perCore: number[];
        loadAvg: number[];
    };
    memory: {
        total: number;
        used: number;
        free: number;
        usagePercent: number;
    };
    gpus: IGPUInfo[];
    gpuAvailable: boolean;
    history: {
        timestamps: number[];
        gpuUtilization: number[];
        gpuMemory: number[];
        cpu: number[];
        memory: number[];
    };
}

const SAMPLE_INTERVAL_MS = 3000;
const HISTORY_LIMIT = 30;
const NVIDIA_SMI_QUERY = "--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit";
const NVIDIA_SMI_FORMAT = "--format=csv,noheader,nounits";
const LINE_FEED = String.fromCharCode(10);

/**
 * 硬件监测：后台定时采样（3s），缓存最新快照 + 最近 N 条历史。
 * 跨平台：GPU 用 nvidia-smi（Windows/Linux 通用），CPU 用 os.cpus() 两次采样差值，内存用 os 模块。
 */
class MonitorService {
    private snapshot: Omit<IMonitorSnapshot, "history"> | undefined;
    private history: IMonitorSnapshot["history"] = {
        timestamps: [],
        gpuUtilization: [],
        gpuMemory: [],
        cpu: [],
        memory: [],
    };
    private prevCpuTimes: os.CpuInfo[] | undefined;
    private timer: NodeJS.Timeout | undefined;
    private sampling = false;

    start(): void {
        if (this.timer) return;
        this.sample();
        this.timer = setInterval(() => this.sample(), SAMPLE_INTERVAL_MS);
    }

    getSnapshot(): IMonitorSnapshot | undefined {
        if (!this.snapshot) return undefined;
        return { ...this.snapshot, history: this.cloneHistory() };
    }

    /** 立即采样一次并返回快照（首次请求时避免空数据） */
    async refresh(): Promise<IMonitorSnapshot | undefined> {
        await this.sample();
        return this.getSnapshot();
    }

    private cloneHistory(): IMonitorSnapshot["history"] {
        return {
            timestamps: [...this.history.timestamps],
            gpuUtilization: [...this.history.gpuUtilization],
            gpuMemory: [...this.history.gpuMemory],
            cpu: [...this.history.cpu],
            memory: [...this.history.memory],
        };
    }

    private async sample(): Promise<void> {
        if (this.sampling) return;
        this.sampling = true;
        try {
            const [gpus, gpuAvailable] = await this.queryGpus();
            this.snapshot = {
                timestamp: Date.now(),
                platform: os.platform(),
                hostname: os.hostname(),
                uptime: os.uptime(),
                nodeVersion: process.version,
                cpu: this.sampleCpu(),
                memory: this.sampleMemory(),
                gpus,
                gpuAvailable,
            };
            this.pushHistory();
        } catch (error) {
            console.error("monitor sample failed", error);
        } finally {
            this.sampling = false;
        }
    }

    private sampleMemory() {
        const total = os.totalmem();
        const free = os.freemem();
        const used = total - free;
        return {
            total,
            used,
            free,
            usagePercent: total > 0 ? (used / total) * 100 : 0,
        };
    }

    private sampleCpu() {
        const cpus = os.cpus();
        let usagePercent = 0;
        const perCore: number[] = [];

        if (this.prevCpuTimes && this.prevCpuTimes.length === cpus.length) {
            for (let i = 0; i < cpus.length; i++) {
                const prev = this.prevCpuTimes[i].times;
                const curr = cpus[i].times;
                const prevTotal = prev.user + prev.nice + prev.sys + prev.idle + prev.irq;
                const currTotal = curr.user + curr.nice + curr.sys + curr.idle + curr.irq;
                const totalDelta = currTotal - prevTotal;
                const idleDelta = curr.idle - prev.idle;
                const pct = totalDelta > 0 ? ((totalDelta - idleDelta) / totalDelta) * 100 : 0;
                perCore.push(Math.round(pct * 10) / 10);
            }
            usagePercent = perCore.reduce((a, b) => a + b, 0) / (perCore.length || 1);
        }

        this.prevCpuTimes = cpus;
        return {
            model: cpus[0]?.model || "",
            cores: cpus.length,
            usagePercent,
            perCore,
            loadAvg: os.loadavg(),
        };
    }

    private queryGpus(): Promise<[IGPUInfo[], boolean]> {
        return new Promise((resolve) => {
            execFile("nvidia-smi", [NVIDIA_SMI_QUERY, NVIDIA_SMI_FORMAT], { timeout: 5000 }, (error, stdout) => {
                if (error) {
                    resolve([[], false]);
                    return;
                }
                const gpus: IGPUInfo[] = [];
                for (const line of stdout.split(LINE_FEED)) {
                    const t = line.trim();
                    if (!t) continue;
                    const p = t.split(",").map((s) => s.trim());
                    // index,name,util,memUsed,memTotal,temp,power,powerLimit
                    gpus.push({
                        index: Number(p[0]) || 0,
                        name: p[1] || "NVIDIA GPU",
                        utilization: Number(p[2]) || 0,
                        memoryUsed: Number(p[3]) || 0,
                        memoryTotal: Number(p[4]) || 0,
                        temperature: Number(p[5]) || 0,
                        powerDraw: Number(p[6]) || 0,
                        powerLimit: Number(p[7]) || 0,
                    });
                }
                resolve([gpus, gpus.length > 0]);
            });
        });
    }

    private pushHistory(): void {
        const s = this.snapshot;
        if (!s) return;
        const g0 = s.gpus[0];
        this.history.timestamps.push(s.timestamp);
        this.history.cpu.push(Math.round(s.cpu.usagePercent * 10) / 10);
        this.history.memory.push(Math.round(s.memory.usagePercent * 10) / 10);
        this.history.gpuUtilization.push(g0 ? g0.utilization : 0);
        this.history.gpuMemory.push(g0 ? g0.memoryUsed : 0);

        if (this.history.timestamps.length > HISTORY_LIMIT) {
            this.history.timestamps.shift();
            this.history.cpu.shift();
            this.history.memory.shift();
            this.history.gpuUtilization.shift();
            this.history.gpuMemory.shift();
        }
    }
}

export const monitorService = new MonitorService();
