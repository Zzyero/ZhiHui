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
    /** 用于使用统计：工作流 id/标题/所属分类 */
    workflowId?: string;
    workflowTitle?: string;
    sectionName?: string;
}
