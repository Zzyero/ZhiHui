import { type NextRequest, NextResponse } from "next/server";
import { agentService, type IAgentProgressEvent } from "@/app/services/agent-service";

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

        const encoder = new TextEncoder();
        const abortController = new AbortController();
        const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
                const emit = (event: IAgentProgressEvent) => {
                    try {
                        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
                    } catch {
                        // 客户端已断开，忽略入队失败
                    }
                };
                try {
                    const assistantMessage = await agentService.chat(sessionId, message, attachments, emit, abortController.signal);
                    emit({ type: "done", message: assistantMessage });
                } catch (error) {
                    if (!abortController.signal.aborted) {
                        emit({ type: "error", error: error instanceof Error ? error.message : String(error) });
                    }
                } finally {
                    try { controller.close(); } catch { /* ignore */ }
                }
            },
            cancel() {
                // 客户端中断（点击停止/断开连接）
                abortController.abort();
            },
        });

        return new NextResponse(stream, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
            },
        });
    } catch (error) {
        console.error("POST /api/agent/chat failed", error);
        const msg = error instanceof Error ? error.message : "Failed to chat";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
