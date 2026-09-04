"use client"

import * as React from "react"
import type { IAgentMessage, IAgentSessionSummary } from "@/app/services/agent-service"

/**
 * 智能体页面跨路由状态缓存。
 * 侧栏切换只卸载各个路由的 page 组件，根布局（layout-client）不会卸载。
 * 把智能体页的会话状态放到这里，切到别的页面再切回来时直接恢复，
 * 不会清空列表/消息重新加载；浏览器整页刷新才会回到初始状态。
 */
interface IAgentUiContextValue {
    sessions: IAgentSessionSummary[]
    setSessions: React.Dispatch<React.SetStateAction<IAgentSessionSummary[]>>
    /** 本次布局生命周期内是否已成功拉取过会话列表（避免切回时重复请求） */
    sessionsLoaded: boolean
    setSessionsLoaded: React.Dispatch<React.SetStateAction<boolean>>
    sessionId: string | null
    setSessionId: React.Dispatch<React.SetStateAction<string | null>>
    /** 每个会话的消息缓存，切会话 / 切页面回来都直接展示 */
    messagesBySession: Record<string, IAgentMessage[]>
    setMessagesBySession: React.Dispatch<React.SetStateAction<Record<string, IAgentMessage[]>>>
    /** 当前输入框草稿与待发送附件 */
    input: string
    setInput: React.Dispatch<React.SetStateAction<string>>
    attachments: File[]
    setAttachments: React.Dispatch<React.SetStateAction<File[]>>
}

const AgentUiContext = React.createContext<IAgentUiContextValue | undefined>(undefined)

export function AgentUiProvider({ children }: { children: React.ReactNode }) {
    const [sessions, setSessions] = React.useState<IAgentSessionSummary[]>([])
    const [sessionsLoaded, setSessionsLoaded] = React.useState(false)
    const [sessionId, setSessionId] = React.useState<string | null>(null)
    const [messagesBySession, setMessagesBySession] = React.useState<Record<string, IAgentMessage[]>>({})
    const [input, setInput] = React.useState("")
    const [attachments, setAttachments] = React.useState<File[]>([])

    const value = React.useMemo<IAgentUiContextValue>(
        () => ({
            sessions,
            setSessions,
            sessionsLoaded,
            setSessionsLoaded,
            sessionId,
            setSessionId,
            messagesBySession,
            setMessagesBySession,
            input,
            setInput,
            attachments,
            setAttachments,
        }),
        [sessions, sessionsLoaded, sessionId, messagesBySession, input, attachments]
    )

    return <AgentUiContext.Provider value={value}>{children}</AgentUiContext.Provider>
}

export function useAgentUi(): IAgentUiContextValue {
    const ctx = React.useContext(AgentUiContext)
    if (!ctx) throw new Error("useAgentUi 必须在 <AgentUiProvider> 内使用")
    return ctx
}
