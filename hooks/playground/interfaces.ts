import { IViewComfy } from "@/app/interfaces/comfy-input";

export interface IPlaygroundParams {
    viewComfy: IViewComfy,
    workflow?: object,
    viewcomfyEndpoint?: string | null,
    /** 客户端生成的本地 promptId，用于服务端串行队列登记与取消排队任务 */
    clientPromptId?: string,
    /** 用于取消/中断请求 */
    signal?: AbortSignal,
}

export interface IUsePostPlayground extends IPlaygroundParams {
    onSuccess: (params: { promptId: string, outputs: File[], totalElapsedMs?: number }) => void,
    onError: (error: any) => void,
    /** 任务被取消时回调（本地出队/中断） */
    onCancel?: () => void,
    /**
     * 实时进度回调。type 可能是: started / progress / executing / executed / cancelled / error
     */
    onProgress?: (event: {
        type: string,
        value?: number,
        max?: number,
        currentNode?: string,
        promptId?: string,
        errorMessage?: string,
    }) => void,
}
