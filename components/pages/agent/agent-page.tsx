"use client"

import * as React from "react"
import { toast } from "sonner"
import { useRouter, useSearchParams } from "next/navigation"
import type { IAgentMessage, IAgentTraceStep } from "@/app/services/agent-service"
import { useViewComfy, ActionType } from "@/app/providers/view-comfy-provider"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { ArrowUp, Loader2, Music, Paperclip, Plus, Sparkles, Square, Trash2, X } from "lucide-react"
import { ImageDialog, VideoDialog, AudioDialog, type IOutput } from "@/components/pages/playground/playground-page"
import { useAgentUi } from "@/components/pages/agent/agent-ui-provider"

const EMPTY_MESSAGES: IAgentMessage[] = []

function mimeFor(name: string): string {
    const ext = name.toLowerCase().split(".").pop() || ""
    const map: Record<string, string> = {
        png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
        mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska", avi: "video/x-msvideo",
        mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", ogg: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac",
    }
    return map[ext] || "image/png"
}

function statusLabel(e: { phase?: string; skill?: string; workflowTitle?: string }): string {
    switch (e.phase) {
        case "reading-skill": return "读取技能 " + (e.skill || "") + "…"
        case "generating": return "生成中" + (e.workflowTitle ? "（" + e.workflowTitle + "）" : "") + "…"
        case "thinking": return "思考中…"
        default: return "处理中…"
    }
}

/** 输入框里待发送附件的预览：图片/视频显示缩略图，音频显示图标+文件名 */
function FilePreview({ file, onRemove }: { file: File; onRemove: () => void }) {
    const url = React.useMemo(() => URL.createObjectURL(file), [file])
    React.useEffect(() => () => URL.revokeObjectURL(url), [url])
    const isImage = file.type.startsWith("image/")
    const isVideo = file.type.startsWith("video/")

    return (
        <div title={file.name} className="group relative size-16 shrink-0 overflow-hidden rounded-lg border border-border/60 bg-muted">
            {isImage ? (
                <img src={url} alt={file.name} className="h-full w-full object-cover" />
            ) : isVideo ? (
                <video src={url} preload="metadata" muted className="h-full w-full object-cover" />
            ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 p-1 text-muted-foreground">
                    <Music className="size-5" />
                    <span className="w-full truncate text-center text-[9px] leading-tight">{file.name}</span>
                </div>
            )}
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onRemove() }}
                aria-label="移除附件"
                className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm transition-colors hover:bg-background"
            >
                <X className="size-2.5" />
            </button>
        </div>
    )
}

export default function AgentPage() {
    // 状态来自根布局的常驻 Context：侧栏切走再切回，布局不卸载、状态保留，直接恢复上次内容
    const {
        sessions, setSessions,
        sessionsLoaded, setSessionsLoaded,
        sessionId, setSessionId,
        messagesBySession, setMessagesBySession,
        input, setInput,
        attachments, setAttachments,
    } = useAgentUi()
    const [isDragging, setIsDragging] = React.useState(false)
    const [loading, setLoading] = React.useState(false)
    const [status, setStatus] = React.useState<string | null>(null)
    const [liveTrace, setLiveTrace] = React.useState<IAgentTraceStep[]>([])
    const messages = sessionId ? (messagesBySession[sessionId] ?? EMPTY_MESSAGES) : EMPTY_MESSAGES
    const { viewComfyStateDispatcher } = useViewComfy()
    const fileInputRef = React.useRef<HTMLInputElement>(null)
    const textareaRef = React.useRef<HTMLTextAreaElement>(null)
    const scrollRef = React.useRef<HTMLDivElement>(null)
    const abortControllerRef = React.useRef<AbortController | null>(null)

    const router = useRouter()
    const searchParams = useSearchParams()
    // 只在首次挂载读取一次 URL 里的 session（用于整页刷新 / 深链恢复）
    const restoreSessionId = React.useRef<string | null | undefined>(undefined)
    if (restoreSessionId.current === undefined) {
        restoreSessionId.current = searchParams.get("session")
    }

    // 更新某个会话的消息（保留其他会话的缓存消息）
    const patchSessionMessages = React.useCallback((id: string, updater: (prev: IAgentMessage[]) => IAgentMessage[]) => {
        if (!id) return
        setMessagesBySession((prev) => ({ ...prev, [id]: updater(prev[id] ?? EMPTY_MESSAGES) }))
    }, [setMessagesBySession])

    // 从服务端拉取会话消息。缓存未命中时用于首次加载；缓存命中时是后台静默同步。
    // 只在服务端快照不少于当前缓存时替换，避免把本地刚新增的消息覆盖成旧快照。
    const fetchSessionMessages = React.useCallback(async (id: string) => {
        try {
            const res = await fetch("/api/agent/sessions/" + id)
            if (!res.ok) return
            const data = await res.json()
            const fetched = data.session?.messages || EMPTY_MESSAGES
            patchSessionMessages(id, (prev) => (fetched.length >= prev.length ? fetched : prev))
        } catch {
            // 忽略
        }
    }, [patchSessionMessages])

    const loadSessions = React.useCallback(async () => {
        try {
            const res = await fetch("/api/agent/sessions")
            if (!res.ok) return
            const data = await res.json()
            setSessions(data.sessions || [])
            setSessionsLoaded(true)
        } catch {
            // 忽略
        }
    }, [setSessions, setSessionsLoaded])

    // 挂载时恢复：
    // 1) URL 带 session（整页刷新/深链）→ 切到该会话并拉取（Context 此时为空）。
    // 2) 侧栏切回（URL 通常不带参数）→ Context 已保留上次的 sessionId 与消息，直接展示，
    //    把 URL 补回 ?session= 便于之后刷新也能恢复；列表已加载过就不再重复请求。
    React.useEffect(() => {
        const urlId = restoreSessionId.current
        if (urlId) {
            setSessionId(urlId)
            void fetchSessionMessages(urlId)
        } else if (sessionId) {
            router.replace("/agent?session=" + sessionId)
        }
        if (!sessionsLoaded) {
            void loadSessions()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    React.useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
    }, [messages, loading])

    const handleSelectSession = async (id: string) => {
        router.replace("/agent?session=" + id)
        setSessionId(id)
        setAttachments([])
        // 该会话消息已有缓存则直接展示、不再请求；没有缓存才拉取
        if (messagesBySession[id] === undefined) {
            await fetchSessionMessages(id)
        }
    }

    const handleNewSession = () => {
        router.replace("/agent")
        setSessionId(null)
        setInput("")
        setAttachments([])
    }

    const handleDeleteSession = async (id: string) => {
        try {
            await fetch("/api/agent/sessions/" + id, { method: "DELETE" })
            // 同步移除缓存里的该会话消息
            setMessagesBySession((prev) => {
                if (!(id in prev)) return prev
                const next = { ...prev }
                delete next[id]
                return next
            })
            if (sessionId === id) handleNewSession()
            await loadSessions()
        } catch {
            toast.error("删除失败")
        }
    }

    const handleAddToGallery = async (output: IOutput, workflowTitle?: string, workflowId?: string) => {
        try {
            const res = await fetch(output.url)
            const blob = await res.blob()
            const file = new File([blob], output.filename, { type: output.contentType })
            const formData = new FormData()
            formData.append("image", file, output.filename)
            formData.append("sectionName", "智能体")
            formData.append("workflowTitle", workflowTitle || "")
            formData.append("workflowId", workflowId || "")
            const galleryRes = await fetch("/api/gallery", { method: "POST", body: formData })
            if (!galleryRes.ok) throw new Error("add to gallery failed")
            toast.success("已添加到画廊")
        } catch {
            toast.error("添加到画廊失败")
        }
    }

    const doSend = async (id: string, text: string, files: File[]) => {
        const userMsg: IAgentMessage = {
            id: "temp-" + Date.now(),
            role: "user",
            content: text,
            attachments: files.map((f) => ({ name: f.name, originalName: f.name, type: f.type })),
            createdAt: Date.now(),
        }
        setMessagesBySession((prev) => ({ ...prev, [id]: [...(prev[id] ?? EMPTY_MESSAGES), userMsg] }))
        setInput("")
        setAttachments([])
        setLoading(true)
        setStatus("思考中…")
        setLiveTrace([])
        if (textareaRef.current) textareaRef.current.style.height = "auto"

        const formData = new FormData()
        formData.append("sessionId", id)
        formData.append("message", text)
        for (const f of files) formData.append("file", f)

        const controller = new AbortController()
        abortControllerRef.current = controller

        try {
            const res = await fetch("/api/agent/chat", { method: "POST", body: formData, signal: controller.signal })
            if (!res.ok) {
                let err = "发送失败"
                try {
                    const t = await res.text()
                    const j = JSON.parse(t)
                    err = j.error || err
                } catch { /* ignore */ }
                throw new Error(err)
            }
            if (!res.body) throw new Error("浏览器不支持流式响应")

            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ""
            let finalMessage: IAgentMessage | null = null
            let errorMsg: string | null = null

            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                buffer += decoder.decode(value, { stream: true })
                const events = buffer.split("\n\n")
                buffer = events.pop() || ""
                for (const eventText of events) {
                    let eventName = "message"
                    let data = ""
                    for (const raw of eventText.split("\n")) {
                        const line = raw.trimEnd()
                        if (line.startsWith("event:")) eventName = line.substring(6).trim()
                        else if (line.startsWith("data:")) data += (data ? "\n" : "") + line.substring(5).trim()
                    }
                    if (!data) continue
                    try {
                        const obj = JSON.parse(data)
                        if (eventName === "status") setStatus(statusLabel(obj))
                        else if (eventName === "done") finalMessage = obj.message
                        else if (eventName === "error") errorMsg = obj.error || "生成失败"
                        else if (eventName === "trace") setLiveTrace((prev) => [...prev, obj.step])
                        else if (eventName === "queue") {
                            const section = obj.sectionName || "智能体"
                            if (obj.queueStatus === "queued" && obj.promptId) {
                                viewComfyStateDispatcher({
                                    type: ActionType.ADD_TO_QUEUE,
                                    payload: {
                                        sectionName: section,
                                        prompt: {
                                            promptId: obj.promptId,
                                            sectionName: section,
                                            workflowTitle: obj.workflowTitle || "智能体任务",
                                            status: "queued",
                                            queuedAt: Date.now(),
                                        },
                                    },
                                })
                            } else if (obj.promptId) {
                                viewComfyStateDispatcher({
                                    type: ActionType.UPDATE_QUEUE_ITEM,
                                    payload: {
                                        promptId: obj.promptId,
                                        updates: {
                                            status: obj.queueStatus,
                                            ...(obj.realPromptId ? { realPromptId: obj.realPromptId } : {}),
                                            ...(obj.queueStatus === "running" ? { startedAt: Date.now() } : {}),
                                        },
                                    },
                                })
                            }
                        }
                    } catch { /* ignore malformed */ }
                }
            }

            if (errorMsg) throw new Error(errorMsg)
            if (finalMessage) patchSessionMessages(id, (prev) => [...prev, finalMessage])
            else throw new Error("未收到回复")
            await loadSessions()
        } catch (error) {
            if (!controller.signal.aborted) {
                toast.error(error instanceof Error ? error.message : "发送失败")
            }
        } finally {
            setLoading(false)
            setStatus(null)
            setLiveTrace([])
            abortControllerRef.current = null
        }
    }

    const handleStop = () => {
        abortControllerRef.current?.abort()
    }

    const handleSend = async () => {
        const text = input.trim()
        if ((!text && attachments.length === 0) || loading) return
        if (!sessionId) {
            try {
                const res = await fetch("/api/agent/sessions", { method: "POST" })
                const data = await res.json()
                const newId = data.session.id
                setSessionId(newId)
                router.replace("/agent?session=" + newId)
                setSessions((prev) => [{ id: newId, title: text.slice(0, 30) || "新会话", updatedAt: Date.now() }, ...prev])
                await doSend(newId, text, attachments)
            } catch {
                toast.error("创建会话失败")
            }
        } else {
            await doSend(sessionId, text, attachments)
        }
    }

    const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const el = e.target
        setInput(el.value)
        // 内容超出上限（200px）时保持固定高度、交给浏览器原生滚动；
        // 不要每次输入都重设 height="auto"，否则会把 textarea 的滚动条弹回顶部
        if (el.scrollHeight > 200) {
            el.style.height = "200px"
            return
        }
        el.style.height = "auto"
        el.style.height = el.scrollHeight + "px"
    }

    const hasMessages = messages.length > 0 || loading

    const inputBar = (
        <div
            onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = "copy"
                setIsDragging(true)
            }}
            onDragLeave={(e) => {
                e.preventDefault()
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false)
            }}
            onDrop={(e) => {
                e.preventDefault()
                setIsDragging(false)
                const dropped = Array.from(e.dataTransfer.files || [])
                const media = dropped.filter((f) => /^(image|video|audio)\//.test(f.type))
                if (dropped.length > 0 && media.length === 0) {
                    toast.error("仅支持上传图片/视频/音频文件")
                    return
                }
                if (media.length > 0) setAttachments((prev) => [...prev, ...media])
            }}
            className={cn(
                "relative rounded-2xl border bg-background shadow-sm transition-all focus-within:shadow-md",
                isDragging ? "border-primary ring-2 ring-primary/30" : "border-border/60 focus-within:border-border"
            )}
        >
            {isDragging && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-background/80 text-sm font-medium text-foreground">
                    松开以添加文件
                </div>
            )}
            {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 px-3 pt-3">
                    {attachments.map((f, i) => (
                        <FilePreview key={f.name + i} file={f} onRemove={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} />
                    ))}
                </div>
            )}
            <textarea
                ref={textareaRef}
                value={input}
                onChange={handleTextareaChange}
                onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        handleSend()
                    }
                }}
                rows={1}
                placeholder="给智能体发送消息"
                className="w-full resize-none border-0 bg-transparent px-4 py-3 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground focus:ring-0"
            />
            <div className="flex items-center justify-between px-2 pb-2">
                <div>
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept="image/*,video/*,audio/*"
                        className="hidden"
                        onChange={(e) => {
                            const files = Array.from(e.target.files || [])
                            setAttachments((prev) => [...prev, ...files])
                            if (fileInputRef.current) fileInputRef.current.value = ""
                        }}
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        aria-label="上传附件"
                    >
                        <Paperclip className="size-4" />
                    </button>
                </div>
                {loading ? (
                    <button
                        onClick={handleStop}
                        className="flex size-8 items-center justify-center rounded-full bg-foreground text-background transition-colors hover:bg-foreground/80"
                        aria-label="停止输出"
                    >
                        <Square className="size-3.5 fill-current" />
                    </button>
                ) : (
                    <button
                        onClick={handleSend}
                        disabled={!input.trim() && attachments.length === 0}
                        className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
                        aria-label="发送"
                    >
                        <ArrowUp className="size-4" />
                    </button>
                )}
            </div>
        </div>
    )

    return (
        <div className="flex h-[calc(100vh-var(--top-nav-height))]">
            <aside className="flex w-64 shrink-0 flex-col border-r bg-muted/40">
                <div className="p-3">
                    <Button className="w-full justify-start gap-2" onClick={handleNewSession}>
                        <Plus className="size-4" />
                        新对话
                    </Button>
                </div>
                <ScrollArea className="flex-1">
                    <div className="flex min-w-0 flex-col gap-0.5 px-2 pb-3">
                        {sessions.map((s) => (
                            <div
                                key={s.id}
                                className={cn(
                                    "group flex min-w-0 items-center gap-0.5 rounded-lg py-1.5 pl-1 pr-2 text-sm transition-colors",
                                    sessionId === s.id ? "bg-muted" : "hover:bg-muted/60"
                                )}
                            >
                                <button
                                    onClick={() => handleDeleteSession(s.id)}
                                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                                    aria-label="删除会话"
                                >
                                    <Trash2 className="size-3.5" />
                                </button>
                                <button className="min-w-0 flex-1 truncate text-left text-foreground/80" onClick={() => handleSelectSession(s.id)}>
                                    {s.title || "新会话"}
                                </button>
                            </div>
                        ))}
                        {sessions.length === 0 && (
                            <p className="px-2 py-6 text-center text-xs text-muted-foreground">暂无会话</p>
                        )}
                    </div>
                </ScrollArea>
            </aside>

            <main className="flex min-w-0 flex-1 flex-col bg-background">
                {!hasMessages ? (
                    <div className="flex flex-1 flex-col items-center justify-center px-6">
                        <div className="mb-8 text-center">
                            <h1 className="text-2xl font-semibold tracking-tight">你好，我是智能体</h1>
                            <p className="mt-2 text-sm text-muted-foreground">描述你的需求，我会调用工作流为你生成图片、视频或音频</p>
                        </div>
                        <div className="w-full max-w-2xl">{inputBar}</div>
                    </div>
                ) : (
                    <>
                        <div ref={scrollRef} className="flex-1 overflow-y-auto">
                            <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
                                {messages.map((m) => (
                                    <div key={m.id} className={cn("flex gap-3", m.role === "user" && "flex-row-reverse")}>
                                        {m.role === "assistant" && (
                                            <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                                                <Sparkles className="size-3.5 text-muted-foreground" />
                                            </div>
                                        )}
                                        <div className={cn("min-w-0", m.role === "user" ? "max-w-[80%]" : "flex-1")}>
                                            {m.role === "user" ? (
                                                <div className="inline-block rounded-2xl bg-muted px-4 py-2.5 text-[15px] leading-relaxed text-foreground">
                                                    {m.content}
                                                    {m.attachments?.map((a, i) => {
                                                        const mime = a.type || mimeFor(a.name)
                                                        const url = "/api/agent/file/uploads/" + a.name
                                                        if (mime.startsWith("video/")) {
                                                            return <video key={i} src={url} controls className="mt-2 max-h-60 rounded-xl border border-border/50" />
                                                        }
                                                        if (mime.startsWith("audio/")) {
                                                            return <audio key={i} src={url} controls className="mt-2 w-64 max-w-full" />
                                                        }
                                                        return <img key={i} src={url} alt={a.originalName} className="mt-2 max-h-60 rounded-xl border border-border/50" />
                                                    })}
                                                </div>
                                            ) : (
                                                <div className="text-[15px] leading-relaxed text-foreground">
                                                    {m.content && <div className="whitespace-pre-wrap">{m.content}</div>}
                                                    {m.trace && m.trace.length > 0 && (
                                                        <details className="mt-2 rounded-lg border border-border/60 bg-muted/30">
                                                            <summary className="cursor-pointer select-none px-3 py-2 text-xs text-muted-foreground">
                                                                思考过程 · {m.trace.length} 步
                                                            </summary>
                                                            <div className="space-y-1.5 border-t border-border/40 px-3 py-2">
                                                                {m.trace.map((s, i) => (
                                                                    <div key={i} className="text-xs leading-relaxed">
                                                                        <div className="font-medium text-foreground/80">{s.title}</div>
                                                                        {s.detail && <div className="whitespace-pre-wrap text-muted-foreground">{s.detail}</div>}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </details>
                                                    )}
                                                    {m.outputs?.map((o, i) => {
                                                        const output: IOutput = {
                                                            filename: o.name,
                                                            contentType: mimeFor(o.name),
                                                            url: "/api/agent/file/outputs/" + o.name,
                                                            size: 0,
                                                        }
                                                        if (o.type === "video") {
                                                            return <VideoDialog key={i} output={output} showOutputFileName={false} />
                                                        }
                                                        if (o.type === "audio") {
                                                            return <AudioDialog key={i} output={output} />
                                                        }
                                                        return (
                                                            <ImageDialog
                                                                key={i}
                                                                output={output}
                                                                showOutputFileName={false}
                                                                onAddToGallery={(out) => handleAddToGallery(out, o.workflowTitle, o.workflowId)}
                                                                className="mt-3 h-auto max-h-80 w-auto rounded-xl border border-border/50 shadow-sm"
                                                            />
                                                        )
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                {loading && (
                                    <div className="flex gap-3">
                                        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                                            <Sparkles className="size-3.5 text-muted-foreground" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
                                                <Loader2 className="size-4 animate-spin" />
                                                <span>{status || "思考中…"}</span>
                                            </div>
                                            {liveTrace.length > 0 && (
                                                <details open className="mt-1 rounded-lg border border-border/60 bg-muted/30">
                                                    <summary className="cursor-pointer select-none px-3 py-2 text-xs text-muted-foreground">
                                                        思考过程 · {liveTrace.length} 步
                                                    </summary>
                                                    <div className="space-y-1.5 border-t border-border/40 px-3 py-2">
                                                        {liveTrace.map((s, i) => (
                                                            <div key={i} className="text-xs leading-relaxed">
                                                                <div className="font-medium text-foreground/80">{s.title}</div>
                                                                {s.detail && <div className="whitespace-pre-wrap text-muted-foreground">{s.detail}</div>}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </details>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="px-4 pb-4">
                            <div className="mx-auto max-w-3xl">{inputBar}</div>
                        </div>
                    </>
                )}
            </main>
        </div>
    )
}
