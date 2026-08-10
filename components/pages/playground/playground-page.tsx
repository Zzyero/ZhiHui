"use client"

import {
    Settings,
    Download,
    CircleX
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
    Drawer,
    DrawerContent,
    DrawerTrigger,
} from "@/components/ui/drawer"
import { Fragment, useEffect, useState, useCallback, useMemo, useRef } from "react";
import PlaygroundForm from "./playground-form";
import { usePostPlayground } from "@/hooks/playground/use-post-playground";
import { ActionType, type IViewComfy, type IViewComfyWorkflow, useViewComfy } from "@/app/providers/view-comfy-provider";
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

const getOutputContentType = (output: { contentType: string }): string => output.contentType;

function PlaygroundPageContent({ doPost, sectionName }: IPlaygroundPageContent) {
    const { viewComfyState, viewComfyStateDispatcher } = useViewComfy();
    const viewMode = process.env.NEXT_PUBLIC_VIEW_MODE === "true";
    const [errorAlertDialog, setErrorAlertDialog] = useState<{ open: boolean, errorTitle: string | undefined, errorDescription: React.JSX.Element, onClose: () => void }>({ open: false, errorTitle: undefined, errorDescription: <></>, onClose: () => { } });
    const [textOutputEnabled, setTextOutputEnabled] = useState(false);
    const [showOutputFileName, setShowOutputFileName] = useState(false);

    // 当前 section 的 loading 状态（从 provider 读取，跨页面持续）
    const loading = useMemo(() => {
        if (sectionName) return !!viewComfyState.loadingBySection[sectionName];
        return false;
    }, [sectionName, viewComfyState.loadingBySection]);

    // 写入当前 section 的 loading 状态
    const setSectionLoading = useCallback((next: boolean) => {
        if (!sectionName) return;
        viewComfyStateDispatcher({
            type: ActionType.SET_SECTION_LOADING,
            payload: { sectionName, loading: next },
        });
    }, [sectionName, viewComfyStateDispatcher]);

    // 本次生成的稳定启动时间戳（不随 progress 事件重置，用于"已用时间"显示）与服务器真 promptId
    const generationStartedAtRef = useRef<number>(0);
    const realPromptIdRef = useRef<string | undefined>(undefined);
    // 记录最近一次 progress 的 value/max 和 executing 的节点名，executing 事件用 replace 写入时保留
    const lastProgressValueRef = useRef<number>(0);
    const lastProgressMaxRef = useRef<number>(0);
    const currentNodeRef = useRef<string | undefined>(undefined);

    // node id -> 友好标题 映射（从 workflow_api 的 _meta.title 读取，用于进度条上方显示当前节点）
    const nodeTitleMap = useMemo(() => {
        const map: Record<string, string> = {};
        const wf = viewComfyState.currentViewComfy?.workflowApiJSON as Record<string, { class_type?: string; _meta?: { title?: string } }> | undefined;
        if (wf) {
            for (const id in wf) {
                const title = wf[id]?._meta?.title || wf[id]?.class_type;
                if (title) {
                    map[id] = title;
                }
            }
        }
        return map;
    }, [viewComfyState.currentViewComfy]);

    // 当前页（section）的结果集 —— 切页面也保留（升到 Provider）
    const results: IResults = useMemo(() => {
        return (sectionName && viewComfyState.resultsBySection[sectionName]) || {};
    }, [sectionName, viewComfyState.resultsBySection]);

    // 找正在运行的 prompt 的 progress（取 status==='running' 的最新一条）
    const runningProgress = useMemo(() => {
        const all = viewComfyState.progressByPrompt;
        let candidate: { value: number; max: number; currentNode?: string; startedAt: number } | undefined;
        let latestStartedAt = -1;
        for (const pid in all) {
            const p = all[pid];
            if (p.status === "running" && p.startedAt > latestStartedAt) {
                latestStartedAt = p.startedAt;
                candidate = p;
            }
        }
        return candidate;
    }, [viewComfyState.progressByPrompt]);

    // 按 section 过滤工作流（按标题匹配）
    const filteredViewComfys = useMemo(() => {
        if (!sectionName) return viewComfyState.viewComfys;
        const section = viewComfyState.sections.find((s) => s.name === sectionName);
        if (!section) return [];
        const titles = new Set(section.workflows);
        return viewComfyState.viewComfys.filter((vc) => titles.has(vc.viewComfyJSON.title));
    }, [sectionName, viewComfyState.viewComfys, viewComfyState.sections]);

    // 如果当前选中的工作流不在过滤集合内，自动选第一个
    useEffect(() => {
        if (!sectionName) return;
        if (filteredViewComfys.length === 0) return;
        const current = viewComfyState.currentViewComfy;
        const stillVisible = current && filteredViewComfys.some((vc) => vc.viewComfyJSON.id === current.viewComfyJSON.id);
        if (!stillVisible) {
            viewComfyStateDispatcher({
                type: "UPDATE_CURRENT_VIEW_COMFY" as any,
                payload: filteredViewComfys[0],
            });
        }
    }, [sectionName, filteredViewComfys, viewComfyState.currentViewComfy, viewComfyStateDispatcher]);

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

        // 同步存一份到 provider（按当前 section 隔离），切页面不会丢
        if (sectionName) {
            viewComfyStateDispatcher({
                type: ActionType.SET_RESULT,
                payload: {
                    sectionName,
                    promptId,
                    result: {
                        status,
                        outputs: resultOutputs,
                        errorData,
                        totalElapsedMs,
                    },
                },
            });

            // 标记该 prompt 的进度为 success，并写入总耗时
            viewComfyStateDispatcher({
                type: ActionType.SET_PROGRESS_DONE,
                payload: {
                    promptId,
                    totalElapsedMs: totalElapsedMs ?? 0,
                    status: status === "error" ? "error" : "success",
                },
            });
        }

        const newGeneration: IResults = {
            [promptId]: {
                status: status,
                outputs: resultOutputs,
                errorData,
                totalElapsedMs,
            }
        };

        setSectionLoading(false);
    }, [setSectionLoading, sectionName, viewComfyStateDispatcher]);

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

        // 立刻把当前 section 的 loading 翻 true（提升到 Provider，跨页面持续）
        setSectionLoading(true);

        // 记录本次生成的稳定起点（供"已用时间"与错误耗时使用）
        generationStartedAtRef.current = Date.now();
        realPromptIdRef.current = undefined;
        lastProgressValueRef.current = 0;
        lastProgressMaxRef.current = 0;
        currentNodeRef.current = undefined;

        // 本次 promptId 先占位（server 第一个 SSE started 事件会带真值）
        const localPromptId = crypto.randomUUID();
        viewComfyStateDispatcher({
            type: ActionType.SET_PROGRESS,
            payload: {
                promptId: localPromptId,
                progress: {
                    value: 0,
                    max: 0,
                    startedAt: generationStartedAtRef.current,
                    status: "running",
                },
            },
        });

        const doPostParams = {
            viewComfy: generationData,
            workflow: viewComfyState.currentViewComfy?.workflowApiJSON,
            onSuccess: (params: { promptId: string, outputs: File[], totalElapsedMs?: number }) => {
                onSetResults({ ...params, localPromptId, totalElapsedMs: params.totalElapsedMs });
                setSectionLoading(false);
            }, onError: (error: any) => {
                // 错误时也要把 progress 标为 error
                viewComfyStateDispatcher({
                    type: ActionType.SET_PROGRESS_DONE,
                    payload: {
                        promptId: realPromptIdRef.current || localPromptId,
                        totalElapsedMs: Date.now() - generationStartedAtRef.current,
                        status: "error",
                    },
                });
                setSectionLoading(false);
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
            onProgress: (event: { type: string, value?: number, max?: number, currentNode?: string, promptId?: string, errorMessage?: string }) => {
                // progress/executing/executed 事件不带 promptId，必须用 ref 里存的真值
                const realPromptId = event.promptId || realPromptIdRef.current || localPromptId;
                realPromptIdRef.current = realPromptId;
                const toNodeLabel = (raw?: string) => (raw ? nodeTitleMap[raw] || raw : undefined);

                if (event.type === "started") {
                    viewComfyStateDispatcher({ type: ActionType.REMOVE_PROGRESS, payload: { promptId: localPromptId } });
                    viewComfyStateDispatcher({
                        type: ActionType.SET_PROGRESS,
                        payload: { promptId: realPromptId, progress: { value: 0, max: 0, startedAt: generationStartedAtRef.current, currentNode: undefined, status: "running" } },
                    });
                    return;
                }
                if (event.type === "progress") {
                    const v = event.value ?? 0;
                    const m = event.max ?? 0;
                    lastProgressValueRef.current = v;
                    lastProgressMaxRef.current = m;
                    viewComfyStateDispatcher({
                        type: ActionType.SET_PROGRESS,
                        payload: { promptId: realPromptId, progress: { value: v, max: m, startedAt: generationStartedAtRef.current, currentNode: currentNodeRef.current, status: "running" } },
                    });
                } else if (event.type === "executing" || event.type === "executed") {
                    const label = toNodeLabel(event.currentNode);
                    if (typeof event.currentNode === "string") {
                        currentNodeRef.current = label;
                    }
                    viewComfyStateDispatcher({
                        type: ActionType.SET_PROGRESS,
                        payload: { promptId: realPromptId, progress: { value: lastProgressValueRef.current, max: lastProgressMaxRef.current, startedAt: generationStartedAtRef.current, currentNode: label, status: "running" } },
                    });
                } else if (event.type === "error") {
                    viewComfyStateDispatcher({ type: ActionType.SET_PROGRESS_DONE, payload: { promptId: realPromptId, totalElapsedMs: 0, status: "error" } });
                }
            },
        }

        doPost(doPostParams);
    }

    const onSelectChange = (data: IViewComfy) => {
        return viewComfyStateDispatcher({
            type: ActionType.UPDATE_CURRENT_VIEW_COMFY,
            payload: { ...data }
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
    const hasViewComfyApp = viewComfyState.currentViewComfy !== undefined;

    if (!hasViewComfyApp) {
        return <>
            <div className="flex flex-col h-screen">
                <ErrorAlertDialog open={errorAlertDialog.open} errorTitle={errorAlertDialog.errorTitle} errorDescription={errorAlertDialog.errorDescription} onClose={errorAlertDialog.onClose} />
            </div>
        </>;
    }

    const renderForm = () => {
        if (viewComfyState.currentViewComfy) {
            return (
                <PlaygroundForm
                    viewComfyJSON={viewComfyState.currentViewComfy.viewComfyJSON}
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
                    {viewComfyState.currentViewComfy && (
                        <WorkflowSwitcher viewComfys={filteredViewComfys} currentViewComfy={viewComfyState.currentViewComfy} onSelectChange={onSelectChange} />
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
                            {filteredViewComfys.length > 0 && viewComfyState.currentViewComfy && (
                                <div className="px-2 pt-4 w-full">
                                    <WorkflowSwitcher viewComfys={filteredViewComfys} currentViewComfy={viewComfyState.currentViewComfy} onSelectChange={onSelectChange} />
                                </div>
                            )}
                            {renderForm()}
                        </div>
                    </div>
                    <div className="relative flex h-full min-h-[50vh] w-full rounded-r-xl bg-muted/50 lg:col-span-2">
                        <ScrollArea className="relative flex h-full w-full flex-1 flex-col">
                            {(Object.keys(results).length === 0) && !loading && viewComfyState.currentViewComfy && (
                                <>  <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-full">
                                    <PreviewOutputsImageGallery viewComfyJSON={viewComfyState.currentViewComfy.viewComfyJSON} />
                                </div>
                                </>
                            )}
                            <div className="flex-1 h-full p-4 flex overflow-y-auto">
                                <div className="flex flex-col w-full h-full">
                                    <Generating loading={loading} progress={runningProgress} />
                                    {Object.entries(results).map(([promptId, generation], index, array) => (
                                        <div className="flex flex-col gap-2 w-full h-full" key={promptId}>
                                            <div className="flex flex-wrap w-full h-full gap-4 pt-4" key={promptId}>
                                                {generation.status && generation.status === "error" &&
                                                    <GenerationError
                                                        generation={generation}
                                                        onShowErrorDialog={onShowErrorDialog}
                                                        promptId={promptId}
                                                    />
                                                }
                                                {!(generation.status && generation.status === "error") && generation.outputs.map((output) => (
                                                    <Fragment key={output.url}>
                                                        <OutputRenderer
                                                            output={output}
                                                            showOutputFileName={showOutputFileName}
                                                            textOutputEnabled={textOutputEnabled}
                                                        />
                                                    </Fragment>
                                                ))}
                                            </div>
                                            {typeof generation.totalElapsedMs === "number" && generation.totalElapsedMs > 0 && (
                                                <div className="self-end text-xs text-muted-foreground tabular-nums pr-1">
                                                    {(generation.totalElapsedMs / 1000).toFixed(2)}s
                                                </div>
                                            )}
                                            <hr className={
                                                `w-full py-4
                                            ${index !== array.length - 1 ? 'border-gray-300' : 'border-transparent'}
                                            `
                                            }
                                            />
                                        </div>
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

export function ImageDialog({ output, showOutputFileName }: { output: IOutput, showOutputFileName: boolean }) {
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
                    <Button className="w-full"
                        onClick={() => {
                            const link = document.createElement('a');
                            link.href = output.url;
                            link.download = `${output.url.split('/').pop()}`;
                            link.click();
                        }}
                    >下载</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function VideoDialog({ output }: { output: IOutput }) {
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
                    className="w-full"
                >
                    <video
                        key={output.url}
                        className="w-full h-64 object-cover rounded-md hover:cursor-pointer"
                        controls
                    >
                        <track default kind="captions" srcLang="en" src="SUBTITLE_PATH" />
                        <source src={output.url} />
                    </video>
                </div>
            </DialogTrigger>
            <DialogContent className="max-w-fit max-h-[90vh] border-0 p-0 bg-transparent [&>button]:bg-background [&>button]:border [&>button]:border-border [&>button]:rounded-full [&>button]:p-1 [&>button]:shadow-md">
                <DialogHeader className="sr-only">
                    <DialogTitle>视频预览</DialogTitle>
                </DialogHeader>
                <video
                    key={output.url}
                    className="max-h-[85vh] w-auto object-contain rounded-md"
                    controls
                >
                    <track default kind="captions" srcLang="en" src="SUBTITLE_PATH" />
                    <source src={output.url} />
                </video>
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
    showOutputFileName }:
    {
        output: IOutput,
        textOutputEnabled: boolean,
        showOutputFileName: boolean,
    }) {


    const getOutputComponent = () => {
        const contentType = getOutputContentType(output);

        if (contentType.startsWith('image/') && contentType !== "image/vnd.adobe.photoshop") {
            return (
                <SelectableImage imageUrl={output.url}>
                    <ImageDialog output={output} showOutputFileName={showOutputFileName} />
                </SelectableImage>
            );
        } else if (contentType.startsWith('video/')) {
            return <VideoDialog output={output} />
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

const Generating = (props: {
    loading: boolean,
    progress?: { value: number; max: number; currentNode?: string; startedAt: number } | undefined,
}) => {
    const { loading, progress } = props;
    // 自增 elapsedMs 让 UI 看起来"活"的（即使没有 progress 事件也走秒表）
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!loading || !progress) return;
        const id = setInterval(() => setNow(Date.now()), 100);
        return () => clearInterval(id);
    }, [loading, progress?.startedAt]);
    const elapsedMs = progress ? now - progress.startedAt : 0;

    const generatingDetails = (
        <div className="flex flex-col gap-2">
            <IndeterminateLoadingBar
                value={progress?.value}
                max={progress?.max}
                currentNode={progress?.currentNode}
                elapsedMs={elapsedMs}
            />
        </div>
    );

    if (loading) {
        return (
            <>
                <IndeterminateLoadingBarStyles />
                <div className="flex flex-col gap-4 w-full">
                    <div className="flex flex-wrap w-full gap-4 pt-4">
                        <div key={`loading-placeholder`} className="flex flex-col gap-2 sm:w-[calc(50%-2rem)] lg:w-[calc(33.333%-2rem)]">
                            <BlurFade delay={0.25} inView className="flex items-center justify-center w-full h-full">
                                <div className="w-full h-64 rounded-md bg-muted animate-pulse flex items-center justify-center">
                                    <div className="flex flex-col items-center gap-2">
                                        <div className="w-8 h-8 rounded-full bg-muted-foreground/20 animate-pulse"></div>
                                        <span className="text-sm text-muted-foreground animate-pulse">正在生成...</span>
                                    </div>
                                </div>
                            </BlurFade>
                            {generatingDetails}
                        </div>
                    </div>
                    <hr className="w-full py-4 border-gray-300" />
                </div>
            </>
        );
    }

    return null;
};

const GenerationError = (params: {
    generation: IGeneration,
    promptId: string,
    onShowErrorDialog: (error: string) => void,
}) => {
    const { generation, promptId, onShowErrorDialog } = params;

    const getErrorMessage = (gen: IGeneration): string => {
        return gen.errorData || "运行工作流时发生错误";
    }

    return (
        <div key={promptId} className="flex flex-col gap-4 w-full">
            <div className="flex flex-wrap w-full gap-4 pt-4">
                <div key={`${promptId}-loading-placeholder`} className="flex items-center justify-center sm:w-[calc(50%-2rem)] lg:w-[calc(33.333%-2rem)]">
                    <BlurFade delay={0.25} inView className="flex items-center justify-center w-full h-full">
                        <div className="w-full h-64 rounded-md bg-muted flex items-center justify-center">
                            <div className="flex flex-col items-center gap-2">
                                <CircleX color="#ff0000" />

                                <span className="text-sm text-muted-foreground">
                                    <Button
                                        variant={"outline"}
                                        onClick={() => onShowErrorDialog(getErrorMessage(generation))}>
                                        查看错误
                                    </Button>
                                </span>
                            </div>
                        </div>
                    </BlurFade>
                </div>
            </div>
        </div>
    )
}
