import { getComfyUIAPIService } from '@/app/services/comfyui-api-service';
import { NextResponse } from 'next/server';

// 队列状态是实时变化的，禁止静态化/缓存
export const dynamic = 'force-dynamic';

/**
 * 供浏览器轮询的 ComfyUI 队列状态接口。
 * 浏览器无法直接订阅服务端与 ComfyUI 之间的 WebSocket，故通过 HTTP 轮询获取。
 */
export async function GET() {
    try {
        const status = await getComfyUIAPIService().fetchQueueStatus();
        return NextResponse.json(status);
    } catch (error) {
        console.error("Failed to get ComfyUI queue status:", error);
        return NextResponse.json({ queueRemaining: 0, currentlyRunning: 0 });
    }
}
