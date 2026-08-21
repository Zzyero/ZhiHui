import { type NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import { agentService } from "@/app/services/agent-service";
import { getMimeType } from "@/app/services/comfyui-api-service";

export const dynamic = "force-dynamic";

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ kind: string; name: string }> }
) {
    const { kind, name } = await params;
    if (kind !== "uploads" && kind !== "outputs") {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const filePath = await agentService.resolveFilePath(kind, name);
    if (!filePath) return NextResponse.json({ error: "Not found" }, { status: 404 });

    try {
        const buf = await fs.readFile(filePath);
        return new NextResponse(new Uint8Array(buf), {
            headers: {
                "Content-Type": getMimeType(name),
                "Cache-Control": "public, max-age=3600",
            },
        });
    } catch (error) {
        console.error("GET /api/agent/file failed", error);
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
}
