import { loadBalancerService, type IBackendConfig } from "@/app/services/load-balancer-service";
import { comfyProcessManager, type IProcessInfo } from "@/app/services/comfy-process-manager";
import { GenerationQueue } from "@/app/services/generation-queue";
import { getComfyUIAPIServiceForUrl, type ComfyUIAPIService } from "@/app/services/comfyui-api-service";

export interface IActiveBackend {
    config: IBackendConfig;
    url: string;
    service: ComfyUIAPIService;
    queue: GenerationQueue;
    process: IProcessInfo;
}

interface IPromptRouting {
    backendId: string;
    realPromptId?: string;
}

/**
 * 调度注册表：维护"启用且运行中"的实例清单，负责选卡、每卡排队、以及 promptId 到实例的映射。
 */
class BackendRegistry {
    private queues = new Map<string, GenerationQueue>();
    private promptRouting = new Map<string, IPromptRouting>();

    private queueFor(id: string): GenerationQueue {
        let queue = this.queues.get(id);
        if (!queue) {
            queue = new GenerationQueue();
            this.queues.set(id, queue);
        }
        return queue;
    }

    /** 返回启用且进程运行中的实例（按配置顺序） */
    async getActiveBackends(): Promise<IActiveBackend[]> {
        await comfyProcessManager.init();
        await comfyProcessManager.waitForAnyRunning(60_000);

        const config = await loadBalancerService.getConfig();
        const result: IActiveBackend[] = [];
        for (const b of config.backends) {
            if (!b.enabled) continue;
            const process = comfyProcessManager.getStatus(b.gpuIndex);
            if (process.status !== "running") continue;
            const url = `127.0.0.1:${b.port}`;
            result.push({
                config: b,
                url,
                service: getComfyUIAPIServiceForUrl(url),
                queue: this.queueFor(b.id),
                process,
            });
        }
        return result;
    }

    /** 选卡：空闲优先，全忙给第一个；总开关关闭时固定第一个 */
    async pickBackend(): Promise<IActiveBackend> {
        const config = await loadBalancerService.getConfig();
        const backends = await this.getActiveBackends();
        if (backends.length === 0) {
            throw new Error("没有可用的 ComfyUI 实例，请先在管理页启动至少一张显卡");
        }
        if (!config.enabled) {
            return backends[0];
        }
        for (const b of backends) {
            if (b.queue.isIdle()) return b;
        }
        return backends[0];
    }

    enqueue(backend: IActiveBackend, id: string, run: () => Promise<void>): Promise<"completed" | "cancelled"> {
        return backend.queue.enqueue(id, run);
    }

    registerPrompt(promptId: string, backend: IActiveBackend): void {
        this.promptRouting.set(promptId, { backendId: backend.config.id });
    }

    setRealPromptId(promptId: string, realPromptId: string): void {
        const routing = this.promptRouting.get(promptId);
        if (routing) routing.realPromptId = realPromptId;
    }

    getRouting(promptId: string): IPromptRouting | undefined {
        return this.promptRouting.get(promptId);
    }

    unregisterPrompt(promptId: string): void {
        this.promptRouting.delete(promptId);
    }

    /** 在所有实例的本地队列中取消排队任务；返回是否取消成功 */
    cancelLocal(id: string): boolean {
        for (const queue of this.queues.values()) {
            if (queue.cancel(id)) return true;
        }
        return false;
    }

    async getBackendById(id: string): Promise<IActiveBackend | undefined> {
        const backends = await this.getActiveBackends();
        return backends.find((b) => b.config.id === id);
    }
}

export const backendRegistry = new BackendRegistry();
