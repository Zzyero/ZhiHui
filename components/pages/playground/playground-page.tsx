"use client"

import {
    Settings,
    Download,
    CircleX,
    Play,
    Images
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
    Drawer,
    DrawerContent,
    DrawerTrigger,
} from "@/components/ui/drawer"
import React, { Fragment, useEffect, useState, useCallback, useMemo, useRef } from "react";
import PlaygroundForm from "./playground-form";
import { usePostPlayground } from "@/hooks/playground/use-post-playground";
import { ActionType, type IViewComfy, type IViewComfyWorkflow, useViewComfy, type IQueuedPrompt } from "@/app/providers/view-comfy-provider";
import { ErrorAlertDialog } from "@/components/ui/error-alert-dialog";
import { ApiErrorHandler } from "@/lib/api-error-handler";
import { ResponseError } from "@/app/models/errors";
import BlurFade from "@/components/ui/blur-fade";
import { cn, getComfyUIRandomSeed } from "@/lib/utils";
import { createMediaDragHandler } from "@/lib/drag-utils";
import WorkflowSwitcher from "@/components/workflow-switchter";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PreviewOutputsImageGallery } from "@/components/images-preview"
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { IUsePostPlayground } from "@/hooks/playground/interfaces";
import * as constants from "@/app/constants";
import { ISetResults, S3FilesData } from "@/app/models/prompt-result";
import { Textarea } from "@/components/ui/textarea";
import { SelectableImage } from "@/components/comparison/selectable-image";

import {
    TransformWrapper,
    TransformComponent,
} from "react-zoom-pan-pinch";

export interface IOutput {
    /** 文件名（来自 File.name 或 S3FilesData.filename） */
    filename: string;
    /** MIME（来自 File.type 或 S3FilesData.contentType） */
    contentType: string;
    url: string;
    /** 本地 File 对象（仅当上传/本地生成时存在；S3 场景下为 undefined） */
    file?: File | S3FilesData;
    size: number;
}

interface IGeneration {
    status?: string | undefined;
    outputs: IOutput[],
    errorData?: string | undefined;
    /** 总耗时（毫秒） */
    totalElapsedMs?: number;
}


interface IResults {
    [promptId: string]: IGeneration;
}

const apiErrorHandler = new ApiErrorHandler();

interface IPlaygroundPageContent {
    doPost: (params: IUsePostPlayground) => void;
    loading: boolean;
    setLoading: (loading: boolean) => void;
    sectionName?: string;
}

const getOutputFileName = (output: { filename: string }): string => output.filename;

const getCorrectMimeType = (filename: string): string => {
    const ext = filename.toLowerCase().split('.').pop();
    const mimeMap: Record<string, string> = {
        'mp4': 'video/mp4', 'webm': 'video/webm', 'mkv': 'video/x-matroska',
        'avi': 'video/x-msvideo', 'mov': 'video/quicktime', 'wmv': 'video/x-ms-wmv',
        'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'ogg': 'audio/ogg',
        'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
        'gif': 'image/gif', 'webp': 'image/webp', 'bmp': 'image/bmp',
    };
    return mimeMap[ext || ''] || '';
};

const getOutputContentType = (output: { contentType: string; filename: string }): string => {
    const correctMime = getCorrectMimeType(output.filename);
    return correctMime || output.contentType;
};

function PlaygroundPageContent({ doPost, sectionName }: IPlaygroundPageContent) {
    const { viewComfyState, viewComfyStateDispatcher } = useViewComfy();
    const viewMode = process.env.NEXT_PUBLIC_VIEW_MODE === "true";
    const [errorAlertDialog, setErrorAlertDialog] = useState<{ open: boolean, errorTitle: string | undefined, errorDescription: React.JSX.Element, onClose: () => void }>({ open: false, errorTitle: undefined, errorDescription: <></>, onClose: () => { } });
    const [textOutputEnabled, setTextOutputEnabled] = useState(false);
    const [showOutputFileName, setShowOutputFileName] = useState(false);

    // 当前 section 的 loading 状态（保留字段，队列化后由逐任务卡片替代展示）
    const loading = useMemo(() => {
        if (sectionName) return !!viewComfyState.loadingBySection[sectionName];
        return false;
    }, [sectionName, viewComfyState.loadingBySection]);

    // 每个任务的 AbortController（用于取消排队/运行中的请求）
    const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

    // 当前 section 使用的 workflow（优先使用 section-specific 的，否则用全局的）
    const currentWorkflow = sectionName
        ? viewComfyState.currentViewComfyBySection[sectionName] ?? viewComfyState.currentViewComfy
        : viewComfyState.currentViewComfy;

    // node id -> 友好标题 映射（从 workflow_api 的 _meta.title 读取，用于进度条上方显示当前节点）
    const nodeTitleMap = useMemo(() => {
        const map: Record<string, string> = {};
        const wf = currentWorkflow?.workflowApiJSON as Record<string, { class_type?: string; _meta?: { title?: string } }> | undefined;
        if (wf) {
            for (const id in wf) {
                const title = wf[id]?._meta?.title || wf[id]?.class_type;
                if (title) {
                    map[id] = title;
                }
            }
        }
        return map;
    }, [currentWorkflow]);

    // 当前页（section）的结果集 —— 切页面也保留（升到 Provider）
    const results: IResults = useMemo(() => {
        return (sectionName && viewComfyState.resultsBySection[sectionName]) || {};
    }, [sectionName, viewComfyState.resultsBySection]);

    // 当前 section 的任务队列（按排队时间降序，最新的在最上面）
    const sectionQueue: IQueuedPrompt[] = useMemo(() => {
        const list = viewComfyState.queueBySection[sectionName || "default"] || [];
        return [...list].sort((a, b) => b.queuedAt - a.queuedAt);
    }, [sectionName, viewComfyState.queueBySection]);

    // 按 section 过滤工作流（按标题匹配）
    const filteredViewComfys = useMemo(() => {
        if (!sectionName) return viewComfyState.viewComfys;
        const section = viewComfyState.sections.find((s) => s.name === sectionName);
        if (!section) return [];
        const titles = new Set(section.workflows);
        return viewComfyState.viewComfys.filter((vc) => titles.has(vc.viewComfyJSON.title));
    }, [sectionName, viewComfyState.viewComfys, viewComfyState.sections]);

    // 如果当前 section 选中的工作流不在过滤集合内，自动选第一个
    useEffect(() => {
        if (!sectionName) return;
        if (filteredViewComfys.length === 0) return;
        const current = currentWorkflow;
        const stillVisible = current && filteredViewComfys.some((vc) => vc.viewComfyJSON.id === current.viewComfyJSON.id);
        if (!stillVisible) {
            viewComfyStateDispatcher({
                type: "UPDATE_CURRENT_VIEW_COMFY" as any,
                payload: { viewComfy: filteredViewComfys[0], sectionName },
            });
        }
    }, [sectionName, filteredViewComfys, currentWorkflow, viewComfyStateDispatcher]);

    useEffect(() => {
        if (!viewMode) return;

        const fetchViewComfy = async () => {
            try {
                const response = await fetch("/api/playground", {
                    headers: {
                        "accept": "application/json"
                    }
                });
                if (!response.ok) {
                    const text = await response.text()
                    const data = text ? JSON.parse(text) : {};
                    if (data) {
                        throw data;
                    } else {
                        const err = new ResponseError(data);
                        throw err;
                    }

                }
                const data = await response.json();
                viewComfyStateDispatcher({ type: ActionType.INIT_VIEW_COMFY, payload: data.viewComfyJSON });
            } catch (error: unknown) {
                const typedError = error as ResponseError & { message?: string };
                if (typedError.errorType) {
                    const responseError =
                        apiErrorHandler.apiErrorToDialog(typedError);
                    setErrorAlertDialog({
                        open: true,
                        errorTitle: responseError.title,
                        errorDescription: <>{responseError.description}</>,
                        onClose: () => { },
                    });
                } else {
                    setErrorAlertDialog({
                        open: true,
                        errorTitle: "错误",
                        errorDescription: <>{typedError.message || "未知错误"}</>,
                        onClose: () => { },
                    });
                }
            }
        };
        fetchViewComfy();
    }, [viewMode, viewComfyStateDispatcher]);

    const onSetResults = useCallback(async (params: ISetResults) => {
        const { promptId, status, errorData, localPromptId, totalElapsedMs } = params;
        const outputs = params.outputs || [];
        const resultOutputs: IOutput[] = [];

        for (const output of outputs) {
            let url: string;
            let filename = "";
            let contentType = "";
            if (output instanceof File) {
                try {
                    url = URL.createObjectURL(output);
                } catch (error) {
                    console.error("cannot parse output to URL")
                    console.log({ output });
                    url = "";
                }
                filename = output.name;
                contentType = output.type;
                resultOutputs.push({ filename, contentType, url, size: output.size, file: output });
            } else {
                // S3FilesData: 走 filepath URL
                url = output.filepath;
                filename = output.filename;
                contentType = output.contentType;
                const s3File = new S3FilesData({
                    filename: output.filename,
                    contentType: output.contentType,
                    filepath: output.filepath,
                    size: output.size ?? 0,
                });
                resultOutputs.push({ filename, contentType, url, size: output.size ?? 0, file: s3File });
            }
        }

        // 同步存一份到 provider（按当前 section 隔离），key 用 localPromptId 便于逐任务展示
        const resultKey = localPromptId ?? promptId;
        if (sectionName) {
            viewComfyStateDispatcher({
                type: ActionType.SET_RESULT,
                payload: {
                    sectionName,
                    promptId: resultKey,
                    result: {
                        status,
                        outputs: resultOutputs,
                        errorData,
                        totalElapsedMs,
                    },
                },
            });

            // 标记该 prompt 的进度为 success，并写入总耗时（进度按真实 promptId 记录）
            viewComfyStateDispatcher({
                type: ActionType.SET_PROGRESS_DONE,
                payload: {
                    promptId,
                    totalElapsedMs: totalElapsedMs ?? 0,
                    status: status === "error" ? "error" : "success",
                },
            });
        }
    }, [sectionName, viewComfyStateDispatcher]);

    function onSubmit(data: IViewComfyWorkflow) {
        const inputs: { key: string, value: unknown }[] = [];

        for (const dataInputs of data.inputs) {
            for (const input of dataInputs.inputs) {
                if (input.visibility === undefined || input.visibility !== "deleted") {
                    inputs.push({ key: input.key, value: input.value });
                }

            }
        }

        for (const advancedInput of data.advancedInputs) {
            for (const input of advancedInput.inputs) {
                if (input.visibility === undefined || input.visibility !== "deleted") {
                    inputs.push({ key: input.key, value: input.value });
                }
            }
        }

        const generationData = {
            inputs: inputs,
            textOutputEnabled: data.textOutputEnabled ?? false
        };

        for (const input of generationData.inputs) {
            if (constants.SEED_LIKE_INPUT_VALUES.some(str => input.key.includes(str)) && input.value === Number.MIN_VALUE) {
                const newSeed = getComfyUIRandomSeed();
                input.value = newSeed;
            }
        };

        setTextOutputEnabled(data.textOutputEnabled ?? false);
        setShowOutputFileName(data.showOutputFileName ?? false);

        // 每个任务独立的本地 promptId 与启动时间（闭包内捕获，避免并发任务互相覆盖）
        const localPromptId = crypto.randomUUID();
        const generationStartedAt = Date.now();

        let realPromptId: string | undefined = undefined;
        let lastProgressValue = 0;
        let lastProgressMax = 0;
        let currentNode: string | undefined = undefined;

        // 本任务的 AbortController（取消时触发）
        const controller = new AbortController();
        abortControllersRef.current.set(localPromptId, controller);

        // 加入队列（状态 queued）
        const queuedPrompt: IQueuedPrompt = {
            promptId: localPromptId,
            sectionName: sectionName || "default",
            workflowTitle: currentWorkflow?.viewComfyJSON.title || "Unknown",
            status: 'queued',
            queuedAt: generationStartedAt,
        };
        viewComfyStateDispatcher({
            type: ActionType.ADD_TO_QUEUE,
            payload: { sectionName: sectionName || "default", prompt: queuedPrompt },
        });

        // 进度占位（server started 事件后迁移到 realPromptId）
        viewComfyStateDispatcher({
            type: ActionType.SET_PROGRESS,
            payload: {
                promptId: localPromptId,
                progress: { value: 0, max: 0, startedAt: generationStartedAt, status: "running" },
            },
        });

        const updateTask = (updates: Partial<IQueuedPrompt>) => {
            viewComfyStateDispatcher({
                type: ActionType.UPDATE_QUEUE_ITEM,
                payload: { promptId: localPromptId, updates },
            });
        };

        const doPostParams: IUsePostPlayground = {
            viewComfy: generationData,
            workflow: currentWorkflow?.workflowApiJSON,
            clientPromptId: localPromptId,
            signal: controller.signal,
            workflowId: currentWorkflow?.viewComfyJSON.id,
            workflowTitle: currentWorkflow?.viewComfyJSON.title,
            sectionName: sectionName,
            onSuccess: (params: { promptId: string, outputs: File[], totalElapsedMs?: number }) => {
                onSetResults({ ...params, localPromptId, totalElapsedMs: params.totalElapsedMs });
                updateTask({ status: 'completed', realPromptId: params.promptId || realPromptId });
                abortControllersRef.current.delete(localPromptId);
            },
            onError: (error: any) => {
                viewComfyStateDispatcher({
                    type: ActionType.SET_PROGRESS_DONE,
                    payload: { promptId: realPromptId || localPromptId, totalElapsedMs: Date.now() - generationStartedAt, status: "error" },
                });
                updateTask({ status: 'error' });
                abortControllersRef.current.delete(localPromptId);

                const errorDialog = apiErrorHandler.apiErrorToDialog(error);
                setErrorAlertDialog({
                    open: true,
                    errorTitle: errorDialog.title,
                    errorDescription: <> {errorDialog.description} </>,
                    onClose: () => {
                        setErrorAlertDialog({ open: false, errorTitle: undefined, errorDescription: <></>, onClose: () => { } });
                    }
                });
            },
            onCancel: () => {
                updateTask({ status: 'canceled' });
                viewComfyStateDispatcher({
                    type: ActionType.REMOVE_PROGRESS,
                    payload: { promptId: realPromptId || localPromptId },
                });
                abortControllersRef.current.delete(localPromptId);
            },
            onProgress: (event: { type: string, value?: number, max?: number, currentNode?: string, promptId?: string, errorMessage?: string }) => {
                const rp = event.promptId || realPromptId || localPromptId;
                realPromptId = rp;
                const toNodeLabel = (raw?: string) => (raw ? nodeTitleMap[raw] || raw : undefined);

                if (event.type === "started") {
                    viewComfyStateDispatcher({ type: ActionType.REMOVE_PROGRESS, payload: { promptId: localPromptId } });
                    viewComfyStateDispatcher({
                        type: ActionType.SET_PROGRESS,
                        payload: { promptId: rp, progress: { value: 0, max: 0, startedAt: generationStartedAt, currentNode: undefined, status: "running" } },
                    });
                    updateTask({ status: 'running', startedAt: Date.now(), realPromptId: rp });
                    return;
                }
                if (event.type === "progress") {
                    const v = event.value ?? 0;
                    const m = event.max ?? 0;
                    lastProgressValue = v;
                    lastProgressMax = m;
                    viewComfyStateDispatcher({
                        type: ActionType.SET_PROGRESS,
                        payload: { promptId: rp, progress: { value: v, max: m, startedAt: generationStartedAt, currentNode, status: "running" } },
                    });
                } else if (event.type === "executing" || event.type === "executed") {
                    const label = toNodeLabel(event.currentNode);
                    if (typeof event.currentNode === "string") {
                        currentNode = label;
                    }
                    viewComfyStateDispatcher({
                        type: ActionType.SET_PROGRESS,
                        payload: { promptId: rp, progress: { value: lastProgressValue, max: lastProgressMax, startedAt: generationStartedAt, currentNode: label, status: "running" } },
                    });
                } else if (event.type === "error") {
                    viewComfyStateDispatcher({ type: ActionType.SET_PROGRESS_DONE, payload: { promptId: rp, totalElapsedMs: 0, status: "error" } });
                    updateTask({ status: 'error' });
                }
            },
        };

        doPost(doPostParams);
    }

    const handleAddToGallery = useCallback(async (output: IOutput) => {
        const file = output.file;
        if (!file || !(file instanceof File)) {
            toast.error("该结果没有可保存的图片文件");
            return;
        }
        const formData = new FormData();
        formData.append("image", file, output.filename || file.name);
        formData.append("sectionName", sectionName || "智能生图");
        formData.append("workflowTitle", currentWorkflow?.viewComfyJSON.title || "");
        formData.append("workflowId", currentWorkflow?.viewComfyJSON.id || "");
        try {
            const res = await fetch("/api/gallery", { method: "POST", body: formData });
            if (!res.ok) throw new Error("add failed");
            toast.success("已添加到画廊");
        } catch {
            toast.error("添加到画廊失败");
        }
    }, [sectionName, currentWorkflow]);

    const onSelectChange = (data: IViewComfy) => {
        return viewComfyStateDispatcher({
            type: ActionType.UPDATE_CURRENT_VIEW_COMFY,
            payload: { viewComfy: data, sectionName }
        });
    }

    const onShowErrorDialog = (error: string) => {
        setErrorAlertDialog({
            open: true,
            errorTitle: "错误",
            errorDescription: <> {error} </>,
            onClose: () => {
                setErrorAlertDialog({ open: false, errorTitle: undefined, errorDescription: <></>, onClose: () => { } });
            }
        });
    }

    // Show loading/error state when no app is loaded yet
    const hasViewComfyApp = currentWorkflow !== undefined;

    if (!hasViewComfyApp) {
        return <>
            <div className="flex flex-col h-screen">
                <ErrorAlertDialog open={errorAlertDialog.open} errorTitle={errorAlertDialog.errorTitle} errorDescription={errorAlertDialog.errorDescription} onClose={errorAlertDialog.onClose} />
            </div>
        </>;
    }

    const renderForm = () => {
        if (currentWorkflow) {
            return (
                <PlaygroundForm
                    viewComfyJSON={currentWorkflow.viewComfyJSON}
                    onSubmit={onSubmit}
                    loading={loading}
                />
            );
        }
        return null;
    };

    return (
        <>
            <div className="flex flex-col h-[calc(100vh-var(--top-nav-height))]">
                <div className="md:hidden w-full flex pl-4 gap-x-2">
                    {currentWorkflow && (
                        <WorkflowSwitcher viewComfys={filteredViewComfys} currentViewComfy={currentWorkflow} onSelectChange={onSelectChange} />
                    )}
                    <Drawer>
                        <DrawerTrigger asChild>
                            <Button variant="ghost" size="icon" className="md:hidden self-bottom w-[85px] gap-1">
                                <Settings className="size-4" />
                                设置
                            </Button>
                        </DrawerTrigger>
                        <DrawerContent className="max-h-[80vh] gap-4 px-4 h-full">
                            {renderForm()}
                        </DrawerContent>
                    </Drawer>
                </div>
                <main className="flex overflow-hidden flex-1 gap-0">
                    <div className="relative hidden flex-col w-full max-w-[450px] items-start md:flex flex-shrink-0 overflow-hidden rounded-l-xl bg-muted/50 p-4">
                        <div className="flex flex-col w-full h-full min-h-0 min-w-0 bg-background rounded-xl overflow-hidden border shadow-md">
                            {filteredViewComfys.length > 0 && currentWorkflow && (
                                <div className="px-2 pt-4 w-full">
                                    <WorkflowSwitcher viewComfys={filteredViewComfys} currentViewComfy={currentWorkflow} onSelectChange={onSelectChange} />
                                </div>
                            )}
                            {renderForm()}
                        </div>
                    </div>
                    <div className="relative flex h-full min-h-[50vh] w-full rounded-r-xl bg-muted/50 lg:col-span-2">
                        <ScrollArea className="relative flex h-full w-full flex-1 flex-col">
                            {(sectionQueue.length === 0) && currentWorkflow && (
                                <>  <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-full">
                                    <PreviewOutputsImageGallery viewComfyJSON={currentWorkflow.viewComfyJSON} />
                                </div>
                                </>
                            )}
                            <div className="flex-1 h-full p-4 flex overflow-y-auto">
                                <div className="flex flex-col w-full h-full">
                                    <IndeterminateLoadingBarStyles />
                                    {sectionQueue.map((task, index) => (
                                        <Fragment key={task.promptId}>
                                            <TaskCard
                                                task={task}
                                                progress={task.realPromptId ? viewComfyState.progressByPrompt[task.realPromptId] : undefined}
                                                result={results[task.promptId]}
                                                onShowErrorDialog={onShowErrorDialog}
                                                showOutputFileName={showOutputFileName}
                                                textOutputEnabled={textOutputEnabled}
                                                onAddToGallery={handleAddToGallery}
                                            />
                                            {index !== sectionQueue.length - 1 && <hr className="w-full py-4 border-gray-300" />}
                                        </Fragment>
                                    ))}
                                </div>
                            </div>
                        </ScrollArea>
                    </div>
                </main>
                <ErrorAlertDialog open={errorAlertDialog.open} errorTitle={errorAlertDialog.errorTitle} errorDescription={errorAlertDialog.errorDescription} onClose={errorAlertDialog.onClose} />
            </div>
        </>
    )
}

export default function PlaygroundPage({ sectionName }: { sectionName?: string }) {
    const params = usePostPlayground();
    return (
        <PlaygroundPageContent
            doPost={params.doPost}
            loading={params.loading}
            setLoading={params.setLoading}
            sectionName={sectionName}
        />
    );
}

export function ImageDialog({ output, showOutputFileName, onAddToGallery }: { output: IOutput, showOutputFileName: boolean, onAddToGallery?: (output: IOutput) => void }) {
    const backgroundColor = "black";
    const scaleUp = false;
    const zoomFactor = 8;

    const [container, setContainer] = useState<HTMLDivElement | null>(null);

    const [containerWidth, setContainerWidth] = useState<number>(0);
    const [containerHeight, setContainerHeight] = useState<number>(0);

    const [imageNaturalWidth, setImageNaturalWidth] = useState<number>(0);
    const [imageNaturalHeight, setImageNaturalHeight] = useState<number>(0);

    const imageScale = useMemo((): number => {
        if (
            containerWidth === 0 ||
            containerHeight === 0 ||
            imageNaturalWidth === 0 ||
            imageNaturalHeight === 0
        )
            return 0;
        const scale = Math.min(
            containerWidth / imageNaturalWidth,
            containerHeight / imageNaturalHeight,
        );
        return scaleUp ? scale : Math.max(scale, 1);
    }, [
        scaleUp,
        containerWidth,
        containerHeight,
        imageNaturalWidth,
        imageNaturalHeight,
    ]);

    const handleResize = useCallback(() => {
        if (container !== null) {
            const rect = container.getBoundingClientRect();
            setContainerWidth(rect.width);
            setContainerHeight(rect.height);
        } else {
            setContainerWidth(0);
            setContainerHeight(0);
        }
    }, [container]);

    useEffect(() => {
        handleResize();
        window.addEventListener("resize", handleResize);
        return () => {
            window.removeEventListener("resize", handleResize);
        };
    }, [handleResize]);

    const handleImageOnLoad = (image: HTMLImageElement) => {
        setImageNaturalWidth(image.naturalWidth);
        setImageNaturalHeight(image.naturalHeight);
    };

    useEffect(() => {
        const image = new Image();
        image.onload = () => handleImageOnLoad(image);
        image.onerror = () => {
            console.error('Failed to load image:', output.url);
        };
        image.src = output.url;
    }, [output]);

    return (
        <Dialog>
            <DialogTrigger asChild>
                <img
                    key={output.url}
                    src={output.url}
                    alt={`${output.url}`}
                    className={cn("w-full h-64 object-contain rounded-md transition-all hover:scale-105 hover:cursor-pointer")}
                    draggable="true"
                    onDragStart={createMediaDragHandler({
                        url: output.url,
                        filename: getOutputFileName(output),
                        contentType: getOutputContentType(output)
                    })}
                />
            </DialogTrigger>
            {showOutputFileName && parseFileName(getOutputFileName(output))}
            <DialogContent className="max-w-fit max-h-[90vh] border-0 p-0 bg-transparent [&>button]:bg-background [&>button]:border [&>button]:border-border [&>button]:rounded-full [&>button]:p-1 [&>button]:shadow-md">
                <DialogHeader className="sr-only">
                    <DialogTitle>图片预览</DialogTitle>
                </DialogHeader>
                <div
                    className="rounded-md"
                    style={{
                        width: "100%",
                        height: "100%",
                        cursor: "zoom-in"
                    }}
                    ref={(el: HTMLDivElement | null) => {
                        setContainer(el);
                    }}
                >
                    <TransformWrapper
                        key={`${containerWidth}x${containerHeight}`}
                        initialScale={imageScale}
                        minScale={imageScale}
                        maxScale={imageScale * zoomFactor}
                        centerOnInit
                    >
                        <TransformComponent
                            wrapperStyle={{
                                width: "100%",
                                height: "100%",
                                borderRadius: "8px",
                            }}
                        >
                            <img key={output.url}
                                src={output.url}
                                alt={`${output.url}`}
                                className="max-h-[85vh] w-auto object-contain rounded-md"
                            />
                        </TransformComponent>
                    </TransformWrapper>
                </div>
                <DialogFooter className="bg-transparent">
                    <Button
                        onClick={() => {
                            const link = document.createElement('a');
                            link.href = output.url;
                            link.download = `${output.url.split('/').pop()}`;
                            link.click();
                        }}
                    >下载</Button>
                    {onAddToGallery && (
                        <Button variant="secondary" onClick={() => onAddToGallery(output)}>
                            <Images className="size-4 mr-2" />
                            添加到画廊
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function VideoDialog({ output, showOutputFileName }: { output: IOutput, showOutputFileName?: boolean }) {
    const outputName = getOutputFileName(output);
    const contentType = getOutputContentType(output);
    const [videoLoaded, setVideoLoaded] = React.useState(false);
    const [videoError, setVideoError] = React.useState(false);
    const isVideo = contentType.startsWith('video/');

    return (
        <Dialog>
            <DialogTrigger asChild>
                <div className="relative w-full h-64 group overflow-hidden rounded-md bg-muted">
                    {videoError || !isVideo ? (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                            <Play className="h-8 w-8 text-muted-foreground" />
                            <span className="text-muted-foreground text-xs">{isVideo ? "视频加载失败" : "视频预览"}</span>
                        </div>
                    ) : (
                        <>
                            <video
                                key={output.url}
                                className="w-full h-full object-contain transition-all group-hover:scale-105"
                                muted
                                preload="metadata"
                                playsInline
                                onLoadedData={() => setVideoLoaded(true)}
                                onError={() => setVideoError(true)}
                            >
                                <source src={output.url} />
                            </video>
                            {!videoLoaded && (
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="bg-black/50 rounded-full p-3">
                                        <Play className="h-6 w-6 text-white" />
                                    </div>
                                </div>
                            )}
                            {videoLoaded && (
                                <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-all">
                                    <div className="bg-white/90 rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Play className="h-8 w-8 text-black" />
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </DialogTrigger>
            {showOutputFileName && parseFileName(outputName)}
            <DialogContent className="max-w-fit max-h-[90vh] border-0 p-0 bg-transparent [&>button]:bg-background [&>button]:border [&>button]:border-border [&>button]:rounded-full [&>button]:p-1 [&>button]:shadow-md">
                <DialogHeader className="sr-only">
                    <DialogTitle>视频预览</DialogTitle>
                </DialogHeader>
                {isVideo ? (
                    <>
                        <video
                            key={`dialog-${output.url}`}
                            className="max-h-[85vh] w-auto object-contain rounded-md"
                            controls
                            autoPlay
                            onError={() => setVideoError(true)}
                        >
                            <source src={output.url} />
                        </video>
                        <DialogFooter className="bg-transparent">
                            <Button className="w-full"
                                onClick={() => {
                                    const link = document.createElement('a');
                                    link.href = output.url;
                                    link.download = outputName;
                                    link.click();
                                }}
                            >
                                <Download className="h-4 w-4 mr-2" />
                                下载
                            </Button>
                        </DialogFooter>
                    </>
                ) : (
                    <DialogFooter className="bg-transparent">
                        <p className="text-sm text-muted-foreground text-center py-4">
                            当前文件类型: {contentType || "未知"}<br />
                            可能无法直接在浏览器中预览
                        </p>
                        <Button className="w-full"
                            onClick={() => {
                                const link = document.createElement('a');
                                link.href = output.url;
                                link.download = outputName;
                                link.click();
                            }}
                        >
                            <Download className="h-4 w-4 mr-2" />
                            下载
                        </Button>
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    )
}

export function AudioDialog({ output }: { output: IOutput }) {
    return (
        <Dialog>
            <DialogTrigger asChild>
                <div
                    draggable="true"
                    onDragStart={createMediaDragHandler({
                        url: output.url,
                        filename: getOutputFileName(output),
                        contentType: getOutputContentType(output)
                    })}
                >
                    <audio src={output.url} controls />
                </div>
            </DialogTrigger>
            <DialogContent className="max-w-fit max-h-[90vh] border-0 p-0 bg-transparent [&>button]:bg-background [&>button]:border [&>button]:border-border [&>button]:rounded-full [&>button]:p-1 [&>button]:shadow-md">
                <DialogHeader className="sr-only">
                    <DialogTitle>音频预览</DialogTitle>
                </DialogHeader>
                <audio src={output.url} controls />
            </DialogContent>
        </Dialog>
    )
}

export function TextOutput({ output }: { output: IOutput }) {
    const [text, setText] = useState<string>("");

    useEffect(() => {
        if (output.file instanceof File) {
            output.file.text().then(setText);
        } else {
            const fetchText = async () => {
                try {
                    const response = await fetch(`/api/text-proxy?url=${encodeURIComponent(output.url)}`);
                    if (!response.ok) {
                        throw new Error(`Failed to fetch text: ${response.status}`);
                    }
                    const textData = await response.text();
                    setText(textData);
                } catch (e: any) {
                    setText("");
                }
            };

            fetchText();
        }
    }, [output.file, output.url]);

    const outputName = getOutputFileName(output);

    return (
        <div className="pt-4 w-full">
            <Textarea id={outputName} value={text} readOnly className="w-full" rows={5} />
        </div>
    )
}

export function FileOutput({ output }: { output: IOutput }) {
    const outputName = getOutputFileName(output);

    return (
        <div
            key={output.url}
            className="flex w-full items-center justify-center"
        >
            <Button onClick={() => {
                const link = document.createElement('a');
                link.href = output.url;
                link.download = outputName;
                link.click();
            }}>
                <Download className="h-4 w-4 mr-2" />
                {outputName}
            </Button>
        </div>
    )
}


function OutputRenderer({
    output,
    textOutputEnabled,
    showOutputFileName,
    onAddToGallery }:
    {
        output: IOutput,
        textOutputEnabled: boolean,
        showOutputFileName: boolean,
        onAddToGallery?: (output: IOutput) => void,
    }) {

    const getOutputComponent = () => {
        const contentType = getOutputContentType(output);
        const filename = getOutputFileName(output).toLowerCase();
        const videoExtensions = ['.mp4', '.webm', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.m4v'];
        const isVideoByExtension = videoExtensions.some(ext => filename.endsWith(ext));
        const isVideo = contentType.startsWith('video/') || isVideoByExtension;

        if (contentType.startsWith('image/') && contentType !== "image/vnd.adobe.photoshop") {
            return (
                <SelectableImage imageUrl={output.url}>
                    <ImageDialog output={output} showOutputFileName={showOutputFileName} onAddToGallery={onAddToGallery} />
                </SelectableImage>
            );
        } else if (isVideo) {
            return (
                <SelectableImage imageUrl={output.url}>
                    <VideoDialog output={output} showOutputFileName={showOutputFileName} />
                </SelectableImage>
            );
        } else if (contentType.startsWith('audio/')) {
            return <AudioDialog output={output} />
        } else if (contentType.startsWith('text/')) {
            return null;
        } else {
            return <FileOutput output={output} />;
        }
    }

    const outputComponent = getOutputComponent();

    return (
        <>
            {outputComponent && (
                <div
                    key={output.url}
                    className="flex pt-1 w-64 h-64 items-center justify-center"
                >
                    <BlurFade key={output.url} delay={0.25} inView className="flex items-center justify-center w-full h-full">
                        {outputComponent}
                    </BlurFade>
                </div>
            )}
            {
                ((getOutputContentType(output)).startsWith('text/') && textOutputEnabled) && (
                    <BlurFade key={`${output.url}-text`} delay={0.25} inView className="flex items-center justify-center w-full h-full">
                        <TextOutput output={output} />
                    </BlurFade>
                )
            }
        </>
    )
}


function parseFileName(filename: string): string {

    if (filename.startsWith("__")) {
        return filename.substring(2,
            filename.lastIndexOf("__")
        );
    } else {
        return filename;
    }
}

const IndeterminateLoadingBar = ({ value, max, currentNode, elapsedMs }: { value?: number; max?: number; currentNode?: string; elapsedMs?: number }) => {
    // 当 max > 0 时显示真实进度；否则 indeterminate
    const hasRealProgress = typeof value === "number" && typeof max === "number" && max > 0;
    const percent = hasRealProgress ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
    const elapsedSec = typeof elapsedMs === "number" ? (elapsedMs / 1000) : undefined;
    const elapsedLabel = elapsedSec !== undefined ? `${elapsedSec.toFixed(1)}s` : "";

    return (
        <div className="flex flex-col gap-1 w-full">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="truncate">
                    {currentNode ? currentNode : (hasRealProgress ? "生成中" : "准备中...")}
                </span>
                <span className="tabular-nums">
                    {hasRealProgress
                        ? `${value}/${max}${elapsedLabel ? ` · ${elapsedLabel}` : ""}`
                        : (elapsedLabel || "")}
                </span>
            </div>
            <div
                role="progressbar"
                aria-label="正在生成"
                aria-valuenow={hasRealProgress ? value : undefined}
                aria-valuemin={0}
                aria-valuemax={hasRealProgress ? max : undefined}
                className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted-foreground/10"
            >
                {hasRealProgress ? (
                    <div
                        className="absolute inset-y-0 left-0 rounded-full bg-primary transition-[width] duration-200 ease-out"
                        style={{ width: `${percent}%` }}
                    />
                ) : (
                    <div className="vc-indeterminate absolute inset-y-0 w-1/3 rounded-full bg-muted-foreground/40" />
                )}
            </div>
        </div>
    );
};

const IndeterminateLoadingBarStyles = () => {
    return (
        <style jsx global>{`
            @keyframes vc-indeterminate {
                0% {
                    transform: translateX(-120%);
                }

                100% {
                    transform: translateX(320%);
                }
            }

            .vc-indeterminate {
                animation: vc-indeterminate 1.2s ease-in-out infinite;
            }
        `}</style>
    );
};

const TaskProgress = ({ progress }: { progress?: { value: number; max: number; currentNode?: string; startedAt: number } | undefined }) => {
    // 自增 elapsedMs 让 UI 看起来"活"的（即使没有 progress 事件也走秒表）
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!progress) return;
        const id = setInterval(() => setNow(Date.now()), 100);
        return () => clearInterval(id);
    }, [progress?.startedAt]);
    const elapsedMs = progress ? now - progress.startedAt : 0;

    return (
        <IndeterminateLoadingBar
            value={progress?.value}
            max={progress?.max}
            currentNode={progress?.currentNode}
            elapsedMs={elapsedMs}
        />
    );
};

function TaskCard({ task, progress, result, onShowErrorDialog, showOutputFileName, textOutputEnabled, onAddToGallery }: {
    task: IQueuedPrompt;
    progress?: { value: number; max: number; currentNode?: string; startedAt: number } | undefined;
    result?: IGeneration | undefined;
    onShowErrorDialog: (error: string) => void;
    showOutputFileName: boolean;
    textOutputEnabled: boolean;
    onAddToGallery?: (output: IOutput) => void;
}) {
    const statusLabel = {
        queued: "排队中",
        running: "运行中",
        completed: "已完成",
        error: "出错",
        canceled: "已取消",
    }[task.status] ?? task.status;

    return (
        <div className="flex flex-col gap-2 w-full pt-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium truncate">{task.workflowTitle}</span>
                    <span className={cn(
                        "text-xs shrink-0",
                        task.status === 'running' && "text-yellow-600",
                        task.status === 'error' && "text-red-600",
                        task.status === 'completed' && "text-green-600",
                        task.status === 'queued' && "text-muted-foreground",
                        task.status === 'canceled' && "text-muted-foreground",
                    )}>
                        {statusLabel}
                    </span>
                </div>
            </div>

            {task.status === 'queued' && (
                <div className="w-full h-64 rounded-md bg-muted animate-pulse flex items-center justify-center">
                    <span className="text-sm text-muted-foreground">排队中...</span>
                </div>
            )}

            {task.status === 'running' && (
                <div className="w-full h-64 rounded-md bg-muted flex items-center justify-center px-4">
                    <TaskProgress progress={progress} />
                </div>
            )}

            {task.status === 'error' && (
                <div className="w-full h-64 rounded-md bg-muted flex items-center justify-center">
                    <div className="flex flex-col items-center gap-2">
                        <CircleX color="#ff0000" />
                        <span className="text-sm text-muted-foreground">
                            <Button
                                variant={"outline"}
                                onClick={() => onShowErrorDialog(result?.errorData || "运行工作流时发生错误")}>
                                查看错误
                            </Button>
                        </span>
                    </div>
                </div>
            )}

            {task.status === 'canceled' && (
                <div className="w-full h-16 rounded-md bg-muted flex items-center justify-center">
                    <span className="text-sm text-muted-foreground">已取消</span>
                </div>
            )}

            {task.status === 'completed' && result && result.status !== "error" && (
                <div className="flex flex-wrap w-full gap-4">
                    {result.outputs.map((output) => (
                        <Fragment key={output.url}>
                            <OutputRenderer
                                output={output}
                                showOutputFileName={showOutputFileName}
                                textOutputEnabled={textOutputEnabled}
                                onAddToGallery={onAddToGallery}
                            />
                        </Fragment>
                    ))}
                    {typeof result.totalElapsedMs === "number" && result.totalElapsedMs > 0 && (
                        <div className="self-end text-xs text-muted-foreground tabular-nums pr-1">
                            {(result.totalElapsedMs / 1000).toFixed(2)}s
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
