import path from "node:path";
import type { IComfyInput } from "@/app/interfaces/comfy-input";
import { ComfyWorkflow } from "@/app/models/comfy-workflow";
import fs from "node:fs/promises";
import { ComfyErrorHandler } from "@/app/helpers/comfy-error-handler";
import { ComfyError, ComfyWorkflowError } from "@/app/models/errors";
import { ComfyUIAPIService, type IComfyProgressEvent, getMimeType } from "@/app/services/comfyui-api-service";
import { missingViewComfyFileError, viewComfyFileName } from "@/app/constants";
import { SettingsService } from "@/app/services/settings-service";

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

        if (!workflow) {
            workflow = await this.getLocalWorkflow();
        }

        const comfyWorkflow = new ComfyWorkflow(workflow);
        await comfyWorkflow.setViewComfy(args.viewComfy.inputs, this.comfyUIAPIService);

        try {
            // 1. 启动 prompt（不等完成），拿到 promptId
            const promptId = await this.comfyUIAPIService.startQueuePrompt(workflow);
            const startedAt = Date.now();

            // 2. 创建 SSE 流（用 ReadableStream 模拟 SSE 协议）
            const encoder = new TextEncoder();
            const send = (controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: unknown) => {
                const dataStr = typeof data === "string" ? data : JSON.stringify(data);
                controller.enqueue(encoder.encode(`event: ${event}\ndata: ${dataStr}\n\n`));
            };
            const apiService = this.comfyUIAPIService;
            const getFileFromComfyOutputDirectory = this.getFileFromComfyOutputDirectory.bind(this);

            const stream = new ReadableStream<Uint8Array>({
                async start(controller) {
                    send(controller, "started", { promptId, startedAt });

                    // 监听 progress
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
                        // 等到完成
                        const result = await apiService.waitForCompletion();
                        const outputFiles = result.outputFiles;
                        const runStatus = result.status;

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

                        // 推 image 帧
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
                                // 推 image 帧（base64 编码的二进制）
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

                        const totalElapsedMs = Date.now() - startedAt;
                        send(controller, "done", { totalElapsedMs, promptId });
                        controller.close();
                    } catch (err) {
                        const msg = err instanceof Error ? err.message : "Internal error";
                        send(controller, "error", { message: msg });
                        controller.close();
                    } finally {
                        apiService.offProgress(onProgress);
                    }
                },
            });

            return { stream, promptId, totalElapsedMs: 0 };
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