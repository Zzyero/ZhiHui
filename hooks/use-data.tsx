"use client";
import useSWR from "swr";
import useSWRImmutable from "swr/immutable";

import { IWorkflowHistoryModel } from "@/app/interfaces/workflow-history";
import { SettingsService } from "@/app/services/settings-service";

const settingsService = new SettingsService();

const RETRYABLE_STATUS_CODES = [502, 503];
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

const fetcher = async (resource: string) => {
    const url = `${settingsService.getApiUrl()}/${resource}`;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const response = await fetch(url);

        if (RETRYABLE_STATUS_CODES.includes(response.status) && attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, RETRY_BASE_DELAY_MS * Math.pow(2, attempt)));
            continue;
        }

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return response.json();
    }

    throw new Error("Max retries exceeded");
};

const isCloudAvailable = (): boolean => {
    try {
        return Boolean(process.env.NEXT_PUBLIC_API_URL);
    } catch {
        return false;
    }
};

export function useRunningWorkflow() {
    const { data, error, isLoading } = useSWRImmutable(
        isCloudAvailable() ? "workflow/infer/running" : null,
        fetcher
    );

    let result: IWorkflowHistoryModel[] = [];

    if (data && !error) {
        result = data as IWorkflowHistoryModel[];
    }

    return {
        runningWorkflows: result,
        isLoading,
        isError: error,
    };
}

export function useWorkflowByPromptIds(params: {
    promptIds: string[];
}) {
    const { promptIds } = params;

    const urlParams = promptIds.length > 0
        ? `?${promptIds.map(id => `prompt_ids=${encodeURIComponent(id)}`).join('&')}`
        : '';

    const { data, error, isLoading } = useSWR(
        isCloudAvailable() && params.promptIds.length > 0 ? `workflow/infer/${urlParams}` : null,
        fetcher,
    );

    let result: IWorkflowHistoryModel[] = [];

    if (data && !error) {
        result = data as IWorkflowHistoryModel[];
    }

    return {
        workflows: result,
        isLoading,
        isError: error,
    };
}
