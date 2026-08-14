import { NextResponse } from "next/server";
import { monitorService } from "@/app/services/monitor-service";

export const dynamic = "force-dynamic";

/** 硬件监测快照 + 历史 */
export async function GET() {
    try {
        monitorService.start();
        let snapshot = monitorService.getSnapshot();
        if (!snapshot) snapshot = await monitorService.refresh();
        return NextResponse.json(snapshot ?? { error: "warming up" });
    } catch (error) {
        console.error("GET /api/admin/monitor failed", error);
        return NextResponse.json({ error: "Failed to read hardware" }, { status: 500 });
    }
}
