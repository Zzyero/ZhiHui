import { Header } from '@/components/header';
import { Button } from '@/components/ui/button';
import { Dropzone } from '@/components/ui/dropzone';
import ViewComfyFormEditor from '@/components/pages/view-comfy/view-comfy-form-editor';
import { workflowAPItoViewComfy } from '@/lib/workflow-api-parser';
import { useState, useEffect } from 'react';
import { ActionType, type IViewComfy, type IViewComfyBase, type IViewComfyJSON, type IViewComfySection, useViewComfy } from '@/app/providers/view-comfy-provider';
import { Label } from '@/components/ui/label';
import { ErrorAlertDialog } from '@/components/ui/error-alert-dialog';
import WorkflowSwitcher from '@/components/workflow-switchter';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';

class WorkflowJSONError extends Error {
    constructor() {
        super("不支持 workflow.json 文件，请使用 workflow_api.json");
    }
}

const DEFAULT_SECTIONS = ['智能生图', '智能修图', '视频生成', '音频克隆'];



export default function ViewComfyPage() {

    const [file, setFile] = useState<File | null>(null);
    const { viewComfyState, viewComfyStateDispatcher } = useViewComfy();
    const [errorDialog, setErrorDialog] = useState<{ open: boolean, error: Error | undefined }>({ open: false, error: undefined });
    const [appTitle, setAppTitle] = useState<string>(viewComfyState.appTitle || "");
    const [appImg, setAppImg] = useState<string>(viewComfyState.appImg || "");
    const [appImgError, setAppImgError] = useState<string | undefined>(undefined);
    const [savingSections, setSavingSections] = useState(false);

    // 如果 sections 为空，初始化默认两个分类（不持久化，等用户点保存再写）
    useEffect(() => {
        if (viewComfyState.sections.length === 0 && viewComfyState.viewComfys.length > 0) {
            const initial: IViewComfySection[] = DEFAULT_SECTIONS.map((name) => ({ name, workflows: [] }));
            // 默认把当前所有 workflow 都放到"智能生图"
            initial[0].workflows = viewComfyState.viewComfys.map((vc) => vc.viewComfyJSON.title);
            viewComfyStateDispatcher({ type: ActionType.SET_SECTIONS, payload: initial });
        }
    }, [viewComfyState.sections.length, viewComfyState.viewComfys, viewComfyStateDispatcher]);

    // 当前 workflow 在每个 section 里的"是否归属"
    const currentTitle = viewComfyState.currentViewComfy?.viewComfyJSON.title;

    const toggleSectionForCurrent = (sectionName: string) => {
        if (!currentTitle) return;
        const next = viewComfyState.sections.map((s) => {
            if (s.name !== sectionName) return s;
            const has = s.workflows.includes(currentTitle);
            return {
                ...s,
                workflows: has ? s.workflows.filter((t) => t !== currentTitle) : [...s.workflows, currentTitle],
            };
        });
        viewComfyStateDispatcher({ type: ActionType.SET_SECTIONS, payload: next });
    };

    const saveSections = async () => {
        setSavingSections(true);
        try {
            const res = await fetch('/api/view-comfy', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ action: 'update-sections', sections: viewComfyState.sections }),
            });
            if (!res.ok) throw new Error(await res.text());
            toast.success('分类已保存到 view_comfy.json');
        } catch (err) {
            toast.error('保存分类失败: ' + (err instanceof Error ? err.message : String(err)));
        } finally {
            setSavingSections(false);
        }
    };

    const handleOnBlur = (inputBlur: "appTitle" | "appImg") => {
        if (inputBlur === "appTitle") {
            viewComfyStateDispatcher({ type: ActionType.SET_APP_TITLE, payload: appTitle });
        } else if (inputBlur === "appImg") {
            setAppImgError(undefined);
            if (!appImg) {
                viewComfyStateDispatcher({ type: ActionType.SET_APP_IMG, payload: "" });
            } else {
                try {
                    new URL(appImg);
                    viewComfyStateDispatcher({ type: ActionType.SET_APP_IMG, payload: appImg });
                } catch (error) {
                    console.error('Error parsing image URL:', error);
                    setAppImgError("无效的图片 URL");
                }
            }
        }
    }

    useEffect(() => {
        setAppTitle(viewComfyState.appTitle || "");
    }, [viewComfyState.appTitle]);

    useEffect(() => {
        setAppImg(viewComfyState.appImg || "");
    }, [viewComfyState.appImg]);


    useEffect(() => {
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const content = e.target?.result as string;
                    const parsed = JSON.parse(content);
                    if (parsed.file_type === "view_comfy") {
                        viewComfyStateDispatcher({
                            type: ActionType.INIT_VIEW_COMFY,
                            payload: parsed as IViewComfyJSON
                        });
                    } else if (parsed.last_node_id) {
                        throw new WorkflowJSONError();
                    }
                    else {
                        viewComfyStateDispatcher({
                            type: ActionType.SET_VIEW_COMFY_DRAFT,
                            payload: { viewComfyJSON: workflowAPItoViewComfy(parsed), workflowApiJSON: parsed, file }
                        });
                    }
                } catch (error) {
                    console.error('Error parsing JSON:', error);
                    setErrorDialog({ open: true, error: error as Error });
                    viewComfyStateDispatcher({
                        type: ActionType.SET_VIEW_COMFY_DRAFT,
                        payload: undefined
                    });
                } finally {
                    setFile(null);
                }
            };
            reader.readAsText(file);
        }
    }, [file, viewComfyStateDispatcher]);


    const getDropZoneText = () => {
        if (viewComfyState.viewComfyDraft?.viewComfyJSON) {
            return <div className="text-muted-foreground text-lg">
                拖入你的 <b>workflow_api.json</b> 开始
            </div>
        }
        return <div className="text-muted-foreground text-lg">
            拖入你的 <b>workflow_api.json</b> 或 <b>view_comfy.json</b> 开始
        </div>
    }

    const showDeleteWorkflowButton = () => {
        return viewComfyState.currentViewComfy;
    }

    const deleteViewComfyJSON = () => {
        if (viewComfyState.currentViewComfy) {
            viewComfyStateDispatcher({
                type: ActionType.REMOVE_VIEW_COMFY,
                payload: viewComfyState.currentViewComfy,
            });
        }
    }

    const showDropZone = () => {
        return !viewComfyState.viewComfyDraft
    }

    const getOnSubmit = (data: IViewComfyBase) => {
        if (viewComfyState.currentViewComfy) {
            viewComfyStateDispatcher({
                type: ActionType.UPDATE_VIEW_COMFY,
                payload: {
                    id: viewComfyState.currentViewComfy.viewComfyJSON
                        .id,
                    viewComfy: {
                        viewComfyJSON: {
                            ...data,
                            id: viewComfyState.currentViewComfy
                                .viewComfyJSON.id,
                        },
                        file: viewComfyState.viewComfyDraft?.file,
                        workflowApiJSON:
                            viewComfyState.viewComfyDraft
                                ?.workflowApiJSON,
                    },
                },
            });
        } else {
            if (data.title === "") {
                data.title = `我的工作流 ${viewComfyState.viewComfys.length + 1}`;
            }

            viewComfyStateDispatcher({
                type: ActionType.ADD_VIEW_COMFY,
                payload: { viewComfyJSON: { ...data, id: Math.random().toString(16).slice(2) }, file: viewComfyState.viewComfyDraft?.file, workflowApiJSON: viewComfyState.viewComfyDraft?.workflowApiJSON }
            });
        }
    }

    const onSelectChange = (data: IViewComfy) => {
        return viewComfyStateDispatcher({
            type: ActionType.UPDATE_CURRENT_VIEW_COMFY,
            payload: { ...data }
        });
    }

    const addWorkflowOnClick = () => {
        return viewComfyStateDispatcher({
            type: ActionType.RESET_CURRENT_AND_DRAFT_VIEW_COMFY,
            payload: undefined
        });
    }

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <Header title="编辑器">
            </Header>
            <main className="flex-1 overflow-hidden p-2 pb-12">
                {showDropZone() && (
                    <div className="flex flex-col w-full h-full overflow-hidden">
                        <div className="w-full mt-10 sm:w-1/2 sm:h-1/2 mx-auto">
                            <Dropzone
                                onChange={setFile}
                                fileExtensions={[".json"]}
                                className="custom-dropzone w-full h-full"
                                inputPlaceholder={getDropZoneText()}
                            />
                        </div>
                    </div>
                )}

                {!showDropZone() && (
                    <>
                        {viewComfyState.viewComfyDraft?.viewComfyJSON && (
                            <div className="flex flex-col w-full h-full overflow-hidden">
                                {(viewComfyState.viewComfys.length > 0 && viewComfyState.currentViewComfy) && (
                                    <div className="w-full flex flex-wrap items-center gap-4 mb-4 pl-1">
                                        <div className="w-1/2 flex">
                                            <div className="w-full flex gap-4">
                                                <div className="grid w-1/2 items-center gap-1.5">
                                                    <Label htmlFor="appTitle">应用标题</Label>
                                                    <Input id="appTitle" placeholder="智绘·先锋" value={appTitle} onBlur={() => handleOnBlur("appTitle")} onChange={(e) => setAppTitle(e.target.value)} />
                                                </div>

                                                <div className="grid w-full items-center gap-1.5 pr-4">
                                                    <Label htmlFor="appImg">应用图片 URL</Label>
                                                    <Input id="appImg" placeholder="https://example.com/image.png" value={appImg} onBlur={() => handleOnBlur("appImg")} onChange={(e) => setAppImg(e.target.value)} />
                                                </div>
                                            </div>
                                            {appImgError && (
                                                <p className="text-sm font-medium text-red-500 mt-1">
                                                    {appImgError}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                )}
                                <div className="w-full flex flex-wrap items-center gap-4 mb-4 ml-1">
                                    {(viewComfyState.viewComfys.length > 0 && viewComfyState.currentViewComfy) && (
                                        <div className="flex">
                                            <WorkflowSwitcher viewComfys={viewComfyState.viewComfys} currentViewComfy={viewComfyState.currentViewComfy} onSelectChange={onSelectChange} />
                                        </div>
                                    )}
                                    {currentTitle && viewComfyState.sections.length > 0 && (
                                        <div className="flex items-center gap-3 border rounded-md px-3 py-1.5 bg-background">
                                            <Label className="text-xs text-muted-foreground">归类到：</Label>
                                            {viewComfyState.sections.map((section) => {
                                                const checked = section.workflows.includes(currentTitle);
                                                return (
                                                    <label key={section.name} className="flex items-center gap-1.5 text-sm cursor-pointer">
                                                        <Checkbox
                                                            checked={checked}
                                                            onCheckedChange={() => toggleSectionForCurrent(section.name)}
                                                        />
                                                        {section.name}
                                                    </label>
                                                );
                                            })}
                                            <Button
                                                size="sm"
                                                variant="default"
                                                disabled={savingSections}
                                                onClick={saveSections}
                                            >
                                                {savingSections ? '保存中…' : '保存分类'}
                                            </Button>
                                        </div>
                                    )}
                                    {showDeleteWorkflowButton() && (
                                        <div className="flex gap-2">
                                            <Button
                                                variant="destructive"
                                                onClick={deleteViewComfyJSON}
                                            >
                                                删除工作流
                                            </Button>
                                            <Button onClick={addWorkflowOnClick}>
                                                新建工作流
                                            </Button>
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 overflow-hidden">
                                    <ViewComfyFormEditor onSubmit={getOnSubmit} viewComfyJSON={viewComfyState.viewComfyDraft?.viewComfyJSON} />
                                </div>
                            </div>
                        )}
                    </>
                )}
            </main>
            <ErrorAlertDialog
                open={errorDialog.open}
                errorDescription={getErrorText(errorDialog.error)}
                onClose={() => setErrorDialog({ open: false, error: undefined })} />
        </div>
    )
}

function getErrorText(error: Error | undefined) {
    if (!error) {
        return <> </>
    }
    if (error instanceof WorkflowJSONError) {
        return <>
            你上传的似乎是 workflow.json 而不是 workflow_api.json<br />
            若要生成 workflow_api.json，请在 ComfyUI 设置中开启开发者模式选项，然后使用「保存（API 格式）」按钮导出。
        </>
    }

    return <> 解析 JSON 时出错，最常见的原因是 JSON 不合法或为空。<br /> <b> 错误详情：</b> <br /> {error.message} </>

}
