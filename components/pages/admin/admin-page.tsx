"use client"

import * as React from "react"
import {
    ResponsiveContainer,
    AreaChart,
    Area,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    Tooltip,
    CartesianGrid,
} from "recharts"
import {
    Activity,
    Cpu,
    Gauge,
    HardDrive,
    Image as ImageIcon,
    Pause,
    Play,
    RefreshCw,
    Thermometer,
    Timer,
    TrendingUp,
    Zap,
    type LucideIcon,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { IMonitorSnapshot, IGPUInfo } from "@/app/services/monitor-service"
import type { IStatsData } from "@/app/services/stats-service"
import AgentSettingsCard from "@/components/pages/admin/agent-settings-card"

function localDateKey(ts: number): string {
    const d = new Date(ts)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    return y + "-" + m + "-" + day
}

function formatBytes(bytes: number): string {
    if (!bytes) return "0 B"
    const gb = bytes / 1073741824
    if (gb >= 1) return gb.toFixed(1) + " GB"
    return (bytes / 1048576).toFixed(0) + " MB"
}

function formatDuration(ms: number): string {
    if (!ms) return "0s"
    const s = ms / 1000
    if (s < 60) return s.toFixed(1) + "s"
    const m = Math.floor(s / 60)
    return m + "m " + Math.round(s % 60) + "s"
}

function utilColor(pct: number): string {
    if (pct >= 85) return "#ef4444"
    if (pct >= 60) return "#f59e0b"
    return "#22c55e"
}

function tempColor(c: number): string {
    if (c >= 80) return "#ef4444"
    if (c >= 60) return "#f59e0b"
    return "#22c55e"
}

const tooltipStyle = {
    backgroundColor: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "8px",
    color: "hsl(var(--foreground))",
    fontSize: "12px",
}

function Ring({ value, max, color, size = 92, strokeWidth = 9, children }: {
    value: number
    max: number
    color: string
    size?: number
    strokeWidth?: number
    children?: React.ReactNode
}) {
    const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
    const r = (size - strokeWidth) / 2
    const c = 2 * Math.PI * r
    const dash = (pct / 100) * c
    return (
        <div className="relative shrink-0" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="-rotate-90">
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    strokeWidth={strokeWidth}
                    className="text-muted-foreground"
                    stroke="currentColor"
                    fill="none"
                    opacity={0.12}
                />
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    strokeWidth={strokeWidth}
                    stroke={color}
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray={dash + " " + (c - dash)}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
        </div>
    )
}

function UsageBar({ value, className }: { value: number; className?: string }) {
    const pct = Math.max(0, Math.min(100, value));
    return (
        <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-gray-300 dark:bg-gray-600", className)}>
            <div className="h-full rounded-full bg-black transition-all" style={{ width: pct + "%" }} />
        </div>
    );
}

function StatCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: React.ReactNode }) {
    return (
        <Card>
            <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{label}</span>
                    <Icon className="size-4 text-muted-foreground" />
                </div>
                <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
            </CardContent>
        </Card>
    )
}

function GpuCard({ gpu }: { gpu: IGPUInfo }) {
    const memPct = gpu.memoryTotal > 0 ? (gpu.memoryUsed / gpu.memoryTotal) * 100 : 0
    return (
        <div className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-4">
                <Ring value={gpu.utilization} max={100} color={utilColor(gpu.utilization)}>
                    <span className="text-lg font-semibold tabular-nums">{gpu.utilization}%</span>
                    <span className="text-[10px] text-muted-foreground">利用率</span>
                </Ring>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{gpu.name}</div>
                    <div className="mt-3 space-y-2">
                        <div>
                            <div className="flex justify-between text-xs text-muted-foreground">
                                <span>显存</span>
                                <span className="tabular-nums">{gpu.memoryUsed} / {gpu.memoryTotal} MiB</span>
                            </div>
                            <UsageBar value={memPct} className="mt-1" />
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                                <Thermometer className="size-3.5" style={{ color: tempColor(gpu.temperature) }} />
                                {gpu.temperature}°C
                            </span>
                            <span className="inline-flex items-center gap-1">
                                <Zap className="size-3.5" />
                                {gpu.powerDraw} / {gpu.powerLimit} W
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default function AdminPage() {
    const [monitor, setMonitor] = React.useState<IMonitorSnapshot | null>(null)
    const [stats, setStats] = React.useState<IStatsData | null>(null)
    const [paused, setPaused] = React.useState(false)
    const [refreshKey, setRefreshKey] = React.useState(0)
    const [lastUpdated, setLastUpdated] = React.useState<number | null>(null)
    const [monitorError, setMonitorError] = React.useState(false)

    React.useEffect(() => {
        if (paused) return
        let alive = true
        const load = async () => {
            try {
                const res = await fetch("/api/admin/monitor", { cache: "no-store" })
                if (!res.ok) throw new Error("monitor failed")
                const data = await res.json()
                if (alive && data && data.timestamp) {
                    setMonitor(data)
                    setMonitorError(false)
                    setLastUpdated(Date.now())
                }
            } catch {
                if (alive) setMonitorError(true)
            }
        }
        load()
        const id = setInterval(load, 3000)
        return () => { alive = false; clearInterval(id) }
    }, [paused, refreshKey])

    React.useEffect(() => {
        if (paused) return
        let alive = true
        const load = async () => {
            try {
                const res = await fetch("/api/admin/stats", { cache: "no-store" })
                if (!res.ok) throw new Error("stats failed")
                const data = await res.json()
                if (alive && data) setStats(data)
            } catch {
                // 统计失败时保留上次数据
            }
        }
        load()
        const id = setInterval(load, 10000)
        return () => { alive = false; clearInterval(id) }
    }, [paused, refreshKey])

    const totalGenerations = stats?.totalGenerations ?? 0
    const totalImages = stats?.totalImages ?? 0
    const todayImages = stats?.byDay?.[localDateKey(Date.now())]?.images ?? 0
    const avgElapsedMs = totalGenerations > 0 ? (stats?.totalElapsedMs ?? 0) / totalGenerations : 0

    const dailyData = React.useMemo(() => {
        const days: { date: string; images: number }[] = []
        for (let i = 13; i >= 0; i--) {
            const d = new Date(Date.now() - i * 86400000)
            const key = localDateKey(d.getTime())
            days.push({ date: key.slice(5), images: stats?.byDay?.[key]?.images ?? 0 })
        }
        return days
    }, [stats])

    const gpuHistory = React.useMemo(() => {
        const h = monitor?.history
        if (!h || h.timestamps.length === 0) return []
        return h.timestamps.map((t, i) => ({ t: new Date(t).toLocaleTimeString(), gpu: h.gpuUtilization[i] ?? 0 }))
    }, [monitor])

    const cpu = monitor?.cpu
    const memory = monitor?.memory

    return (
        <div className="flex h-[calc(100vh-var(--top-nav-height))] flex-col">
            <div className="flex items-center justify-between px-4 pt-4">
                <div>
                    <h1 className="text-lg font-semibold">管理</h1>
                    <p className="text-xs text-muted-foreground">设备硬件与使用情况监测</p>
                </div>
                <div className="flex items-center gap-2">
                    {lastUpdated && (
                        <span className="hidden text-xs text-muted-foreground sm:inline">
                            更新于 {new Date(lastUpdated).toLocaleTimeString()}
                        </span>
                    )}
                    <Button variant="outline" size="sm" onClick={() => setPaused((p) => !p)}>
                        {paused ? <Play className="mr-1 size-4" /> : <Pause className="mr-1 size-4" />}
                        {paused ? "继续" : "暂停"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)} aria-label="刷新">
                        <RefreshCw className="size-4" />
                    </Button>
                </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                    <StatCard icon={Activity} label="总生成次数" value={totalGenerations} />
                    <StatCard icon={ImageIcon} label="总生成图片" value={totalImages} />
                    <StatCard icon={TrendingUp} label="今日生成图片" value={todayImages} />
                    <StatCard icon={Timer} label="平均耗时" value={formatDuration(avgElapsedMs)} />
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Gauge className="size-4" />
                            GPU
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {!monitor ? (
                            monitorError ? (
                                <p className="py-10 text-center text-sm text-muted-foreground">无法读取硬件信息</p>
                            ) : (
                                <div className="space-y-3">
                                    <Skeleton className="h-24 w-full" />
                                    <Skeleton className="h-40 w-full" />
                                </div>
                            )
                        ) : !monitor.gpuAvailable ? (
                            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                                <Gauge className="mb-3 size-10 opacity-40" />
                                <p className="text-sm">未检测到 NVIDIA GPU</p>
                                <p className="mt-1 text-xs">请确认已安装 NVIDIA 驱动并可在终端运行 nvidia-smi</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                                    {monitor.gpus.map((gpu) => <GpuCard key={gpu.index} gpu={gpu} />)}
                                </div>
                                <div>
                                    <div className="mb-2 text-xs text-muted-foreground">GPU 利用率（最近 {gpuHistory.length} 次采样）</div>
                                    {gpuHistory.length < 2 ? (
                                        <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">正在积累历史数据…</div>
                                    ) : (
                                        <div className="h-40">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <AreaChart data={gpuHistory} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                                                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                                                    <XAxis dataKey="t" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={24} />
                                                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                                                    <Tooltip contentStyle={tooltipStyle} />
                                                    <Area type="monotone" dataKey="gpu" stroke="#22c55e" strokeWidth={2} fill="#22c55e" fillOpacity={0.15} name="GPU 利用率 %" />
                                                </AreaChart>
                                            </ResponsiveContainer>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>

                <div className="grid gap-4 lg:grid-cols-2">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Cpu className="size-4" />
                                CPU
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {!monitor || !cpu ? (
                                <Skeleton className="h-28 w-full" />
                            ) : (
                                <div className="space-y-3">
                                    <div className="flex items-center gap-4">
                                        <Ring value={cpu.usagePercent} max={100} color={utilColor(cpu.usagePercent)} size={72} strokeWidth={7}>
                                            <span className="text-base font-semibold tabular-nums">{Math.round(cpu.usagePercent)}%</span>
                                        </Ring>
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-medium">{cpu.model || "CPU"}</div>
                                            <div className="text-xs text-muted-foreground">{cpu.cores} 核</div>
                                            {monitor.platform === "linux" && (
                                                <div className="text-xs text-muted-foreground tabular-nums">loadavg {cpu.loadAvg.map((v) => v.toFixed(2)).join(" / ")}</div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                        {cpu.perCore.map((p, i) => (
                                            <div key={i} className="h-3 w-2 rounded-sm" style={{ backgroundColor: utilColor(p) }} title={"核 " + i + ": " + p + "%"} />
                                        ))}
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <HardDrive className="size-4" />
                                内存
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {!monitor || !memory ? (
                                <Skeleton className="h-28 w-full" />
                            ) : (
                                <div className="space-y-3">
                                    <div className="flex items-end justify-between">
                                        <span className="text-2xl font-semibold tabular-nums">{Math.round(memory.usagePercent)}%</span>
                                        <span className="text-xs text-muted-foreground tabular-nums">{formatBytes(memory.used)} / {formatBytes(memory.total)}</span>
                                    </div>
                                    <UsageBar value={memory.usagePercent} className="h-2.5" />
                                    <div className="text-xs text-muted-foreground">
                                        运行时长 {(() => { const u = monitor.uptime; const d = Math.floor(u / 86400); const h = Math.floor((u % 86400) / 3600); const m = Math.floor((u % 3600) / 60); return d > 0 ? d + " 天 " + h + " 小时" : h > 0 ? h + " 小时 " + m + " 分" : m + " 分" })()}
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <TrendingUp className="size-4" />
                            每日生成图片
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="h-56 text-primary">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={dailyData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} vertical={false} />
                                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={16} />
                                    <YAxis allowDecimals={false} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                                    <Bar dataKey="images" fill="currentColor" radius={[4, 4, 0, 0]} name="生成图片" />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                <AgentSettingsCard />
            </div>
        </div>
    )
}
