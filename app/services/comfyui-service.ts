import path from "node:path";
import type { IComfyInput } from "@/app/interfaces/comfy-input";
import { ComfyWorkflow } from "@/app/models/comfy-workflow";
import fs from "node:fs/promises";
import { ComfyErrorHandler } from "@/app/helpers/comfy-error-handler";
import { ComfyError, ComfyWorkflowError } from "@/app/models/errors";
import { ComfyUIAPIService, type IComfyProgressEvent, getMimeType } from "@/app/services/comfyui-api-service";
import { missingViewComfyFileError, viewComfyFileName } from "@/app/constants";
import { SettingsService } from "@/app/services/settings-service";
import { generationQueue } from "@/app/services/generation-queue";
import { statsService } from "@/app/services/stats-service";

const settingsService = new SettingsService();
export class ComfyUIService {
    private comfyErrorHandler: ComfyErrorHandler;
    private comfyUIAPIService: ComfyUIAPIService;

    constructor(comfyUIAPIService: ComfyUIAPIService) {
        this.comfyErrorHandler = new ComfyErrorHandler();
        this.comfyUIAPIService = comfyUIAPIService;
    }

    async runWorkflow(args: IComfyInput): Promise<{ stream: ReadableStream<Uint8Array>; promptId: string; totalElapsedMs: number }> {
        let workflow = args.workflow;
        const clientPromptId = args.clientPromptId || `vc_${Math.random().toString(16).slice(2)}`;

        if (!workflow) {
            workflow = await this.getLocalWorkflow();
        }

        const comfyWorkflow = new ComfyWorkflow(workflow);
        // 上传输入（图片/遮罩）可并行，不占用串行队列
        await comfyWorkflow.setViewComfy(args.viewComfy.inputs, this.comfyUIAPIService);

        try {
            const encoder = new TextEncoder();
            let isClosed = false;
            const send = (controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: unknown) => {
                if (isClosed) return;
                try {
                    const dataStr = typeof data === "string" ? data : JSON.stringify(data);
                    controller.enqueue(encoder.encode("event: " + event + "\ndata: " + dataStr + "\n\n"));
                } catch {
                    isClosed = true;
                }
            };
            const apiService = this.comfyUIAPIService;
            const getFileFromComfyOutputDirectory = this.getFileFromComfyOutputDirectory.bind(this);

            // 真正执行生成的函数（在队列槽位内运行）
            const runGeneration = async (controller: ReadableStreamDefaultController<Uint8Array>) => {
                let promptId = "";
                let startedAt = 0;

                // 1. 提交到 ComfyUI（此时才是真正开始排队执行）
                promptId = await apiService.startQueuePrompt(workflow);
                startedAt = Date.now();
                send(controller, "started", { promptId, startedAt });

                // 2. 监听进度
                const onProgress = (event: IComfyProgressEvent) => {
                    if (event.promptId !== promptId) return;
                    if (event.type === "progress") {
                        send(controller, "progress", { value: event.value, max: event.max, currentNode: event.node });
                    } else if (event.type === "executing") {
                        send(controller, "executing", { currentNode: event.node });
                    } else if (event.type === "executed") {
                        send(controller, "executed", { currentNode: event.node });
                    } else if (event.type === "execution_error") {
                        send(controller, "error", { message: event.errorMessage });
                    }
                };
                apiService.onProgress(onProgress);

                try {
                    // 3. 等待完成
                    const result = await apiService.waitForCompletion();
                    const outputFiles = result.outputFiles;
                    const runStatus = result.status;

                    // 被中断/取消：不当作错误，直接结束（客户端可能已断开）
                    if (runStatus === "execution_interrupted" || runStatus === "execution_cancelled") {
                        return;
                    }

                    if (outputFiles.length === 0) {
                        throw new ComfyWorkflowError({
                            message: "No output files found",
                            errors: ['Make sure your workflow contains at least one node that saves an output to the ComfyUI output folder. eg. "Save Image" or "Video Combine" from comfyui-videohelpersuite'],
                        });
                    }

                    if (runStatus === "execution_error") {
                        throw new ComfyWorkflowError({
                            message: "ComfyUI workflow execution error",
                            errors: ["Something went wrong while your workflow was executing"],
                        });
                    }

                    // 4. 推 image 帧
                    for (const file of outputFiles) {
                        try {
                            let outputBuffer: File;
                            if (typeof file === "string") {
                                try {
                                    const dict = JSON.parse(file);
                                    if (typeof dict === "object" && dict?.type === "output") {
                                        const filename = dict?.filename || "";
                                        if (filename) {
                                            outputBuffer = await getFileFromComfyOutputDirectory({ fileName: filename });
                                        } else {
                                            throw new Error("Does not have a filename");
                                        }
                                    } else {
                                        throw new Error(`Output has a wrong shape: ${file}`);
                                    }
                                } catch (error) {
                                    console.error(error);
                                    continue;
                                }
                            }
                            else {
                                outputBuffer = await apiService.getOutputFiles({ file });
                            }

                            const mimeType = outputBuffer.type;
                            const fileName = outputBuffer.name;
                            send(controller, "image", {
                                filename: fileName,
                                mimeType,
                                data: Buffer.from(await outputBuffer.arrayBuffer()).toString("base64"),
                            });
                        } catch (error) {
                            console.error("Failed to get output file");
                            console.error(error);
                        }
                    }

                    // 记录使用统计（仅成功生成；异步不阻塞 SSE）
                    statsService.recordGeneration({
                        imageCount: outputFiles.length,
                        elapsedMs: Date.now() - startedAt,
                    }).catch((err) => console.error("Failed to record generation stats", err));

                    const totalElapsedMs = Date.now() - startedAt;
                    send(controller, "done", { totalElapsedMs, promptId });
                } catch (err) {
                    const msg = err instanceof Error ? err.message : "Internal error";
                    send(controller, "error", { message: msg });
                } finally {
                    apiService.offProgress(onProgress);
                }
            };

            const stream = new ReadableStream<Uint8Array>({
                async start(controller) {
                    // 串行队列：轮到自己才真正提交执行；排队中连接保持挂起
                    const outcome = await generationQueue.enqueue(clientPromptId, () => runGeneration(controller));
                    if (outcome === "cancelled") {
                        send(controller, "cancelled", { promptId: clientPromptId });
                    }
                    controller.close();
                    isClosed = true;
                },
                async cancel() {
                    // 客户端断开/刷新时：标记流已关闭，避免后续 WS 进度事件往已关闭的 controller 里写
                    isClosed = true;
                    generationQueue.cancel(clientPromptId);
                },
            });

            return { stream, promptId: clientPromptId, totalElapsedMs: 0 };
        } catch (error: unknown) {
            console.error("Failed to run the workflow");
            console.error({ error });

            if (error instanceof ComfyWorkflowError) {
                throw error;
            }

            const comfyError =
                this.comfyErrorHandler.tryToParseWorkflowError(error);
            if (comfyError) {
                throw comfyError;
            }

            throw new ComfyWorkflowError({
                message: "Error running workflow",
                errors: [
                    "Something went wrong running the workflow, the most common cases are missing nodes and running out of Vram. Make sure that you can run this workflow in your local comfy",
                ],
            });
        }
    }

    private async getLocalWorkflow(): Promise<object> {
        const missingWorkflowError = new ComfyError({
            message: "Failed to launch ComfyUI",
            errors: [missingViewComfyFileError],
        });

        let workflow = undefined;

        try {
            const filePath = path.join(process.cwd(), viewComfyFileName);
            const fileContent = await fs.readFile(filePath, "utf8");
            workflow = JSON.parse(fileContent);
        
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (_error) {
            throw missingWorkflowError;
        }

        if (!workflow) {
            throw missingWorkflowError;
        }

        for (const w of workflow.workflows as { [key: string]: object }[]) {
            for (const key in w) {
                if (key === "workflowApiJSON") {
                    return w[key];
                }
            }
        }

        throw new ComfyWorkflowError({
            message: "Failed to find workflowApiJSON",
            errors: ["Failed to find workflowApiJSON"],
        });
    }

    async getFileFromComfyOutputDirectory({ fileName }: { fileName: string }): Promise<File> {
        const filePath = path.join(settingsService.getComfyOutputDirectory(), fileName);
        const fileContent = await fs.readFile(filePath);
        return new File([fileContent], fileName, { type: getMimeType(fileName) });
    }

}