import { type NextRequest, NextResponse } from 'next/server';

const COMFY_HOST = process.env.COMFYUI_API_URL || "127.0.0.1:8188";
const COMFY_SECURE = process.env.COMFYUI_SECURE === "true";
const COMFY_PROTOCOL = COMFY_SECURE ? "https" : "http";
const COMFY_BASE_URL = `${COMFY_PROTOCOL}://${COMFY_HOST}`;

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const filename = searchParams.get("filename");
        if (!filename) {
            return NextResponse.json({ error: "filename is required" }, { status: 400 });
        }
        const upstream = new URL(`${COMFY_BASE_URL}/view`);
        upstream.searchParams.set("filename", filename);
        const subfolder = searchParams.get("subfolder");
        if (subfolder) upstream.searchParams.set("subfolder", subfolder);
        upstream.searchParams.set("type", searchParams.get("type") ?? "output");

        const res = await fetch(upstream.toString(), { cache: "no-store" });
        if (!res.ok) {
            return NextResponse.json({ error: `ComfyUI /view returned ${res.status}` }, { status: res.status === 404 ? 404 : 502 });
        }
        const contentType = res.headers.get("content-type") ?? "application/octet-stream";
        const buf = await res.arrayBuffer();
        return new NextResponse(buf, {
            headers: {
                "Content-Type": contentType,
                "Cache-Control": "public, max-age=3600",
            },
        });
    } catch (error) {
        console.error("Failed to proxy ComfyUI /view", error);
        return NextResponse.json({ error: "Failed to reach ComfyUI" }, { status: 502 });
    }
}