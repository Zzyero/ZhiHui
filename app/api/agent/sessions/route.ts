import { NextResponse } from "next/server";
import { agentService } from "@/app/services/agent-service";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        return NextResponse.json({ sessions: await agentService.listSessions() });
    } catch (error) {
        console.error("GET /api/agent/sessions failed", error);
        return NextResponse.json({ error: "Failed to list sessions" }, { status: 500 });
    }
}

export async function POST() {
    try {
        return NextResponse.json({ session: await agentService.createSession() }, { status: 201 });
    } catch (error) {
        console.error("POST /api/agent/sessions failed", error);
        return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
    }
}
