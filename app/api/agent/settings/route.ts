import { type NextRequest, NextResponse } from "next/server";
import { agentSettingsService } from "@/app/services/agent-settings-service";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        return NextResponse.json(await agentSettingsService.getSettings());
    } catch (error) {
        console.error("GET /api/agent/settings failed", error);
        return NextResponse.json({ error: "Failed to read settings" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const settings = await agentSettingsService.saveSettings(body ?? {});
        return NextResponse.json(settings);
    } catch (error) {
        console.error("POST /api/agent/settings failed", error);
        return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
    }
}
