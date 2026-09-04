"use client"

import * as React from "react"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Settings } from "lucide-react"
import type { IAgentSettingsPublic } from "@/app/services/agent-settings-service"

export default function AgentSettingsCard() {
    const [baseUrl, setBaseUrl] = React.useState("")
    const [apiKey, setApiKey] = React.useState("")
    const [model, setModel] = React.useState("")
    const [hasApiKey, setHasApiKey] = React.useState(false)
    const [saving, setSaving] = React.useState(false)

    React.useEffect(() => {
        (async () => {
            try {
                const res = await fetch("/api/agent/settings")
                if (!res.ok) return
                const data: IAgentSettingsPublic = await res.json()
                setBaseUrl(data.baseUrl || "")
                setModel(data.model || "")
                // apiKey 不再下发明文，只显示“已配置”状态
                setHasApiKey(Boolean(data.hasApiKey))
            } catch {
                // 读取失败时保持空值
            }
        })()
    }, [])

    const handleSave = async () => {
        setSaving(true)
        try {
            const res = await fetch("/api/agent/settings", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ baseUrl, apiKey, model }),
            })
            if (!res.ok) throw new Error("save failed")
            toast.success("已保存模型设置")
        } catch {
            toast.error("保存失败")
        } finally {
            setSaving(false)
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Settings className="size-4" />
                    设置
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="space-y-3">
                    <div className="grid gap-1.5">
                        <Label htmlFor="agent-base-url">Base URL</Label>
                        <Input id="agent-base-url" placeholder="http://localhost:11434/v1" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
                    </div>
                    <div className="grid gap-1.5">
                        <Label htmlFor="agent-api-key">API Key（本地可留空）</Label>
                        <Input
                            id="agent-api-key"
                            type="password"
                            placeholder={hasApiKey ? "已配置（留空保持不变）" : "sk-..."}
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                        />
                    </div>
                    <div className="grid gap-1.5">
                        <Label htmlFor="agent-model">模型名</Label>
                        <Input id="agent-model" placeholder="qwen2.5:7b / deepseek-chat" value={model} onChange={(e) => setModel(e.target.value)} />
                    </div>
                    <Button onClick={handleSave} disabled={saving}>
                        {saving ? "保存中…" : "保存"}
                    </Button>
                </div>
            </CardContent>
        </Card>
    )
}
