import { type NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import { galleryService } from "@/app/services/gallery-service";
import { getMimeType } from "@/app/services/comfyui-api-service";

export const dynamic = "force-dynamic";

/** 读取画廊图片文件 */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const item = await galleryService.getItem(id);
    if (!item) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    try {
        const filePath = galleryService.getImageAbsolutePath(item);
        const buf = await fs.readFile(filePath);
        const contentType = getMimeType(item.imagePath);
        return new NextResponse(new Uint8Array(buf), {
            headers: {
                "Content-Type": contentType,
                "Cache-Control": "public, max-age=3600",
            },
        });
    } catch (error) {
        console.error("GET /api/gallery/image failed", error);
        return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }
}
