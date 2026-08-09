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
import { Fragment, useEffect, useState, useCallback, useMemo } from "react";
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
    file: File | S3FilesData,
    url: string
}

interface IGeneration {
    status?: string | undefined;
    outputs: IOutput[],
    errorData?: string | undefined;
}


interface IResults {
    [promptId: string]: IGeneration;
}

const apiErrorHandler = new ApiErrorHandler();

interface IPlaygroundPageContent {
    doPost: (params: IUsePostPlayground) => void;
    loading: boolean;
    setLoading: (loading: boolean) => void;
}

const getOutputFileName = (output: { file: File | S3FilesData, url: string }): string => {
    if ("filename" in output.file) {
        return output.file.filename;
    } else {
        return output.file.name;
    }
}

const getOutputContentType = (output: IOutput): string => {
    if ("contentType" in output.file) {
        return output.file.contentType;
    } else {
        return output.file.type;
    }
}

function PlaygroundPageContent({ doPost, loading, setLoading }: IPlaygroundPageContent) {
    const [results, setResults] = useState<IResults>({});
    const { viewComfyState, viewComfyStateDispatcher } = useViewComfy();
    const viewMode = process.env.NEXT_PUBLIC_VIEW_MODE === "true";
    const [errorAlertDialog, setErrorAlertDialog] = useState<{ open: boolean, errorTitle: string | undefined, errorDescription: React.JSX.Element, onClose: () => void }>({ open: false, errorTitle: undefined, errorDescription: <></>, onClose: () => { } });
    const [textOutputEnabled, setTextOutputEnabled] = useState(false);
    const [showOutputFileName, setShowOutputFileName] = useState(false);

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
        const { promptId, status, errorData } = params;
        const outputs = params.outputs || [];
        const resultOutputs: {
            file: File | S3FilesData,
            url: string
        }[] = [];

        for (const output of outputs) {
            let url: string;
            if (output instanceof File) {
                try {
                    url = URL.createObjectURL(output);
                } catch (error) {
                    console.error("cannot parse output to URL")
                    console.log({ output });
                    url = "";
                }
                resultOutputs.push({ file: output, url });
            } else {
                // S3FilesData: 走 filepath URL
                url = output.filepath;
                const s3File = new S3FilesData({
                    filename: output.filename,
                    contentType: output.contentType,
                    filepath: output.filepath,
                    size: output.size ?? 0,
                });
                resultOutputs.push({ file: s3File, url });
            }
        }

        const newGeneration: IResults = {
            [promptId]: {
                status: status,
                outputs: resultOutputs,
                errorData,
            }
        };

        setResults((prevResults) => {
            if (prevResults[promptId]) {
                return prevResults;
            }
            return {
                ...newGeneration,
                ...prevResults,
            };
        });
        setLoading(false);
    }, [setLoading]);

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

        const doPostParams = {
            viewComfy: generationData,
            workflow: viewComfyState.currentViewComfy?.workflowApiJSON,
            onSuccess: (params: { promptId: string, outputs: File[] }) => {
                onSetResults({ ...params });

            }, onError: (error: any) => {
                const errorDialog = apiErrorHandler.apiErrorToDialog(error);
                setErrorAlertDialog({
                    open: true,
                    errorTitle: errorDialog.title,
                    errorDescription: <> {errorDialog.description} </>,
                    onClose: () => {
                        setErrorAlertDialog({ open: false, errorTitle: undefined, errorDescription: <></>, onClose: () => { } });
                    }
                });
            }
        }

        doPost(doPostParams);
    }

    useEffect(() => {
        return () => {
            for (const generation of Object.values(results)) {
                for (const output of generation.outputs) {
                    URL.revokeObjectURL(output.url);
                }
            }
        };
    }, []);

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
                        <WorkflowSwitcher viewComfys={viewComfyState.viewComfys} currentViewComfy={viewComfyState.currentViewComfy} onSelectChange={onSelectChange} />
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
                            {viewComfyState.viewComfys.length > 0 && viewComfyState.currentViewComfy && (
                                <div className="px-2 pt-4 w-full">
                                    <WorkflowSwitcher viewComfys={viewComfyState.viewComfys} currentViewComfy={viewComfyState.currentViewComfy} onSelectChange={onSelectChange} />
                                </div>
                            )}
                            {renderForm()}
                        </div>
                    </div>
                    <div className="relative flex h-full min-h-[50vh] w-full rounded-r-xl bg-muted/50 lg:col-span-2">
                        <ScrollArea className="relative flex h-full w-full flex-1 flex-col">
                            <div className="absolute right-3 top-14 z-10 flex gap-2">
                                {(Object.keys(results).length > 0) ? (
                                    <Badge variant="outline">输出结果</Badge>
                                ) : !loading && viewComfyState.currentViewComfy ? (
                                    <Badge variant="outline">输出预览</Badge>
                                ) : null}
                            </div>
                            {(Object.keys(results).length === 0) && !loading && viewComfyState.currentViewComfy && (
                                <>  <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-full">
                                    <PreviewOutputsImageGallery viewComfyJSON={viewComfyState.currentViewComfy.viewComfyJSON} />
                                </div>
                                </>
                            )}
                            <div className="flex-1 h-full p-4 flex overflow-y-auto">
                                <div className="flex flex-col w-full h-full">
                                    <Generating loading={loading} />
                                    {Object.entries(results).map(([promptId, generation], index, array) => (
                                        <div className="flex flex-col gap-4 w-full h-full" key={promptId}>
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

export default function PlaygroundPage() {
    const params = usePostPlayground();
    return (
        <PlaygroundPageContent
            doPost={params.doPost}
            loading={params.loading}
            setLoading={params.setLoading}
        />
    );
}

export function ImageDialog({ output, showOutputFileName }: { output: { file: File | S3FilesData, url: string }, showOutputFileName: boolean }) {
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

const IndeterminateLoadingBar = () => {
    return (
        <div
            role="progressbar"
            aria-label="正在生成"
            className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted-foreground/10"
        >
            <div className="vc-indeterminate absolute inset-y-0 w-1/3 rounded-full bg-muted-foreground/40" />
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
}) => {
    const { loading } = props;

    const generatingDetails = (
        <div className="flex flex-col gap-2">
            <IndeterminateLoadingBar />
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
