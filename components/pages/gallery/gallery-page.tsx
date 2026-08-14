"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { useViewComfy, ActionType } from "@/app/providers/view-comfy-provider"
import type { IGalleryItem } from "@/app/services/gallery-service"
import {
    SECTION_ROUTES,
    applyPromptToInputs,
    buildParamEntries,
    formatParamValue,
} from "@/lib/gallery-utils"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Clock, ImageOff, Trash2, WandSparkles } from "lucide-react"
import { cn } from "@/lib/utils"

function formatTime(ts: number): string {
    try {
        return new Date(ts).toLocaleString()
    } catch {
        return ""
    }
}

export default function GalleryPage() {
    const router = useRouter()
    const { viewComfyState, viewComfyStateDispatcher } = useViewComfy()
    const [items, setItems] = React.useState<IGalleryItem[]>([])
    const [loading, setLoading] = React.useState(true)
    const [selected, setSelected] = React.useState<IGalleryItem | null>(null)

    const fetchItems = React.useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch("/api/gallery")
            if (!res.ok) throw new Error("load failed")
            const data = await res.json()
            setItems(Array.isArray(data.items) ? data.items : [])
        } catch {
            toast.error("加载画廊失败")
        } finally {
            setLoading(false)
        }
    }, [])

    // 首次进入画廊时，若工作流尚未加载（例如直接访问 /gallery），先从服务端初始化
    React.useEffect(() => {
        if (viewComfyState.viewComfys.length > 0) return
        let cancelled = false
        const init = async () => {
            try {
                const res = await fetch("/api/view-comfy")
                if (!res.ok) return
                const data = await res.json()
                if (!cancelled && data?.workflows) {
                    viewComfyStateDispatcher({ type: ActionType.INIT_VIEW_COMFY, payload: data })
                }
            } catch {
                // 工作流文件缺失时忽略，复刻会显示"工作流已不存在"
            }
        }
        init()
        return () => { cancelled = true }
    }, [viewComfyState.viewComfys.length, viewComfyStateDispatcher])

    React.useEffect(() => {
        fetchItems()
    }, [fetchItems])

    const handleDelete = async () => {
        if (!selected) return
        try {
            const res = await fetch("/api/gallery/" + selected.id, { method: "DELETE" })
            if (!res.ok) throw new Error("delete failed")
            toast.success("已删除")
            setSelected(null)
            await fetchItems()
        } catch {
            toast.error("删除失败")
        }
    }

    const handleClone = () => {
        if (!selected) return
        const workflow = viewComfyState.viewComfys.find(
            (vc) => vc.viewComfyJSON.id === selected.workflowId
        )
        if (!workflow) {
            toast.error("该工作流已不存在，无法复刻")
            return
        }
        const cloned = applyPromptToInputs(workflow.viewComfyJSON, selected.prompt)
        viewComfyStateDispatcher({
            type: ActionType.UPDATE_CURRENT_VIEW_COMFY,
            payload: { viewComfy: workflow, sectionName: selected.sectionName },
        })
        viewComfyStateDispatcher({
            type: ActionType.SET_FORM_DATA,
            payload: {
                workflowId: selected.workflowId,
                inputs: cloned.inputs,
                advancedInputs: cloned.advancedInputs,
            },
        })
        viewComfyStateDispatcher({ type: ActionType.REQUEST_FORM_RESET })
        router.push(SECTION_ROUTES[selected.sectionName] ?? "/playground")
    }

    const selectedWorkflow = selected
        ? viewComfyState.viewComfys.find((vc) => vc.viewComfyJSON.id === selected.workflowId)
        : undefined
    const workflowMissing = selected ? !selectedWorkflow : false
    const paramEntries = React.useMemo(
        () => (selected ? buildParamEntries(selectedWorkflow?.viewComfyJSON, selected.prompt) : []),
        [selected, selectedWorkflow]
    )

    return (
        <div className="flex h-[calc(100vh-var(--top-nav-height))] flex-col">
            <div className="flex items-center justify-between px-4 pt-4">
                <h1 className="text-lg font-semibold">画廊</h1>
                <span className="text-xs text-muted-foreground">{items.length} 个作品</span>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
                {loading ? (
                    <div className="columns-2 gap-4 md:columns-3 lg:columns-4">
                        {Array.from({ length: 8 }).map((_, i) => (
                            <Skeleton key={i} className="mb-4 h-40 w-full break-inside-avoid" />
                        ))}
                    </div>
                ) : items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
                        <ImageOff className="mb-3 size-12 opacity-40" />
                        <p className="text-sm">暂无作品</p>
                        <p className="mt-1 text-xs">生成图片后，点开图片预览 → 添加到画廊</p>
                    </div>
                ) : (
                    <div className="columns-2 gap-4 md:columns-3 lg:columns-4">
                        {items.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => setSelected(item)}
                                className="group relative mb-4 block w-full break-inside-avoid overflow-hidden rounded-lg border bg-muted text-left"
                                aria-label={"查看作品 " + item.workflowTitle}
                            >
                                <img
                                    src={"/api/gallery/image/" + item.id}
                                    alt={item.workflowTitle}
                                    loading="lazy"
                                    className="h-auto w-full"
                                />
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                                    <div className="truncate text-xs text-white">{item.workflowTitle}</div>
                                    <div className="mt-0.5 text-[10px] text-white/70">{item.sectionName}</div>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <Dialog open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null) }}>
                {selected && (
                    <DialogContent className="max-w-5xl gap-4">
                        <DialogHeader>
                            <DialogTitle>{selected.workflowTitle || "画廊作品"}</DialogTitle>
                            <DialogDescription className="flex items-center gap-2">
                                <span>{selected.sectionName}</span>
                                <span className="inline-flex items-center gap-1">
                                    <Clock className="size-3" />
                                    {formatTime(selected.createdAt)}
                                </span>
                            </DialogDescription>
                        </DialogHeader>

                        <div className="flex flex-col gap-4 md:flex-row">
                            <div className="flex min-w-0 flex-1 items-center justify-center rounded-lg bg-muted">
                                <img
                                    src={"/api/gallery/image/" + selected.id}
                                    alt={selected.workflowTitle}
                                    className="max-h-[60vh] max-w-full object-contain"
                                />
                            </div>

                            <div className="flex w-full flex-col md:w-80">
                                <div className="mb-2 flex items-center justify-between">
                                    <span className="text-sm font-medium">生成参数</span>
                                    {workflowMissing && (
                                        <span className="text-xs text-destructive">工作流已不存在</span>
                                    )}
                                </div>
                                <ScrollArea className="max-h-[60vh]">
                                    {paramEntries.length === 0 ? (
                                        <p className="text-sm text-muted-foreground">
                                            {workflowMissing ? "无法映射参数" : "未解析到参数"}
                                        </p>
                                    ) : (
                                        <div className="flex flex-col gap-2 pr-2">
                                            {paramEntries.map((entry) => (
                                                <div key={entry.key} className="rounded-md border p-2">
                                                    <div className="text-xs text-muted-foreground">{entry.title}</div>
                                                    <div className="whitespace-pre-wrap break-words text-sm">
                                                        {formatParamValue(entry)}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </ScrollArea>
                            </div>
                        </div>

                        <DialogFooter>
                            <Button variant="outline" onClick={handleDelete}>
                                <Trash2 className="mr-2 size-4" />
                                删除
                            </Button>
                            <Button onClick={handleClone} disabled={workflowMissing} className={cn(workflowMissing && "opacity-50")}>
                                <WandSparkles className="mr-2 size-4" />
                                一键复刻
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                )}
            </Dialog>
        </div>
    )
}
