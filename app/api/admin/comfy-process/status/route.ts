import { NextResponse } from "next/server";
import { comfyProcessManager } from "@/app/services/comfy-process-manager";

export const dynamic = "force-dynamic";

/** 各显卡上 ComfyUI 进程的实时状态 */
export async function GET() {
    try {
        await comfyProcessManager.init();
        await comfyProcessManager.reconcile();
        return NextResponse.json({ processes: comfyProcessManager.getAll() });
    } catch (error) {
        console.error("GET /api/admin/comfy-process/status failed", error);
        return NextResponse.json({ error: "Failed to read process status" }, { status: 500 });
    }
}
