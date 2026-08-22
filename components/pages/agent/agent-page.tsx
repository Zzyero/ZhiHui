"use client"

import * as React from "react"
import { toast } from "sonner"
import type { IAgentMessage, IAgentSessionSummary } from "@/app/services/agent-service"
import { useViewComfy, ActionType } from "@/app/providers/view-comfy-provider"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { ArrowUp, Loader2, MessageSquare, Paperclip, Pencil, Plus, Sparkles, Square, Trash2, X } from "lucide-react"
interface IAgentOutputView {
    filename: string
    contentType: string
    url: string
    size: number
}

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

export default function AgentPage() {
    const [sessions, setSessions] = React.useState<IAgentSessionSummary[]>([])
    const [sessionId, setSessionId] = React.useState<string | null>(null)
    const [messages, setMessages] = React.useState<IAgentMessage[]>([])
    const [input, setInput] = React.useState("")
    const [attachments, setAttachments] = React.useState<File[]>([])
    const [loading, setLoading] = React.useState(false)
    const [status, setStatus] = React.useState<string | null>(null)
    const { viewComfyStateDispatcher } = useViewComfy()
    const fileInputRef = React.useRef<HTMLInputElement>(null)
    const textareaRef = React.useRef<HTMLTextAreaElement>(null)
    const scrollRef = React.useRef<HTMLDivElement>(null)
    const abortControllerRef = React.useRef<AbortController | null>(null)
    const [renamingId, setRenamingId] = React.useState<string | null>(null)
    const [renameValue, setRenameValue] = React.useState("")
    const renameBlurSkipRef = React.useRef(false)

    const loadSessions = React.useCallback(async () => {
        try {
            const res = await fetch("/api/agent/sessions")
            if (!res.ok) return
            const data = await res.json()
            setSessions(data.sessions || [])
        } catch {
            // 忽略
        }
    }, [])

    React.useEffect(() => { loadSessions() }, [loadSessions])

    React.useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
    }, [messages, loading])

    const handleSelectSession = async (id: string) => {
        setSessionId(id)
        setAttachments([])
        try {
            const res = await fetch("/api/agent/sessions/" + id)
            if (!res.ok) return
            const data = await res.json()
            setMessages(data.session?.messages || [])
        } catch {
            // 忽略
        }
    }

    const handleNewSession = () => {
        setSessionId(null)
        setMessages([])
        setInput("")
        setAttachments([])
    }

    const handleDeleteSession = async (id: string) => {
        try {
            await fetch("/api/agent/sessions/" + id, { method: "DELETE" })
            if (sessionId === id) handleNewSession()
            await loadSessions()
        } catch {
            toast.error("删除失败")
        }
    }

    const handleAddToGallery = async (output: IAgentOutputView, workflowTitle?: string, workflowId?: string) => {
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

    const startRename = (s: IAgentSessionSummary) => {
        setRenamingId(s.id)
        setRenameValue(s.title || "")
    }

    const confirmRename = async (id: string) => {
        const title = renameValue.trim()
        renameBlurSkipRef.current = true
        setRenamingId(null)
        setRenameValue("")
        if (!title) return
        try {
            const res = await fetch("/api/agent/sessions/" + id, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ title }),
            })
            if (!res.ok) throw new Error("rename failed")
            await loadSessions()
        } catch {
            toast.error("重命名失败")
        }
    }

    const cancelRename = () => {
        renameBlurSkipRef.current = true
        setRenamingId(null)
        setRenameValue("")
    }

    const doSend = async (id: string, text: string, files: File[]) => {
        const userMsg: IAgentMessage = {
            id: "temp-" + Date.now(),
            role: "user",
            content: text,
            attachments: files.map((f) => ({ name: f.name, originalName: f.name, type: f.type })),
            createdAt: Date.now(),
        }
        setMessages((prev) => [...prev, userMsg])
        setInput("")
        setAttachments([])
        setLoading(true)
        setStatus("思考中…")
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
            if (finalMessage) setMessages((prev) => [...prev, finalMessage])
            else throw new Error("未收到回复")
            await loadSessions()
        } catch (error) {
            if (!controller.signal.aborted) {
                toast.error(error instanceof Error ? error.message : "发送失败")
            }
        } finally {
            setLoading(false)
            setStatus(null)
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
        setInput(e.target.value)
        const el = e.target
        el.style.height = "auto"
        el.style.height = Math.min(el.scrollHeight, 200) + "px"
    }

    const hasMessages = messages.length > 0 || loading

    const inputBar = (
        <div className="rounded-2xl border border-border/60 bg-background shadow-sm transition-shadow focus-within:border-border focus-within:shadow-md">
            {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 px-3 pt-3">
                    {attachments.map((f, i) => (
                        <div key={i} className="flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1 text-xs text-foreground/80">
                            <span className="max-w-40 truncate">{f.name}</span>
                            <button onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-foreground" aria-label="移除附件">
                                <X className="size-3" />
                            </button>
                        </div>
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
                    <div className="flex flex-col gap-0.5 px-2 pb-3">
                        {sessions.map((s) => (
                            <div
                                key={s.id}
                                className={cn(
                                    "group flex items-center gap-1 rounded-lg px-2 py-2 text-sm transition-colors",
                                    sessionId === s.id ? "bg-muted" : "hover:bg-muted/60"
                                )}
                            >
                                <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                                {renamingId === s.id ? (
                                    <input
                                        autoFocus
                                        value={renameValue}
                                        onChange={(e) => setRenameValue(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                e.preventDefault()
                                                confirmRename(s.id)
                                            } else if (e.key === "Escape") {
                                                cancelRename()
                                            }
                                        }}
                                        onBlur={() => {
                                            if (renameBlurSkipRef.current) {
                                                renameBlurSkipRef.current = false
                                                return
                                            }
                                            confirmRename(s.id)
                                        }}
                                        className="min-w-0 flex-1 rounded border border-input bg-background px-1.5 py-0.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                                    />
                                ) : (
                                    <button className="min-w-0 flex-1 truncate text-left text-foreground/80" onClick={() => handleSelectSession(s.id)}>
                                        {s.title || "新会话"}
                                    </button>
                                )}
                                <button
                                    onClick={() => startRename(s)}
                                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover:opacity-100"
                                    aria-label="重命名"
                                >
                                    <Pencil className="size-3.5" />
                                </button>
                                <button
                                    onClick={() => handleDeleteSession(s.id)}
                                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-destructive"
                                    aria-label="删除会话"
                                >
                                    <Trash2 className="size-3.5" />
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
                                                    {m.attachments?.map((a, i) => (
                                                        <img key={i} src={"/api/agent/file/uploads/" + a.name} alt={a.originalName} className="mt-2 max-h-60 rounded-xl border border-border/50" />
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="text-[15px] leading-relaxed text-foreground">
                                                    {m.content && <div className="whitespace-pre-wrap">{m.content}</div>}
                                                    {m.outputs?.map((o, i) => {
                                                        const output: IAgentOutputView = {
                                                            filename: o.name,
                                                            contentType: mimeFor(o.name),
                                                            url: "/api/agent/file/outputs/" + o.name,
                                                            size: 0,
                                                        }
                                                        if (o.type === "video") {
                                                            return <video key={i} src={output.url} controls className="mt-3 max-h-80 w-full rounded-xl border border-border/50" />
                                                        }
                                                        if (o.type === "audio") {
                                                            return <audio key={i} src={output.url} controls className="mt-3 w-full" />
                                                        }
                                                        return (
                                                            <div key={i} className="mt-3">
                                                                <a href={output.url} target="_blank" rel="noreferrer">
                                                                    <img src={output.url} alt={output.filename} className="max-h-80 w-auto rounded-xl border border-border/50 shadow-sm" />
                                                                </a>
                                                                <div className="mt-2">
                                                                    <Button variant="outline" size="sm" onClick={() => handleAddToGallery(output, o.workflowTitle, o.workflowId)}>
                                                                        添加到画廊
                                                                    </Button>
                                                                </div>
                                                            </div>
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
                                        <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
                                            <Loader2 className="size-4 animate-spin" />
                                            <span>{status || "思考中…"}</span>
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
