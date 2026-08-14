import { type NextRequest, NextResponse } from "next/server";
import { galleryService } from "@/app/services/gallery-service";

export const dynamic = "force-dynamic";

/** 画廊列表 */
export async function GET() {
    try {
        const items = await galleryService.list();
        return NextResponse.json({ items });
    } catch (error) {
        console.error("GET /api/gallery failed", error);
        return NextResponse.json({ error: "Failed to list gallery" }, { status: 500 });
    }
}

/** 添加到画廊：收图片 File + 工作流元信息，解析 PNG 内嵌 prompt 后落盘 */
export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const image = formData.get("image");
        if (!(image instanceof File)) {
            return NextResponse.json({ error: "image is required" }, { status: 400 });
        }

        const sectionName = (formData.get("sectionName") as string) || "智能生图";
        const workflowTitle = (formData.get("workflowTitle") as string) || "";
        const workflowId = (formData.get("workflowId") as string) || "";

        const item = await galleryService.add({
            sectionName,
            workflowTitle,
            workflowId,
            image,
        });
        return NextResponse.json({ item }, { status: 201 });
    } catch (error) {
        console.error("POST /api/gallery failed", error);
        return NextResponse.json({ error: "Failed to add to gallery" }, { status: 500 });
    }
}
