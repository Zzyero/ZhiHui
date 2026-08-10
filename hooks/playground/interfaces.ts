import { IViewComfy } from "@/app/interfaces/comfy-input";

export interface IPlaygroundParams {
    viewComfy: IViewComfy,
    workflow?: object,
    viewcomfyEndpoint?: string | null,
}

export interface IUsePostPlayground extends IPlaygroundParams {
    onSuccess: (params: { promptId: string, outputs: File[], totalElapsedMs?: number }) => void,
    onError: (error: any) => void,
    /**
     * 实时进度回调。type 可能是: started / progress / executing / executed / error
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
