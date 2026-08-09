export interface IWorkflowHistoryFileModel {
    filename: string;
    contentType: string;
    filepath: string;
    size?: number;
}

export interface IWorkflowHistoryModel {
    promptId: string;
    result?: string;
    status?: string;
    outputs?: IWorkflowHistoryFileModel[];
    completed?: boolean;
    errorData?: string;
}

export interface IWorkflowResult {
    promptId: string;
    prompt?: Record<string, unknown>;
    result?: string;
    status?: string;
    outputs?: IWorkflowHistoryFileModel[];
    completed?: boolean;
    errorData?: string;
    executionTimeSeconds?: number;
}
