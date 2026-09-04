import { type NextRequest, NextResponse } from "next/server";

/**
 * 智能体相关页面的访问控制（Next.js 16 的 proxy，即原 middleware）。
 *
 * 覆盖范围：/agent 页面 + 所有 /api/agent/* 路由（会话、聊天、设置、文件）。
 *
 * 认证策略：
 * - 设置了环境变量 AGENT_AUTH_PASSWORD 时：要求 HTTP Basic 认证
 *   （用户名取自 AGENT_AUTH_USER，默认 admin）。
 * - 未设置密码时：仅允许本机回环访问（Host 为 localhost / 127.0.0.1 / ::1），
 *   这样本地开发零配置即可用，一旦把服务暴露到非本机网络默认会被拒绝。
 *   注意：Host 头可被伪造，这只是“防止误暴露”的兜底；要对外提供服务请务必设置密码。
 */
const AUTH_USER = process.env.AGENT_AUTH_USER || "admin";
const AUTH_PASSWORD = process.env.AGENT_AUTH_PASSWORD || "";

function isLoopbackHost(request: NextRequest): boolean {
    const host = (request.headers.get("host") || "").toLowerCase();
    // 去掉端口与 IPv6 方括号，得到裸主机名
    const bare = host.replace(/:\d+$/, "").replace(/^\[/, "").replace(/\]$/, "");
    return bare === "localhost" || bare === "127.0.0.1" || bare === "::1";
}

function checkBasicAuth(request: NextRequest): boolean {
    const header = request.headers.get("authorization") || "";
    if (!header.startsWith("Basic ")) return false;
    try {
        const decoded = atob(header.slice(6).trim());
        const idx = decoded.indexOf(":");
        if (idx === -1) return false;
        const user = decoded.slice(0, idx);
        const pass = decoded.slice(idx + 1);
        return user === AUTH_USER && pass === AUTH_PASSWORD;
    } catch {
        return false;
    }
}

export default function proxy(request: NextRequest) {
    const authorized = AUTH_PASSWORD ? checkBasicAuth(request) : isLoopbackHost(request);
    if (authorized) return NextResponse.next();

    if (AUTH_PASSWORD) {
        return new NextResponse("Unauthorized", {
            status: 401,
            headers: {
                "WWW-Authenticate": 'Basic realm="ZhiHui Agent", charset="UTF-8"',
            },
        });
    }
    return new NextResponse(
        "Forbidden: agent endpoints are restricted to localhost. Set AGENT_AUTH_PASSWORD to allow remote access.",
        { status: 403 },
    );
}

export const config = {
    matcher: ["/agent/:path*", "/api/agent/:path*"],
};
