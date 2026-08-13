"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import {
    ListTodoIcon,
    XIcon,
    Loader2Icon,
    CheckCircleIcon,
    AlertCircleIcon,
    ClockIcon,
    ChevronDownIcon,
} from "lucide-react"
import { useViewComfy, ActionType, type IQueuedPrompt } from "@/app/providers/view-comfy-provider"
import { getComfyUIAPIService, IComfyQueueStatus } from "@/app/services/comfyui-api-service"
import { useEffect } from "react"

interface QueueDropdownProps {
    className?: string
}

export function QueueDropdown({ className }: QueueDropdownProps) {
    const { viewComfyState, viewComfyStateDispatcher } = useViewComfy()
    const [open, setOpen] = React.useState(false)

    // 从 queueStatus 获取 ComfyUI 队列数量（目前用于显示）
    const { queueRemaining } = viewComfyState.queueStatus

    // 监听 WebSocket 队列状态变化，更新到 provider
    React.useEffect(() => {
        try {
            const comfyService = getComfyUIAPIService()

            const handleQueueChange = (status: IComfyQueueStatus) => {
                viewComfyStateDispatcher({
                    type: ActionType.SET_QUEUE_STATUS,
                    payload: status
                })
            }

            comfyService.onQueueChange(handleQueueChange)

            return () => {
                comfyService.offQueueChange(handleQueueChange)
            }
        } catch {
            // ComfyUI API service might not be available on client side
        }
    }, [viewComfyStateDispatcher])

    // 收集所有队列中的任务（只显示排队中、运行中的任务）
    const allQueuedTasks = React.useMemo(() => {
        const tasks: IQueuedPrompt[] = []

        for (const section of Object.keys(viewComfyState.queueBySection)) {
            const sectionTasks = viewComfyState.queueBySection[section] || []
            // 只保留排队中和运行中的任务
            tasks.push(...sectionTasks.filter(t => t.status === 'queued' || t.status === 'running'))
        }

        // 按排队时间排序
        return tasks.sort((a, b) => a.queuedAt - b.queuedAt)
    }, [viewComfyState.queueBySection])

    // 统计各状态的数量
    const stats = React.useMemo(() => {
        const running = allQueuedTasks.filter((t) => t.status === 'running').length
        const queued = allQueuedTasks.filter((t) => t.status === 'queued').length
        return { running, queued }
    }, [allQueuedTasks])

    // 计算总任务数
    const totalCount = stats.queued + stats.running

    const triggerLabel = React.useMemo(() => {
        if (totalCount === 0) return "队列"
        if (stats.running > 0) return `运行中 ${stats.running}`
        return `${totalCount} 个任务`
    }, [totalCount, stats.running])

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    aria-label="任务队列"
                    className={cn("gap-2 min-w-[120px] justify-between", className)}
                >
                    <span className="flex items-center gap-2">
                        <ListTodoIcon className="size-4" />
                        <span className="line-clamp-1 overflow-hidden">
                            {triggerLabel}
                        </span>
                    </span>
                    {totalCount > 0 && (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                            {totalCount > 99 ? '99+' : totalCount}
                        </span>
                    )}
                    <ChevronDownIcon className={cn(
                        "h-4 w-4 opacity-50 transition-transform",
                        open && "rotate-180"
                    )} />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[320px] p-0" align="end">
                <div className="flex items-center justify-between px-3 py-2 border-b">
                    <span className="text-sm font-medium">任务队列</span>
                    {totalCount > 0 && (
                        <span className="text-xs text-muted-foreground">
                            {stats.running > 0 && (
                                <span className="inline-flex items-center gap-1 text-yellow-600">
                                    <Loader2Icon className="size-3 animate-spin" />
                                    {stats.running} 运行中
                                </span>
                            )}
                            {stats.queued > 0 && (
                                <span className="ml-2 inline-flex items-center gap-1">
                                    <ClockIcon className="size-3" />
                                    {stats.queued} 排队中
                                </span>
                            )}
                        </span>
                    )}
                </div>

                <ScrollArea className="max-h-[300px]">
                    {allQueuedTasks.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                            <ListTodoIcon className="size-10 mb-2 opacity-30" />
                            <p className="text-sm">暂无排队任务</p>
                            <p className="text-xs">点击生成按钮添加任务</p>
                        </div>
                    ) : (
                        <div className="p-1">
                            {allQueuedTasks.map((task) => (
                                <QueueItemRow
                                    key={task.promptId}
                                    task={task}
                                    onRemove={async () => {
                                        // 取消时优先用真实的 promptId（ComfyUI 识别的 ID），没有则用 localPromptId
                                        const targetPromptId = task.realPromptId || task.promptId;
                                        try {
                                            await fetch(`/api/prompt/${targetPromptId}?status=${task.status}`, {
                                                method: 'DELETE',
                                            })
                                            // 从队列中移除
                                            viewComfyStateDispatcher({
                                                type: ActionType.REMOVE_FROM_QUEUE,
                                                payload: { promptId: task.promptId }
                                            })
                                        } catch (error) {
                                            console.error("Failed to cancel task:", error)
                                        }
                                    }}
                                />
                            ))}
                        </div>
                    )}
                </ScrollArea>
            </PopoverContent>
        </Popover>
    )
}

interface QueueItemRowProps {
    task: IQueuedPrompt
    onRemove: () => void
}

function QueueItemRow({ task, onRemove }: QueueItemRowProps) {
    const statusIcon = {
        queued: <ClockIcon className="size-4 text-muted-foreground" />,
        running: <Loader2Icon className="size-4 text-yellow-600 animate-spin" />,
        completed: <CheckCircleIcon className="size-4 text-green-600" />,
        error: <AlertCircleIcon className="size-4 text-red-600" />,
        canceled: <XIcon className="size-4 text-muted-foreground" />,
    }

    const statusText = {
        queued: "排队中",
        running: "运行中",
        completed: "已完成",
        error: "出错",
        canceled: "已取消",
    }

    return (
        <div
            className={cn(
                "group relative flex items-center justify-between rounded-md px-2 py-2 mx-1 my-0.5",
                "hover:bg-accent transition-colors cursor-default",
                task.status === 'running' && "bg-yellow-50 dark:bg-yellow-950/20"
            )}
        >
            <div className="flex flex-1 items-center gap-2 min-w-0">
                {statusIcon[task.status]}
                <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-sm font-medium truncate">{task.workflowTitle}</span>
                    <span className="text-xs text-muted-foreground truncate">
                        {task.sectionName} · {statusText[task.status]}
                    </span>
                </div>
            </div>
            {(task.status === 'queued' || task.status === 'running' || task.status === 'error') && (
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 flex-shrink-0 opacity-0 group-hover:opacity-100 hover:opacity-100"
                    onClick={(e) => {
                        e.stopPropagation()
                        onRemove()
                    }}
                    aria-label={`取消任务 ${task.workflowTitle}`}
                >
                    <XIcon className="size-3" />
                </Button>
            )}
        </div>
    )
}
