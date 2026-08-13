import type { IInput } from "./input";

export interface IViewComfy {
    inputs: IInput[];
    textOutputEnabled?: boolean;
}

export interface IComfyInput {
    viewComfy: IViewComfy;
    workflow?: object;
    /** 客户端生成的本地 promptId，用于串行队列登记与取消排队任务 */
    clientPromptId?: string;
}
