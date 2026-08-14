import path from "node:path";
import fs from "node:fs/promises";

export interface IDayStat {
    count: number;
    images: number;
    elapsedMs: number;
}

export interface IWorkflowStat {
    workflowId: string;
    title: string;
    sectionName: string;
    count: number;
    images: number;
    lastUsedAt: number;
}

export interface ISectionStat {
    count: number;
    images: number;
}

export interface IStatsData {
    totalGenerations: number;
    totalImages: number;
    totalElapsedMs: number;
    firstGeneratedAt?: number;
    lastGeneratedAt?: number;
    byDay: Record<string, IDayStat>;
    byWorkflow: Record<string, IWorkflowStat>;
    bySection: Record<string, ISectionStat>;
}

const DEFAULT_DATA_DIR = path.join(process.cwd(), "data");

function localDateKey(ts: number): string {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
}

/**
 * 使用统计：磁盘持久化到 data/stats.json，单进程自托管场景下用内存缓存 + 写盘。
 */
class StatsService {
    private filePath: string;
    private cache: IStatsData | undefined;

    constructor() {
        this.filePath = path.join(process.env.DATA_DIR || DEFAULT_DATA_DIR, "stats.json");
    }

    private empty(): IStatsData {
        return {
            totalGenerations: 0,
            totalImages: 0,
            totalElapsedMs: 0,
            byDay: {},
            byWorkflow: {},
            bySection: {},
        };
    }

    private async load(): Promise<IStatsData> {
        if (this.cache) return this.cache;
        let data: IStatsData;
        try {
            const raw = await fs.readFile(this.filePath, "utf8");
            const parsed = JSON.parse(raw);
            data = { ...this.empty(), ...parsed };
        } catch {
            data = this.empty();
        }
        this.cache = data;
        return data;
    }

    private async persist(data: IStatsData): Promise<void> {
        this.cache = data;
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), "utf8");
    }

    async getStats(): Promise<IStatsData> {
        return this.load();
    }

    /** 记录一次成功生成 */
    async recordGeneration(params: {
        workflowId?: string;
        title?: string;
        sectionName?: string;
        imageCount: number;
        elapsedMs: number;
    }): Promise<void> {
        const data = await this.load();
        const now = Date.now();
        const today = localDateKey(now);
        const images = Math.max(0, params.imageCount);
        const elapsed = Math.max(0, params.elapsedMs);

        data.totalGenerations += 1;
        data.totalImages += images;
        data.totalElapsedMs += elapsed;
        data.firstGeneratedAt = data.firstGeneratedAt ?? now;
        data.lastGeneratedAt = now;

        const day = data.byDay[today] ?? { count: 0, images: 0, elapsedMs: 0 };
        day.count += 1;
        day.images += images;
        day.elapsedMs += elapsed;
        data.byDay[today] = day;

        const workflowKey = params.workflowId || params.title || "unknown";
        const wf = data.byWorkflow[workflowKey] ?? {
            workflowId: params.workflowId || "",
            title: params.title || "未知工作流",
            sectionName: params.sectionName || "",
            count: 0,
            images: 0,
            lastUsedAt: 0,
        };
        wf.count += 1;
        wf.images += images;
        wf.lastUsedAt = now;
        if (params.title) wf.title = params.title;
        if (params.sectionName) wf.sectionName = params.sectionName;
        data.byWorkflow[workflowKey] = wf;

        if (params.sectionName) {
            const sec = data.bySection[params.sectionName] ?? { count: 0, images: 0 };
            sec.count += 1;
            sec.images += images;
            data.bySection[params.sectionName] = sec;
        }

        await this.persist(data);
    }
}

export const statsService = new StatsService();
