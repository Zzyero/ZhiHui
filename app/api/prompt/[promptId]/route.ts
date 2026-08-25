import { backendRegistry } from '@/app/services/backend-registry';
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
        // 排队中的任务：优先在所有实例的本地队列里取消（尚未提交到 ComfyUI）
        if (status !== 'running') {
            const cancelledLocally = backendRegistry.cancelLocal(promptId);
            if (cancelledLocally) {
                return NextResponse.json({ success: true, promptId, cancelled: true, local: true });
            }
        }

        // 已提交的任务：找到它所属的实例，中断该实例上的任务
        const routing = backendRegistry.getRouting(promptId);
        if (!routing) {
            return NextResponse.json({ error: "任务不存在或已结束" }, { status: 404 });
        }
        const backend = await backendRegistry.getBackendById(routing.backendId);
        if (!backend) {
            return NextResponse.json({ error: "该任务所属实例已离线" }, { status: 404 });
        }
        await backend.service.cancelPrompt(routing.realPromptId ?? promptId, status);

        return NextResponse.json({ success: true, promptId });
    } catch (error) {
        console.error("Failed to cancel prompt:", error);
        return NextResponse.json(
            { error: "Failed to cancel prompt" },
            { status: 500 }
        );
    }
}
