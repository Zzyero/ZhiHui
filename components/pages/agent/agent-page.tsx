"use client"

import * as React from "react"
import { toast } from "sonner"
import type { IAgentMessage, IAgentSessionSummary } from "@/app/services/agent-service"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { ArrowUp, Loader2, MessageSquare, Paperclip, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react"
import { ImageDialog, type IOutput } from "@/components/pages/playground/playground-page"

function mimeFor(name: string): string {
    const ext = name.toLowerCase().split(".").pop() || ""
    const map: Record<string, string> = {
        png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
        mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav",
    }
    return map[ext] || "image/png"
}

export default function AgentPage() {
    const [sessions, setSessions] = React.useState<IAgentSessionSummary[]>([])
    const [sessionId, setSessionId] = React.useState<string | null>(null)
    const [messages, setMessages] = React.useState<IAgentMessage[]>([])
    const [input, setInput] = React.useState("")
    const [attachments, setAttachments] = React.useState<File[]>([])
    const [loading, setLoading] = React.useState(false)
    const fileInputRef = React.useRef<HTMLInputElement>(null)
    const textareaRef = React.useRef<HTMLTextAreaElement>(null)
    const scrollRef = React.useRef<HTMLDivElement>(null)
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
        if (textareaRef.current) textareaRef.current.style.height = "auto"

        const formData = new FormData()
        formData.append("sessionId", id)
        formData.append("message", text)
        for (const f of files) formData.append("file", f)

        try {
            const res = await fetch("/api/agent/chat", { method: "POST", body: formData })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "发送失败")
            setMessages((prev) => [...prev, data.message])
            await loadSessions()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "发送失败")
        } finally {
            setLoading(false)
        }
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
                <button
                    onClick={handleSend}
                    disabled={loading || (!input.trim() && attachments.length === 0)}
                    className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
                    aria-label="发送"
                >
                    {loading ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
                </button>
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
                                                    {m.images?.map((img, i) => (
                                                        <ImageDialog
                                                            key={i}
                                                            output={{
                                                                filename: img.name,
                                                                contentType: mimeFor(img.name),
                                                                url: "/api/agent/file/outputs/" + img.name,
                                                                size: 0,
                                                            }}
                                                            showOutputFileName={false}
                                                            onAddToGallery={(output) => handleAddToGallery(output, img.workflowTitle, img.workflowId)}
                                                            className="mt-3 h-auto max-h-80 w-auto rounded-xl border border-border/50 shadow-sm"
                                                        />
                                                    ))}
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
                                        <div className="flex items-center gap-1 py-1">
                                            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
                                            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: "0.15s" }} />
                                            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: "0.3s" }} />
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
