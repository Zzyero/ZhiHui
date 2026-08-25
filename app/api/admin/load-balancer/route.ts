import { type NextRequest, NextResponse } from "next/server";
import { loadBalancerService } from "@/app/services/load-balancer-service";

export const dynamic = "force-dynamic";

/** 读取负载均衡配置 */
export async function GET() {
    try {
        return NextResponse.json(await loadBalancerService.getConfig());
    } catch (error) {
        console.error("GET /api/admin/load-balancer failed", error);
        return NextResponse.json({ error: "Failed to read load balancer config" }, { status: 500 });
    }
}

/** 保存负载均衡配置 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const config = await loadBalancerService.saveConfig(body ?? {});
        return NextResponse.json(config);
    } catch (error) {
        console.error("POST /api/admin/load-balancer failed", error);
        return NextResponse.json({ error: "Failed to save load balancer config" }, { status: 500 });
    }
}
