import { type NextRequest, NextResponse } from "next/server";
import { agentSettingsService } from "@/app/services/agent-settings-service";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        // 返回脱敏后的公开配置，绝不把 apiKey 明文下发到浏览器
        return NextResponse.json(await agentSettingsService.getPublicSettings());
    } catch (error) {
        console.error("GET /api/agent/settings failed", error);
        return NextResponse.json({ error: "Failed to read settings" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        await agentSettingsService.saveSettings(body ?? {});
        // 保存后同样只返回脱敏后的公开配置，避免 apiKey 明文回传
        return NextResponse.json(await agentSettingsService.getPublicSettings());
    } catch (error) {
        console.error("POST /api/agent/settings failed", error);
        return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
    }
}
