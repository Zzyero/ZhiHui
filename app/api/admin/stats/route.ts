import { NextResponse } from "next/server";
import { statsService } from "@/app/services/stats-service";

export const dynamic = "force-dynamic";

/** 使用统计 */
export async function GET() {
    try {
        const stats = await statsService.getStats();
        return NextResponse.json(stats);
    } catch (error) {
        console.error("GET /api/admin/stats failed", error);
        return NextResponse.json({ error: "Failed to read stats" }, { status: 500 });
    }
}
