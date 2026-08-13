import { getComfyUIAPIService } from '@/app/services/comfyui-api-service';
import { generationQueue } from '@/app/services/generation-queue';
import { type NextRequest, NextResponse } from 'next/server';

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ promptId: string }> }
) {
    const { promptId } = await params;

    if (!promptId) {
        return new NextResponse("promptId is required", { status: 400 });
    }

    // 从 query string 里读取任务状态：'running'（停止当前任务）或 'queued'（删除排队任务）
    const status = request.nextUrl.searchParams.get('status') || undefined;

    try {
        // 排队中的任务：优先在本地串行队列里取消（尚未提交到 ComfyUI）
        if (status !== 'running') {
            const cancelledLocally = generationQueue.cancel(promptId);
            if (cancelledLocally) {
                return NextResponse.json({ success: true, promptId, cancelled: true, local: true });
            }
        }

        const comfyService = getComfyUIAPIService();
        await comfyService.cancelPrompt(promptId, status);

        return NextResponse.json({ success: true, promptId });
    } catch (error) {
        console.error("Failed to cancel prompt:", error);
        return NextResponse.json(
            { error: "Failed to cancel prompt" },
            { status: 500 }
        );
    }
}
