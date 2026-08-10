"use client"
import type { IMultiValueInput } from '@/lib/workflow-api-parser';
import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from 'react';
import type { S3FilesData } from '@/app/models/prompt-result';

export interface IViewComfyBase {
    title: string;
    description: string;
    textOutputEnabled?: boolean;
    viewcomfyEndpoint?: string;
    showOutputFileName?: boolean;
    previewImages: string[];
    inputs: IMultiValueInput[];
    advancedInputs: IMultiValueInput[];
}

export interface IViewComfyDraft {
    viewComfyJSON: IViewComfyBase;
    workflowApiJSON?: object | undefined;
    file?: File | undefined;
}

export interface IViewComfyWorkflow extends IViewComfyBase {
    id: string;
}

export interface IViewComfyJSON {
    appTitle?: string;
    appImg?: string;
    file_type?: string;
    file_version?: string;
    version?: string;
    workflows: IViewComfy[];
    sections?: IViewComfySection[];
}

export interface IViewComfySection {
    name: string;
    workflows: string[];
}

export interface IViewComfy {
    viewComfyJSON: IViewComfyWorkflow;
    workflowApiJSON?: object | undefined;
    file?: File | undefined;
}

export interface IViewComfyState {
    appTitle?: string;
    appImg?: string;
    viewComfys: IViewComfy[];
    viewComfyDraft: IViewComfyDraft | undefined;
    currentViewComfy: IViewComfy | undefined;
    sections: IViewComfySection[];
    /** 生图结果，按 section 分桶。sectionName -> promptId -> 结果 */
    resultsBySection: Record<string, Record<string, IGenerationResult>>;
    /** 各 section 当前的 loading 状态，便于跨页面持续显示生成动画 */
    loadingBySection: Record<string, boolean>;
    /** 按 promptId 跟踪每个 prompt 的生成进度（value/max、当前节点、总耗时） */
    progressByPrompt: Record<string, IPromptProgress>;
}

export interface IPromptProgress {
    /** 当前进度值（如 KSampler 第几 step） */
    value: number;
    /** 总进度上限 */
    max: number;
    /** 当前正在执行的节点 title/class，开场事件为空 */
    currentNode?: string;
    /** 启动时间戳（ms）；用于前端自增显示"已用时间" */
    startedAt: number;
    /** 完成时的总耗时（ms）；只设置一次 */
    totalElapsedMs?: number;
    /** 进度终态：success / error */
    status?: "running" | "success" | "error";
}

export interface IGenerationOutput {
    filename: string;
    contentType: string;
    /** 服务端 S3 路径或本地 object URL */
    url: string;
    size: number;
    /** 是否本地 File object（true 时 url 是 objectURL，刷新会失效） */
    isLocal?: boolean;
    /** 本地 File 对象（File 或 S3FilesData 兼容旧类型） */
    file?: File | S3FilesData;
}

export interface IGenerationResult {
    status?: string;
    outputs: IGenerationOutput[];
    errorData?: string;
    /** 生成总耗时（毫秒） */
    totalElapsedMs?: number;
}

// Define action types as an enum
export enum ActionType {
    ADD_VIEW_COMFY = "ADD_VIEW_COMFY",
    UPDATE_VIEW_COMFY = "UPDATE_VIEW_COMFY",
    REMOVE_VIEW_COMFY = "REMOVE_VIEW_COMFY",
    SET_VIEW_COMFY_DRAFT = "SET_VIEW_COMFY_DRAFT",
    UPDATE_CURRENT_VIEW_COMFY = "UPDATE_CURRENT_VIEW_COMFY",
    RESET_CURRENT_AND_DRAFT_VIEW_COMFY = "RESET_CURRENT_AND_DRAFT_VIEW_COMFY",
    INIT_VIEW_COMFY = "INIT_VIEW_COMFY",
    SET_APP_TITLE = "SET_APP_TITLE",
    SET_APP_IMG = "SET_APP_IMG",
    SET_SECTIONS = "SET_SECTIONS",
    SET_RESULT = "SET_RESULT",
    CLEAR_RESULT = "CLEAR_RESULT",
    SET_SECTION_LOADING = "SET_SECTION_LOADING",
    SET_PROGRESS = "SET_PROGRESS",
    SET_PROGRESS_DONE = "SET_PROGRESS_DONE",
    REMOVE_PROGRESS = "REMOVE_PROGRESS"
}

// Update the Action type to use the enum
export type Action =
    | { type: ActionType.ADD_VIEW_COMFY; payload: IViewComfy }
    | { type: ActionType.SET_VIEW_COMFY_DRAFT; payload: IViewComfyDraft | undefined }
    | { type: ActionType.UPDATE_VIEW_COMFY; payload: { viewComfy: IViewComfy, id: string } }
    | { type: ActionType.REMOVE_VIEW_COMFY; payload: IViewComfy }
    | { type: ActionType.UPDATE_CURRENT_VIEW_COMFY; payload: IViewComfy }
    | { type: ActionType.RESET_CURRENT_AND_DRAFT_VIEW_COMFY; payload: undefined }
    | { type: ActionType.INIT_VIEW_COMFY; payload: IViewComfyJSON }
    | { type: ActionType.SET_APP_TITLE; payload: string }
    | { type: ActionType.SET_APP_IMG; payload: string }
    | { type: ActionType.SET_SECTIONS; payload: IViewComfySection[] }
    | { type: ActionType.SET_RESULT; payload: { sectionName: string, promptId: string, result: IGenerationResult } }
    | { type: ActionType.CLEAR_RESULT; payload: { sectionName: string, promptId: string } }
    | { type: ActionType.SET_SECTION_LOADING; payload: { sectionName: string, loading: boolean } }
    | { type: ActionType.SET_PROGRESS; payload: { promptId: string, progress: Partial<IPromptProgress> } }
    | { type: ActionType.SET_PROGRESS_DONE; payload: { promptId: string, totalElapsedMs: number, status: "success" | "error" } }
    | { type: ActionType.REMOVE_PROGRESS; payload: { promptId: string } }

function viewComfyReducer(state: IViewComfyState, action: Action): IViewComfyState {
    switch (action.type) {
        case ActionType.ADD_VIEW_COMFY: {
            const data = {
                ...state,
                viewComfys: [...state.viewComfys, { ...action.payload }],
                currentViewComfy: {
                    viewComfyJSON: action.payload.viewComfyJSON,
                    workflowApiJSON: action.payload.workflowApiJSON,
                    file: action.payload.file
                },
                viewComfyDraft: {
                    viewComfyJSON: action.payload.viewComfyJSON,
                    workflowApiJSON: action.payload.workflowApiJSON,
                    file: action.payload.file
                }
            };

            return data;
        }
        case ActionType.SET_VIEW_COMFY_DRAFT:

            if (action.payload) {
                action.payload.viewComfyJSON.viewcomfyEndpoint = ""
            }
            return {
                ...state,
                viewComfyDraft: action.payload ? { ...action.payload } : undefined
            };
        case ActionType.UPDATE_VIEW_COMFY:
            return {
                ...state,
                viewComfys: state.viewComfys.map((item) =>
                    item.viewComfyJSON.id === action.payload.id
                        ? { ...action.payload.viewComfy }
                        : item
                ),
                currentViewComfy: {
                    viewComfyJSON: action.payload.viewComfy.viewComfyJSON,
                    workflowApiJSON: action.payload.viewComfy.workflowApiJSON,
                    file: action.payload.viewComfy.file
                },
                viewComfyDraft: {
                    viewComfyJSON: action.payload.viewComfy.viewComfyJSON,
                    workflowApiJSON: action.payload.viewComfy.workflowApiJSON,
                    file: action.payload.viewComfy.file
                }
            };
        case ActionType.REMOVE_VIEW_COMFY: {
            const data = {
                ...state,
                viewComfys: state.viewComfys.filter((item) => item.viewComfyJSON.id !== action.payload.viewComfyJSON.id)
            };

            if (data.viewComfys.length > 0) {
                data.currentViewComfy = data.viewComfys[0];
                data.viewComfyDraft = {
                    viewComfyJSON: data.viewComfys[0].viewComfyJSON,
                    workflowApiJSON: data.viewComfys[0].workflowApiJSON,
                    file: data.viewComfys[0].file
                };
            } else {
                data.currentViewComfy = undefined;
                data.viewComfyDraft = undefined;
            }

            return data;
        }
        case ActionType.UPDATE_CURRENT_VIEW_COMFY:
            return {
                ...state,
                currentViewComfy: action.payload,
                viewComfyDraft: action.payload
            }
        case ActionType.RESET_CURRENT_AND_DRAFT_VIEW_COMFY:
            return {
                ...state,
                currentViewComfy: undefined,
                viewComfyDraft: undefined
            }
        case ActionType.INIT_VIEW_COMFY: {
            if (action.payload.workflows.length === 0) {
                return state;
            }
            return {
                appTitle: action.payload.appTitle ?? "智绘·先锋",
                appImg: action.payload.appImg ?? "",
                viewComfys: [...action.payload.workflows.map((workflow) => ({
                    viewComfyJSON: workflow.viewComfyJSON,
                    workflowApiJSON: workflow.workflowApiJSON,
                }))],
                currentViewComfy: { viewComfyJSON: action.payload.workflows[0].viewComfyJSON, workflowApiJSON: action.payload.workflows[0].workflowApiJSON },
                viewComfyDraft: { viewComfyJSON: action.payload.workflows[0].viewComfyJSON, workflowApiJSON: action.payload.workflows[0].workflowApiJSON },
                sections: action.payload.sections ?? [],
                resultsBySection: {},
                loadingBySection: {},
                progressByPrompt: {},
            };
        }
        case ActionType.SET_APP_TITLE:
            return {
                ...state,
                appTitle: action.payload || "智绘·先锋"
            };
        case ActionType.SET_APP_IMG:
            return {
                ...state,
                appImg: action.payload
            };
        case ActionType.SET_SECTIONS:
            return {
                ...state,
                sections: action.payload
            };
        case ActionType.SET_RESULT: {
            const { sectionName, promptId, result } = action.payload;
            const sectionBucket = state.resultsBySection[sectionName] ?? {};
            if (sectionBucket[promptId]) {
                // 已有结果则不覆盖（保持单调追加）
                return state;
            }
            return {
                ...state,
                resultsBySection: {
                    ...state.resultsBySection,
                    [sectionName]: {
                        ...sectionBucket,
                        [promptId]: result,
                    },
                },
            };
        }
        case ActionType.CLEAR_RESULT: {
            const { sectionName, promptId } = action.payload;
            const sectionBucket = state.resultsBySection[sectionName];
            if (!sectionBucket || !sectionBucket[promptId]) return state;
            const nextSection = { ...sectionBucket };
            delete nextSection[promptId];
            return {
                ...state,
                resultsBySection: {
                    ...state.resultsBySection,
                    [sectionName]: nextSection,
                },
            };
        }
        case ActionType.SET_SECTION_LOADING:
            if (action.payload.loading === false && !state.loadingBySection[action.payload.sectionName]) {
                // 已经是 false，不再触发 setState（避免无谓重渲染）
                return state;
            }
            return {
                ...state,
                loadingBySection: {
                    ...state.loadingBySection,
                    [action.payload.sectionName]: action.payload.loading,
                },
            };
        case ActionType.SET_PROGRESS: {
            const existing = state.progressByPrompt[action.payload.promptId];
            return {
                ...state,
                progressByPrompt: {
                    ...state.progressByPrompt,
                    [action.payload.promptId]: {
                        ...(existing ?? { value: 0, max: 0, startedAt: Date.now() }),
                        ...action.payload.progress,
                    },
                },
            };
        }
        case ActionType.REMOVE_PROGRESS: {
            const next = { ...state.progressByPrompt };
            delete next[action.payload.promptId];
            return { ...state, progressByPrompt: next };
        }
        case ActionType.SET_PROGRESS_DONE: {
            const existing = state.progressByPrompt[action.payload.promptId];
            if (!existing) {
                // 没有初始进度（极少情况，比如 SSE 错过 initial 帧），补一个 minimal
                return {
                    ...state,
                    progressByPrompt: {
                        ...state.progressByPrompt,
                        [action.payload.promptId]: {
                            value: 0,
                            max: 0,
                            startedAt: Date.now(),
                            totalElapsedMs: action.payload.totalElapsedMs,
                            status: action.payload.status,
                        },
                    },
                };
            }
            return {
                ...state,
                progressByPrompt: {
                    ...state.progressByPrompt,
                    [action.payload.promptId]: {
                        ...existing,
                        totalElapsedMs: action.payload.totalElapsedMs,
                        status: action.payload.status,
                    },
                },
            };
        }
        default:
            return state;
    }
}

interface ViewComfyContextType {
    viewComfyState: IViewComfyState;
    viewComfyStateDispatcher: Dispatch<Action>;
}

const ViewComfyContext = createContext<ViewComfyContextType | undefined>(undefined);

export function ViewComfyProvider({ children }: { children: ReactNode }) {
    const [viewComfyState, dispatch] = useReducer(viewComfyReducer, { viewComfys: [], viewComfyDraft: undefined, currentViewComfy: undefined, sections: [], resultsBySection: {}, loadingBySection: {}, progressByPrompt: {} });

    return (
        <ViewComfyContext.Provider value={{ viewComfyState, viewComfyStateDispatcher: dispatch }}>
            {children}
        </ViewComfyContext.Provider>
    );
}

export function useViewComfy() {
    const context = useContext(ViewComfyContext);
    if (context === undefined) {
        throw new Error('useViewComfy must be used within a ViewComfyProvider');
    }
    return context;
}
