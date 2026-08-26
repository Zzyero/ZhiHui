"use client"

import * as React from "react"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Loader2, Play, Scale, Square } from "lucide-react"
import type { ILoadBalancerConfig } from "@/app/services/load-balancer-service"
import type { IProcessInfo, ProcessStatus } from "@/app/services/comfy-process-manager"
import type { IGPUInfo } from "@/app/services/monitor-service"

interface IRow {
    gpuIndex: number
    name: string
    utilization: number
    port: string
    enabled: boolean
    status: ProcessStatus
    error?: string
    logs?: string[]
}

function statusBadge(status: ProcessStatus) {
    switch (status) {
        case "running":
            return <Badge>运行中</Badge>
        case "starting":
            return <Badge variant="secondary">启动中</Badge>
        case "stopping":
            return <Badge variant="secondary">停止中</Badge>
        case "error":
            return <Badge variant="destructive">出错</Badge>
        default:
            return <Badge variant="outline">已停止</Badge>
    }
}

function buildRows(gpus: IGPUInfo[], config: ILoadBalancerConfig | null): IRow[] {
    return gpus.map((g) => {
        const backend = config?.backends.find((b) => b.gpuIndex === g.cudaIndex)
        return {
            gpuIndex: g.cudaIndex,
            name: g.name,
            utilization: g.utilization,
            port: String(backend?.port ?? 8188 + g.cudaIndex),
            enabled: backend?.enabled ?? g.cudaIndex === 0,
            status: "stopped" as ProcessStatus,
        }
    })
}

export default function ComfyProcessesCard() {
    const [gpus, setGpus] = React.useState<IGPUInfo[]>([])
    const [processes, setProcesses] = React.useState<IProcessInfo[]>([])
    const [rows, setRows] = React.useState<IRow[]>([])
    const [masterEnabled, setMasterEnabled] = React.useState(true)
    const [initialized, setInitialized] = React.useState(false)
    const [saving, setSaving] = React.useState(false)
    const [actionBusy, setActionBusy] = React.useState<number | null>(null)

    React.useEffect(() => {
        let alive = true
        const load = async () => {
            try {
                const [monitorRes, configRes, processRes] = await Promise.all([
                    fetch("/api/admin/monitor", { cache: "no-store" }),
                    fetch("/api/admin/load-balancer", { cache: "no-store" }),
                    fetch("/api/admin/comfy-process/status", { cache: "no-store" }),
                ])
                if (!monitorRes.ok || !configRes.ok || !processRes.ok) return

                const monitor = await monitorRes.json()
                const config: ILoadBalancerConfig = await configRes.json()
                const processData = await processRes.json()

                if (!alive) return

                const detectedGpus: IGPUInfo[] = monitor?.gpus ?? []
                const detectedProcesses: IProcessInfo[] = processData?.processes ?? []
                setGpus(detectedGpus)
                setProcesses(detectedProcesses)

                if (!initialized && detectedGpus.length > 0) {
                    setRows(buildRows(detectedGpus, config))
                    setMasterEnabled(Boolean(config?.enabled))
                    setInitialized(true)
                } else {
                    setRows((prev) => prev.map((row) => {
                        const gpu = detectedGpus.find((g) => g.cudaIndex === row.gpuIndex)
                        const proc = detectedProcesses.find((p) => p.gpuIndex === row.gpuIndex)
                        return {
                            ...row,
                            name: gpu?.name ?? row.name,
                            utilization: gpu?.utilization ?? row.utilization,
                            status: proc?.status ?? row.status,
                            // 端口被占用顺延后，用进程实际端口回填（停止态保留用户输入）
                            port: proc && proc.status !== "stopped" ? String(proc.port) : row.port,
                            error: proc?.error,
                            logs: proc?.logs,
                        }
                    }))
                }
            } catch {
                // 读取失败时保留上次数据
            }
        }
        load()
        const id = setInterval(load, 3000)
        return () => { alive = false; clearInterval(id) }
    }, [initialized])

    const handleToggleProcess = async (row: IRow) => {
        const action = row.status === "running" ? "stop" : "start"
        const nextStatus: ProcessStatus = action === "start" ? "starting" : "stopping"
        setActionBusy(row.gpuIndex)
        // 乐观更新状态，避免按钮在请求返回后、下一轮轮询前闪回「启动/停止」
        setRows((prev) => prev.map((r) => r.gpuIndex === row.gpuIndex ? { ...r, status: nextStatus } : r))
        try {
            const res = await fetch("/api/admin/comfy-process", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ action, gpuIndex: row.gpuIndex }),
            })
            const data = await res.json()
            if (!res.ok) {
                toast.error(data?.message || data?.error || "操作失败")
                // 失败回滚到操作前的状态
                setRows((prev) => prev.map((r) => r.gpuIndex === row.gpuIndex ? { ...r, status: row.status } : r))
            }
        } catch {
            toast.error("操作失败")
            setRows((prev) => prev.map((r) => r.gpuIndex === row.gpuIndex ? { ...r, status: row.status } : r))
        } finally {
            setActionBusy(null)
        }
    }

    const handleSave = async () => {
        setSaving(true)
        try {
            const res = await fetch("/api/admin/load-balancer", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    enabled: masterEnabled,
                    backends: rows.map((r) => ({
                        gpuIndex: r.gpuIndex,
                        name: r.name,
                        port: Number(r.port) || 8188 + r.gpuIndex,
                        enabled: r.enabled,
                    })),
                }),
            })
            if (!res.ok) throw new Error("save failed")
            toast.success("已保存 GPU 调度配置")
        } catch {
            toast.error("保存失败")
        } finally {
            setSaving(false)
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                        <Scale className="size-4" />
                        GPU 调度
                    </span>
                    <div className="flex items-center gap-2">
                        <Label htmlFor="lb-master" className="text-xs text-muted-foreground">负载均衡</Label>
                        <Switch id="lb-master" checked={masterEnabled} onCheckedChange={setMasterEnabled} />
                    </div>
                </CardTitle>
            </CardHeader>
            <CardContent>
                {gpus.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">未检测到 NVIDIA GPU</p>
                ) : (
                    <div className="space-y-3">
                        <p className="text-xs text-muted-foreground">
                            勾选「启用」的显卡参与调度（空闲优先，全忙时交给第一张）；启动/停止可即时生效，端口与启停状态需点「保存配置」。
                        </p>
                        {rows.map((row) => {
                            const proc = processes.find((p) => p.gpuIndex === row.gpuIndex)
                            const busy = actionBusy === row.gpuIndex || row.status === "starting" || row.status === "stopping"
                            return (
                                <div key={row.gpuIndex} className="rounded-lg border p-3">
                                    <div className="flex flex-wrap items-center gap-3">
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-sm font-medium">cuda:{row.gpuIndex} · {row.name}</div>
                                            <div className="text-xs text-muted-foreground">利用率 {row.utilization}%</div>
                                        </div>
                                        {statusBadge(row.status)}
                                        <div className="flex items-center gap-2">
                                            <Label htmlFor={`lb-port-${row.gpuIndex}`} className="text-xs text-muted-foreground">端口</Label>
                                            <Input
                                                id={`lb-port-${row.gpuIndex}`}
                                                className="h-8 w-24"
                                                value={row.port}
                                                onChange={(e) => setRows((prev) => prev.map((r) => r.gpuIndex === row.gpuIndex ? { ...r, port: e.target.value } : r))}
                                            />
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Label htmlFor={`lb-enabled-${row.gpuIndex}`} className="text-xs text-muted-foreground">启用</Label>
                                            <Switch
                                                id={`lb-enabled-${row.gpuIndex}`}
                                                checked={row.enabled}
                                                onCheckedChange={(checked) => setRows((prev) => prev.map((r) => r.gpuIndex === row.gpuIndex ? { ...r, enabled: checked } : r))}
                                            />
                                        </div>
                                        <Button variant="outline" size="sm" disabled={busy} onClick={() => handleToggleProcess(row)}>
                                            {busy ? (
                                                <Loader2 className="mr-1 size-4 animate-spin" />
                                            ) : row.status === "running" ? (
                                                <Square className="mr-1 size-4" />
                                            ) : (
                                                <Play className="mr-1 size-4" />
                                            )}
                                            {row.status === "starting" ? "启动中" : row.status === "stopping" ? "停止中" : row.status === "running" ? "停止" : "启动"}
                                        </Button>
                                    </div>
                                    {row.error && (
                                        <p className="mt-2 text-xs text-destructive">{row.error}</p>
                                    )}
                                    {proc && proc.logs && proc.logs.length > 0 && (
                                        <details className="mt-2">
                                            <summary className="cursor-pointer text-xs text-muted-foreground">最近日志</summary>
                                            <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted p-2 text-[10px] leading-tight">{proc.logs.slice(-10).join("")}</pre>
                                        </details>
                                    )}
                                </div>
                            )
                        })}
                        <Button onClick={handleSave} disabled={saving || rows.length === 0}>
                            {saving ? "保存中…" : "保存配置"}
                        </Button>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
