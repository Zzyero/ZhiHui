import { type NextRequest, NextResponse } from "next/server";
import { comfyProcessManager } from "@/app/services/comfy-process-manager";
import { loadBalancerService } from "@/app/services/load-balancer-service";

export const dynamic = "force-dynamic";

/** 启动/停止某张显卡上的 ComfyUI 进程 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { action, gpuIndex } = body ?? {};
        const index = Number(gpuIndex);
        if (!Number.isInteger(index)) {
            return NextResponse.json({ error: "gpuIndex is required" }, { status: 400 });
        }

        if (action === "start") {
            const config = await loadBalancerService.getConfig();
            const backend = config.backends.find((b) => b.gpuIndex === index);
            if (!backend) {
                return NextResponse.json({ error: "未找到该显卡的配置" }, { status: 404 });
            }
            comfyProcessManager.start(backend);
            return NextResponse.json({ ok: true });
        }

        if (action === "stop") {
            const result = await comfyProcessManager.stop(index);
            return NextResponse.json(result.ok ? { ok: true } : { ok: false, message: result.message }, { status: result.ok ? 200 : 400 });
        }

        return NextResponse.json({ error: "action 必须是 start 或 stop" }, { status: 400 });
    } catch (error) {
        console.error("POST /api/admin/comfy-process failed", error);
        return NextResponse.json({ error: "Failed to manage ComfyUI process" }, { status: 500 });
    }
}
