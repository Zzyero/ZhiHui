import { ComfyWorkflowError } from '@/app/models/errors';
import { ComfyUIConnRefusedError } from '@/app/constants';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import mime from 'mime-types';

type ComfyUIWSEventType = "status" | "executing" | "execution_cached" | "progress" | "executed" | "execution_error" | "execution_success" | "execution_interrupted" | "execution_cancelled";

interface IComfyUIWSEventData {
    type: ComfyUIWSEventType;
    data: { [key: string]: unknown };
}

export interface IComfyProgressEvent {
    type: ComfyUIWSEventType;
    promptId: string;
    /** progress 事件带 { value, max } */
    value?: number;
    max?: number;
    /** executing / executed 事件带 node 字符串 */
    node?: string;
    /** execution_error 事件带错误信息 */
    errorMessage?: string;
}

/** 队列状态信息 */
export interface IComfyQueueStatus {
    queueRemaining: number;
    /** 当前正在执行的任务数（通常为 0 或 1） */
    currentlyRunning: number;
}

export interface IComfyUINodeError {
    type: string;
    message: string;
}

export interface IComfyUIError {
    message: string;
    node_errors: { [key: number]: IComfyUINodeError[] }
}

export class ComfyImageOutputFile {
    public fileName: string;
    public subFolder: string;
    public outputType: string;

    constructor({ fileName, subFolder, outputType }: { fileName: string, subFolder: string, outputType: string }) {
        this.fileName = fileName;
        this.subFolder = subFolder;
        this.outputType = outputType;
    }
}

/** 根据文件扩展名推断 MIME 类型 */
export function getMimeType(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    const extensionMap: Record<string, string> = {
        '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
        '.avi': 'video/x-msvideo', '.mov': 'video/quicktime',
        '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
    };
    if (extensionMap[ext]) return extensionMap[ext];
    const lookedUp = mime.lookup(fileName);
    if (lookedUp) return lookedUp;
    return 'application/octet-stream';
}

export class ComfyUIAPIService {
    private baseUrl: string;
    private ws: WebSocket;
    private clientId: string;
    private promptId: string | undefined = undefined;
    private isPromptRunning: boolean;
    private workflowStatus: ComfyUIWSEventType | undefined;
    private secure: boolean;
    private httpBaseUrl: string;
    private wsBaseUrl: string;
    private outputFiles: Array<{ [key: string]: string }>;
    private comfyExecutionError: { [key: string]: any } | undefined;
    private workflowCompletionPromise: {
        resolve: (value: unknown) => void;
        reject: (reason?: unknown) => void;
    } | undefined;
    /** 进度事件 emitter：监听 'progress' 事件拿到所有 ComfyUI WS 事件 */
    private progressEmitter: EventEmitter;
    /** 队列状态 emitter：监听 'queue' 事件拿到队列状态变化 */
    private queueEmitter: EventEmitter;
    /** 当前 prompt 开始时间，用于计算总耗时 */
    private currentPromptStartedAt: number | undefined;
    /** 当前队列状态 */
    private queueStatus: IComfyQueueStatus = { queueRemaining: 0, currentlyRunning: 0 };

    constructor(clientId: string) {
        this.secure = process.env.COMFYUI_SECURE === "true";
        this.httpBaseUrl = this.secure ? "https://" : "http://";
        this.wsBaseUrl = this.secure ? "wss://" : "ws://";
        this.baseUrl = process.env.COMFYUI_API_URL || "127.0.0.1:8188";
        this.clientId = clientId;
        this.comfyExecutionError = undefined;
        try {
            this.ws = new WebSocket(`${this.getUrl("ws")}/ws?clientId=${this.clientId}`);
            this.connect();
        } catch (error) {
            console.error(error);
            throw error;
        }
        this.isPromptRunning = false;
        this.workflowStatus = undefined;
        this.outputFiles = [];
        this.progressEmitter = new EventEmitter();
        this.queueEmitter = new EventEmitter();
    }

    private getUrl(protocol: "http" | "ws") {
        if (protocol === "http") {
            return `${this.httpBaseUrl}${this.baseUrl}`;
        }
        return `${this.wsBaseUrl}${this.baseUrl}`;
    }

    private async connect() {
        try {
            this.ws.onopen = () => {
                console.log("WebSocket connection opened");
            };

            this.ws.onmessage = (event) => {
                // ComfyUI 会通过 WS 推送二进制预览图（Blob/ArrayBuffer），只处理文本 JSON 事件
                if (typeof event.data === "string") {
                    this.comfyEventDataHandler(event.data);
                }
            };
        } catch (error) {
            console.error(error);
            throw new Error("WebSocket connection error");
        }
    }

    private comfyEventDataHandler(eventData: string) {
        let event: IComfyUIWSEventData | undefined;
        try {
            event = JSON.parse(eventData) as IComfyUIWSEventData;
        } catch (error) {
            console.log("Error parsing event data:", eventData);
            console.error(error);
            return;
        }

        // 处理队列状态事件（status 事件包含全局队列信息，不应被过滤）
        if (event.type === "status") {
            this.handleStatusEvent(event);
            return;
        }

        const data = event.data as object;
        // Skip any messages that aren't about our prompt
        if ("prompt_id" in data && data.prompt_id !== this.promptId) {
            return true;
        }

        // 准备要 emit 的事件 payload（没有 promptId 时不 emit，避免噪音）
        if (this.promptId) {
            const emit = (payload: Partial<IComfyProgressEvent>) => {
                const fullEvent = {
                    type: event!.type,
                    promptId: this.promptId!,
                    ...payload,
                };
                appendProgressEvent(fullEvent);
                this.progressEmitter.emit("progress", fullEvent);
            };

            switch (event.type) {
                case "executing":
                    this.workflowStatus = event.type;
                    emit({ node: event.data?.node as string | undefined });
                    break;
                case "progress":
                    this.workflowStatus = event.type;
                    emit({
                        value: event.data?.value as number | undefined,
                        max: event.data?.max as number | undefined,
                    });
                    break;
                case "executed":
                    console.log("Executed:", event.data);
                    this.parseOutputFiles(event.data);
                    this.workflowStatus = event.type;
                    emit({ node: event.data?.node as string | undefined });
                    break;
                case "execution_error":
                    this.isPromptRunning = false;
                    this.workflowStatus = event.type;
                    this.comfyExecutionError = event.data;
                    emit({
                        errorMessage: event.data?.exception_message as string | undefined,
                    });
                    if (this.workflowCompletionPromise) {
                        this.workflowCompletionPromise.resolve(true);
                        this.workflowCompletionPromise = undefined;
                    }
                    break;
                case "execution_success":
                    this.isPromptRunning = false;
                    this.workflowStatus = event.type;
                    if (this.workflowCompletionPromise) {
                        this.workflowCompletionPromise.resolve(true);
                        this.workflowCompletionPromise = undefined;
                    }
                    emit({});
                    break;
                case "execution_interrupted":
                case "execution_cancelled":
                    // 中断/取消：也要 resolve completion，避免串行队列卡死
                    this.isPromptRunning = false;
                    this.workflowStatus = event.type;
                    if (this.workflowCompletionPromise) {
                        this.workflowCompletionPromise.resolve(true);
                        this.workflowCompletionPromise = undefined;
                    }
                    break;
                default:
                    this.workflowStatus = event.type;
                    break;
            }
        } else {
            // 没有提示 promptId 时的原本逻辑（保留以兼容）
            switch (event.type) {
                case "executing":
                    this.workflowStatus = event.type;
                    break;
                case "execution_cached":
                    this.workflowStatus = event.type;
                    break;
                case "progress":
                    this.workflowStatus = event.type;
                    break;
                case "executed":
                    console.log("Executed:", event.data);
                    this.parseOutputFiles(event.data);
                    this.workflowStatus = event.type;
                    break;
                case "execution_error":
                    this.isPromptRunning = false;
                    this.workflowStatus = event.type;
                    this.comfyExecutionError = event.data;
                    if (this.workflowCompletionPromise) {
                        this.workflowCompletionPromise.resolve(true);
                        this.workflowCompletionPromise = undefined;
                    }
                    break;
                case "execution_success":
                    this.isPromptRunning = false;
                    this.workflowStatus = event.type;
                    if (this.workflowCompletionPromise) {
                        this.workflowCompletionPromise.resolve(true);
                        this.workflowCompletionPromise = undefined;
                    }
                    break;
                default:
                    this.workflowStatus = event.type;
                    break;
            }
        }
    }

    /** 处理 status 事件，提取队列状态 */
    private handleStatusEvent(event: IComfyUIWSEventData) {
        const data = event.data as {
            status?: {
                exec_info?: {
                    queue_remaining?: number;
                    queue_in_progress?: number;
                };
            };
        };

        const execInfo = data?.status?.exec_info;
        if (execInfo) {
            const newStatus: IComfyQueueStatus = {
                queueRemaining: execInfo.queue_remaining ?? 0,
                currentlyRunning: execInfo.queue_in_progress ?? 0,
            };

            // 只有状态变化时才 emit
            if (newStatus.queueRemaining !== this.queueStatus.queueRemaining ||
                newStatus.currentlyRunning !== this.queueStatus.currentlyRunning) {
                this.queueStatus = newStatus;
                this.queueEmitter.emit("queue", this.queueStatus);
                console.log(`[Queue] Remaining: ${this.queueStatus.queueRemaining}, Running: ${this.queueStatus.currentlyRunning}`);
            }
        }
        this.workflowStatus = event.type;
    }

    /** 订阅进度事件（ComfyUI 推送，promptId 已过滤） */
    public onProgress(listener: (event: IComfyProgressEvent) => void) {
        this.progressEmitter.on("progress", listener);
    }

    /** 取消订阅 */
    public offProgress(listener: (event: IComfyProgressEvent) => void) {
        this.progressEmitter.off("progress", listener);
    }

    /** 订阅队列状态事件 */
    public onQueueChange(listener: (status: IComfyQueueStatus) => void) {
        this.queueEmitter.on("queue", listener);
    }

    /** 取消订阅队列状态事件 */
    public offQueueChange(listener: (status: IComfyQueueStatus) => void) {
        this.queueEmitter.off("queue", listener);
    }

    /** 获取当前队列状态（同步） */
    public getQueueStatus(): IComfyQueueStatus {
        return { ...this.queueStatus };
    }

    /** 当前 prompt 启动时间（ms） */
    public getCurrentPromptStartedAt(): number | undefined {
        return this.currentPromptStartedAt;
    }

    /** 当前 promptId */
    public getCurrentPromptId(): string | undefined {
        return this.promptId;
    }

    /** 计算当前 prompt 已耗时（ms） */
    public getCurrentPromptElapsedMs(): number | undefined {
        if (this.currentPromptStartedAt === undefined) return undefined;
        return Date.now() - this.currentPromptStartedAt;
    }


    public async queuePrompt(workflow: object) {
        // 记录开始时间（用于外层计算总耗时）
        this.currentPromptStartedAt = Date.now();
        const data = {
            "prompt": workflow,
            "client_id": this.clientId,
        }
        try {
            const response = await fetch(`${this.getUrl("http")}/prompt`, {
                method: 'POST',
                body: JSON.stringify(data),
                headers: {
                    "Content-Type": "application/json",
                },
            });
            if (!response.ok) {

                let resError: IComfyUIError | string;
                try {
                    const responseError = await response.json();
                    if (responseError.error?.message) {
                        resError = {
                            message: responseError.error.message,
                            node_errors: responseError.node_errors || [],
                        }
                    } else {
                        resError = responseError;
                    }
                } catch (error) {
                    console.error("cannot parse response", error);
                    throw error;
                }
                console.error(resError);
                throw resError;

            }

            if (!response.body) {
                throw new Error("No response body");
            }

            const responseData = await response.json();

            if (responseData.hasOwnProperty("node_errors") && Object.keys(responseData.node_errors).length > 0) {
                const resError: IComfyUIError = {
                    message: "Something went wrong executing your workflow",
                    node_errors: responseData.node_errors,
                }
                throw resError;
            }


            this.promptId = responseData.prompt_id;

            if (this.promptId === undefined) {
                throw new Error("Prompt ID is undefined");
            }

            this.isPromptRunning = true;
            this.comfyExecutionError = undefined; // Reset error before new prompt
            this.workflowStatus = undefined;     // Reset status before new prompt
            this.outputFiles = [];               // Reset output files

            // Create a new promise and store its resolve/reject methods
            const completionPromise = new Promise((resolve, reject) => {
                this.workflowCompletionPromise = { resolve, reject };
            });

            await completionPromise; // Wait for the workflow to complete

            if (this.workflowStatus === "execution_error") {
                const errorMessage =                    (this.comfyExecutionError && "exception_message" in this.comfyExecutionError)
                        ? (this.comfyExecutionError as { exception_message?: string }).exception_message
                        : undefined;
                const nodeType =
                    (this.comfyExecutionError && "node_type" in this.comfyExecutionError)
                        ? (this.comfyExecutionError as { node_type?: string }).node_type
                        : undefined;

                let errorMsg =
                    errorMessage ||
                    "Something went wrong while your workflow was executing";
                
                if (nodeType) {
                    errorMsg = `${nodeType}: ${errorMsg}`;
                }

                throw new ComfyWorkflowError({
                    message: "ComfyUI workflow execution error",
                    errors: [errorMsg]
                });
            }
            return { outputFiles: this.outputFiles, promptId: this.promptId };

             
        } catch (error: any) {
            console.error(error);
            if (error?.cause?.code === "ECONNREFUSED") {
                throw new ComfyWorkflowError({
                    message: "Cannot connect to ComfyUI",
                    errors: [ComfyUIConnRefusedError(this.getUrl("http"))]
                });
            }
            throw error;
        }
    }

    /**
     * 启动一个 prompt：发送 /prompt 请求并立即返回 promptId（不等 execution 完成）。
     * 完成监听通过 emitter；调用方后续可用 waitForCompletion 阻塞直到结束。
     */
    public async startQueuePrompt(workflow: object): Promise<string> {
        this.currentPromptStartedAt = Date.now();
        const data = {
            "prompt": workflow,
            "client_id": this.clientId,
        };
        try {
            const response = await fetch(`${this.getUrl("http")}/prompt`, {
                method: 'POST',
                body: JSON.stringify(data),
                headers: {
                    "Content-Type": "application/json",
                },
            });
            if (!response.ok) {
                let resError: IComfyUIError | string;
                try {
                    const responseError = await response.json();
                    if (responseError.error?.message) {
                        resError = {
                            message: responseError.error.message,
                            node_errors: responseError.node_errors || [],
                        };
                    } else {
                        resError = responseError;
                    }
                } catch (error) {
                    console.error("cannot parse response", error);
                    throw error;
                }
                console.error(resError);
                throw resError;
            }

            if (!response.body) {
                throw new Error("No response body");
            }

            const responseData = await response.json();
            if (responseData.hasOwnProperty("node_errors") && Object.keys(responseData.node_errors).length > 0) {
                const resError: IComfyUIError = {
                    message: "Something went wrong executing your workflow",
                    node_errors: responseData.node_errors,
                };
                throw resError;
            }

            this.promptId = responseData.prompt_id;
            if (this.promptId === undefined) {
                throw new Error("Prompt ID is undefined");
            }

            this.isPromptRunning = true;
            this.comfyExecutionError = undefined;
            this.workflowStatus = undefined;
            // 重置单例的 outputs 数组，避免上次残留
            this.outputFiles = [];
            // 完成信号由后续 waitForCompletion() 挂载并阻塞等待；此处仅重置，避免残留上一个 prompt 的 promise。
            this.workflowCompletionPromise = undefined;

            return this.promptId;
        } catch (error: any) {
            console.error(error);
            if (error?.cause?.code === "ECONNREFUSED") {
                throw new ComfyWorkflowError({
                    message: "Cannot connect to ComfyUI",
                    errors: [ComfyUIConnRefusedError(this.getUrl("http"))]
                });
            }
            throw error;
        }
    }

    /**
     * 等待当前 prompt 完成（promise 在 execution_success/error 时 resolve）。
     * 返回 { outputFiles, status }。
     */
    public async waitForCompletion(): Promise<{ outputFiles: Array<{ [key: string]: string }>; status: ComfyUIWSEventType | undefined }> {
        const completionPromise = new Promise<ComfyUIWSEventType | undefined>((resolve) => {
            this.workflowCompletionPromise = {
                resolve: () => resolve(this.workflowStatus),
                reject: () => {},
            };
        });
        await completionPromise;
        return { outputFiles: this.outputFiles, status: this.workflowStatus };
    }

    public async getOutputFiles({ file }: { file: { [key: string]: string } }) {

        const data = new URLSearchParams({ ...file }).toString();

        try {
            const response = await fetch(`${this.getUrl("http")}/view?${data}`);
            if (!response.ok) {
                if (response.status === 404) {
                    const fileName = file.filename || "";
                    throw new ComfyWorkflowError({
                        message: "File not found",
                        errors: [`The file ${fileName} was not found in the ComfyUI output directory`]
                    });
                }
                const responseError = await response.json();
                throw responseError;
            }

            const blob = await response.blob();
            return new File([blob], file.filename, { type: getMimeType(file.filename) });

             
        } catch (error: any) {
            console.error(error);
            if (error?.cause?.code === "ECONNREFUSED") {
                throw new ComfyWorkflowError({
                    message: "Cannot connect to ComfyUI",
                    errors: [ComfyUIConnRefusedError(this.getUrl("http"))]
                });
            }
            throw error;
        }
    }

    private parseOutputFiles(data: { [key: string]: unknown }) {
        if (!data.output) {
            return
        }

        const output = data.output as { [key: string]: unknown } | undefined;
        for (const key in output) {
             
            for (const dict of output[key] as any[]) {
                // 只保留图片/视频等输出对象（带 type 字段），跳过文本节点输出的字符串
                if (dict && typeof dict === "object" && (dict as any).type !== "temp") {
                    this.outputFiles.push(dict)
                }
            }
        }
    }

    public async uploadMask(params: {
        maskFile: File,
        maskFileName: string,
        originalFileRef: string,
    }) {
        const { maskFile, maskFileName, originalFileRef } = params;
        const formData = new FormData()
        formData.append('image', maskFile, maskFileName)
        formData.append(
            'original_ref',
            JSON.stringify({
                "filename": originalFileRef,
                "subfolder": "clipspace",
                "type": "input",
            })
        )
        formData.append('type', 'input')
        formData.append('subfolder', 'clipspace')
        const response = await fetch(`${this.getUrl("http")}/upload/mask`, {
            method: 'POST',
            body: formData,
        });
        if (!response.ok) {

            let resError: IComfyUIError | string;
            try {
                const responseError = await response.json();
                if (responseError.error?.message) {
                    resError = {
                        message: responseError.error.message,
                        node_errors: responseError.node_errors || [],
                    }
                } else {
                    resError = responseError;
                }
            } catch (error) {
                console.error("cannot parse response", error);
                throw error;
            }
            console.error(resError);
            throw resError;

        }

        if (!response.body) {
            throw new Error("No response body");
        }

        return await response.json();

    }

    public async uploadImage(params: {
        imageFile: File,
        imageFileName: string,
        originalFileRef: string,
    }) {
        const { imageFile, imageFileName, originalFileRef } = params;
        const formData = new FormData()
        formData.append('image', imageFile, imageFileName)
        formData.append(
            'original_ref',
            JSON.stringify({
                "filename": originalFileRef,
                "subfolder": "",
                "type": "input",
            })
        )
        formData.append('type', 'input')
        formData.append('subfolder', 'clipspace')
        const response = await fetch(`${this.getUrl("http")}/upload/image`, {
            method: 'POST',
            body: formData,
        });
        if (!response.ok) {

            let resError: IComfyUIError | string;
            try {
                const responseError = await response.json();
                if (responseError.error?.message) {
                    resError = {
                        message: responseError.error.message,
                        node_errors: responseError.node_errors || [],
                    }
                } else {
                    resError = responseError;
                }
            } catch (error) {
                console.error("cannot parse response", error);
                throw error;
            }
            console.error(resError);
            throw resError;

        }

        if (!response.body) {
            throw new Error("No response body");
        }

        return await response.json();

    }

    /** 上传文件到 ComfyUI 的 input 目录，返回文件名 */
    public async uploadToInput(file: File, fileName: string): Promise<string> {
        const formData = new FormData();
        formData.append('image', file, fileName);
        formData.append('type', 'input');
        formData.append('subfolder', '');
        formData.append('overwrite', 'true');

        const response = await fetch(`${this.getUrl("http")}/upload/image`, {
            method: 'POST', body: formData,
        });
        if (!response.ok) throw new Error(`ComfyUI 上传失败: ${response.status}`);
        const result = await response.json();
        return result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
    }

    /**
     * 取消指定的 prompt
     * - status='running'：中断当前正在执行的 task（POST /interrupt）
     * - status='queued'（默认）：从队列中删除尚未执行的任务（POST /queue { delete: [...] }）
     */
    public async cancelPrompt(promptId: string, status?: string): Promise<void> {
        try {
            if (status === "running") {
                console.log(`[Queue] Interrupting running prompt ${promptId} via POST /interrupt`);
                const response = await fetch(`${this.getUrl("http")}/interrupt`, {
                    method: 'POST',
                });
                if (!response.ok) {
                    throw new Error(`Failed to interrupt prompt: ${response.status}`);
                }
                console.log(`[Queue] Prompt ${promptId} interrupted`);

                // 兜底：立即 resolve completion，避免 waitForCompletion 挂起导致串行队列卡死
                // （部分 ComfyUI 版本中断后不 emit execution_success/error/interrupted）
                if (this.workflowCompletionPromise) {
                    this.isPromptRunning = false;
                    this.workflowStatus = "execution_interrupted";
                    this.workflowCompletionPromise.resolve(true);
                    this.workflowCompletionPromise = undefined;
                }
            } else {
                console.log(`[Queue] Deleting queued prompt ${promptId} via POST /queue`);
                // ComfyUI 删除排队任务：POST /queue { delete: [...] }
                const response = await fetch(`${this.getUrl("http")}/queue`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        delete: [promptId],
                    }),
                });
                if (!response.ok) {
                    throw new Error(`Failed to cancel prompt: ${response.status}`);
                }
                const responseText = await response.text();
                console.log(`[Queue] Prompt ${promptId} cancel response: ${responseText}`);
            }

            // 取消后立即刷新队列状态
            this.fetchQueueStatus();
        } catch (error) {
            console.error("Failed to cancel prompt:", error);
            throw error;
        }
    }

    /** 获取队列状态（取消/中断后刷新缓存用） */
    private async fetchQueueStatus(): Promise<void> {
        try {
            const response = await fetch(`${this.getUrl("http")}/queue`);
            if (response.ok) {
                const data = await response.json();
                const pending = data?.queue_pending?.length ?? 0;
                const running = data?.queue_running?.length ?? 0;
                const newStatus: IComfyQueueStatus = {
                    queueRemaining: pending,
                    currentlyRunning: running,
                };
                if (newStatus.queueRemaining !== this.queueStatus.queueRemaining ||
                    newStatus.currentlyRunning !== this.queueStatus.currentlyRunning) {
                    this.queueStatus = newStatus;
                    this.queueEmitter.emit("queue", this.queueStatus);
                    console.log(`[Queue] Refreshed - Remaining: ${this.queueStatus.queueRemaining}, Running: ${this.queueStatus.currentlyRunning}`);
                }
            }
        } catch (error) {
            console.error("Failed to fetch queue status:", error);
        }
    }
}

// 进程级单例：所有路由共用同一个 ComfyUIAPIService（共用 WS 订阅）
let _instance: ComfyUIAPIService | undefined;
export function getComfyUIAPIService(): ComfyUIAPIService {
    if (!_instance) {
        _instance = new ComfyUIAPIService(crypto.randomUUID());
    }
    return _instance;
}

/** 进程级 progress 事件历史：promptId 启动时清空，事件来了 push。 */
const progressLog = new Map<string, IComfyProgressEvent[]>();

/** 记录一个 prompt 的启动（清空历史） */
export function startProgressLog(promptId: string) {
    progressLog.set(promptId, []);
}

/** 推一条 progress 事件到历史（由 ComfyUIAPIService.emit 调用） */
export function appendProgressEvent(event: IComfyProgressEvent) {
    const list = progressLog.get(event.promptId);
    if (list) {
        list.push(event);
    }
}

/** 读取一个 prompt 的历史（只读拷贝） */
export function getProgressLog(promptId: string): IComfyProgressEvent[] {
    return [...(progressLog.get(promptId) ?? [])];
}

/** 清理一个 prompt 的历史（可选，避免无限增长） */
export function clearProgressLog(promptId: string) {
    progressLog.delete(promptId);
}
