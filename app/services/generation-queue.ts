/**
 * 进程级生成任务串行队列。
 *
 * 保证同一时刻只有一个任务被提交到 ComfyUI 执行（单飞），其余任务按到达顺序排队。
 * 适用于 `next start` 单进程自托管场景：所有客户端的请求共享同一个队列实例，
 * FIFO 顺序按服务端到达时间排列，跨客户端不串。
 *
 * 注意：这是内存队列，仅单进程有效；若部署为多实例/serverless，需要换外部队列（如 Redis）。
 */

interface QueueJob {
    id: string;
    run: () => Promise<void>;
    cancelled: boolean;
    resolve: (outcome: "completed" | "cancelled") => void;
}

class GenerationQueue {
    private jobs: QueueJob[] = [];
    private running = false;

    /**
     * 入队并串行执行。返回的 promise 在任务完成或被取消时 resolve。
     */
    enqueue(id: string, run: () => Promise<void>): Promise<"completed" | "cancelled"> {
        return new Promise((resolve) => {
            this.jobs.push({ id, run, cancelled: false, resolve });
            this.processNext();
        });
    }

    /**
     * 取消一个排队中的任务（尚未开始执行时）。返回是否成功取消。
     * 已开始运行的任务不在队列中，取消会返回 false（需走 ComfyUI /interrupt）。
     */
    cancel(id: string): boolean {
        for (const job of this.jobs) {
            if (job.id === id) {
                job.cancelled = true;
                job.resolve("cancelled");
                return true;
            }
        }
        return false;
    }

    /** 是否仍在排队中 */
    isPending(id: string): boolean {
        return this.jobs.some((j) => j.id === id);
    }

    private async processNext() {
        if (this.running) return;
        const job = this.jobs.shift();
        if (!job) return;

        this.running = true;
        try {
            if (job.cancelled) {
                job.resolve("cancelled");
            } else {
                await job.run();
                job.resolve("completed");
            }
        } catch {
            // run 内部自行处理错误（发送 error 事件），这里兜底防止卡死队列
            job.resolve("completed");
        } finally {
            this.running = false;
            this.processNext();
        }
    }
}

export const generationQueue = new GenerationQueue();
