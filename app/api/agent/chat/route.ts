import { type NextRequest, NextResponse } from "next/server";
import { agentService } from "@/app/services/agent-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const sessionId = (formData.get("sessionId") as string) || "";
        const message = (formData.get("message") as string) || "";

        const attachments: { file: File }[] = [];
        for (const value of Array.from(formData.values())) {
            if (value instanceof File) attachments.push({ file: value });
        }

        if (!sessionId) return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
        if (!message && attachments.length === 0) {
            return NextResponse.json({ error: "message is required" }, { status: 400 });
        }

        const assistantMessage = await agentService.chat(sessionId, message, attachments);
        return NextResponse.json({ message: assistantMessage });
    } catch (error) {
        console.error("POST /api/agent/chat failed", error);
        const msg = error instanceof Error ? error.message : "Failed to chat";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
