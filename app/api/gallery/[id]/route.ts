import { type NextRequest, NextResponse } from "next/server";
import { galleryService } from "@/app/services/gallery-service";

export const dynamic = "force-dynamic";

/** 删除画廊条目（连同图片文件） */
export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    try {
        const ok = await galleryService.delete(id);
        if (!ok) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("DELETE /api/gallery failed", error);
        return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
    }
}
