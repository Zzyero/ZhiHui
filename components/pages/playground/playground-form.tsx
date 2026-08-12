import { useFieldArray, useForm } from "react-hook-form"
import { Button } from "@/components/ui/button";
import type { IViewComfyBase, IViewComfyWorkflow } from "@/app/providers/view-comfy-provider";
import { cn } from "@/lib/utils";
import { ViewComfyForm } from "@/components/view-comfy/view-comfy-form";
import { WandSparkles } from "lucide-react";
import "./PlaygroundForm.css";
import { useEffect, useCallback, useRef } from "react";
import { useViewComfy } from "@/app/providers/view-comfy-provider";

export default function PlaygroundForm(props: {
    viewComfyJSON: IViewComfyWorkflow, onSubmit: (data: IViewComfyWorkflow) => void, loading: boolean
}) {
    const { viewComfyJSON, onSubmit, loading } = props;
    const { viewComfyState, viewComfyStateDispatcher } = useViewComfy();

    const workflowId = viewComfyJSON.id;
    const savedFormData = viewComfyState.formDataByWorkflow[workflowId];
    const initialAdvancedInputsOpen = viewComfyState.advancedInputsOpenByWorkflow[workflowId] ?? false;

    const defaultValues = {
        title: viewComfyJSON.title,
        description: viewComfyJSON.description,
        textOutputEnabled: viewComfyJSON.textOutputEnabled ?? false,
        viewcomfyEndpoint: viewComfyJSON.viewcomfyEndpoint ?? "",
        showOutputFileName: viewComfyJSON.showOutputFileName ?? false,
        // 优先使用保存的数据，否则使用原始数据
        inputs: savedFormData?.inputs ?? viewComfyJSON.inputs,
        advancedInputs: savedFormData?.advancedInputs ?? viewComfyJSON.advancedInputs,
    }

    const form = useForm<IViewComfyBase>({
        defaultValues,
        mode: "onChange",
        reValidateMode: "onChange"
    });

    const inputFieldArray = useFieldArray({
        control: form.control,
        name: "inputs"
    });

    const advancedFieldArray = useFieldArray({
        control: form.control,
        name: "advancedInputs"
    });

    // 使用 ref 跟踪当前工作流 ID，确保只在工作流改变时才 reset
    const prevWorkflowIdRef = useRef<string | null>(null);

    // 当工作流改变时，需要显式 reset 表单以使用新的 defaultValues
    useEffect(() => {
        if (prevWorkflowIdRef.current !== null && prevWorkflowIdRef.current !== workflowId) {
            // 工作流切换了，使用新的 defaultValues 重置表单
            form.reset(defaultValues);
        }
        prevWorkflowIdRef.current = workflowId;
    }, [workflowId, defaultValues, form]);

    const handleAdvancedInputsOpenChange = useCallback((isOpen: boolean) => {
        viewComfyStateDispatcher({
            type: "SET_ADVANCED_INPUTS_OPEN" as any,
            payload: { workflowId, isOpen }
        });
    }, [viewComfyStateDispatcher, workflowId]);

    // 保存表单数据到全局状态（防抖避免频繁更新）
    const saveFormData = useCallback(() => {
        const currentValues = form.getValues();
        viewComfyStateDispatcher({
            type: "SET_FORM_DATA" as any,
            payload: {
                workflowId,
                inputs: currentValues.inputs,
                advancedInputs: currentValues.advancedInputs,
            }
        });
    }, [form, viewComfyStateDispatcher, workflowId]);

    // 表单变化时保存数据
    useEffect(() => {
        const subscription = form.watch((_, { type }) => {
            if (type === "change" || type === "blur") {
                saveFormData();
            }
        });
        return () => subscription.unsubscribe();
    }, [form, saveFormData]);


    return (
        <ViewComfyForm
            form={form}
            onSubmit={onSubmit}
            inputFieldArray={inputFieldArray}
            advancedFieldArray={advancedFieldArray}
            isLoading={loading}
            initialAdvancedInputsOpen={initialAdvancedInputsOpen}
            onAdvancedInputsOpenChange={handleAdvancedInputsOpenChange}
        >
            <Button type="submit" className="w-full" disabled={loading}>
                生成 <WandSparkles className={cn("size-5 ml-2")} />
            </Button>
        </ViewComfyForm>
    )
}

