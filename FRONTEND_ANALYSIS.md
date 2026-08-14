# ViewComfy 前端项目分析（离线版）

> 分析对象：`E:\Smart_Painting\ViewComfy`
> 说明：本文档描述**当前**代码库（离线本地版）。旧版文档曾引用 Socket.IO / Clerk / SWR / OpenAPI 客户端，
> 这些在现仓库中已不存在，请以本文档为准。

## 一、项目定位

这是一个 **Next.js（App Router + React 19 + TypeScript strict）** 应用，产品名“智绘·先锋”。
它把 ComfyUI 工作流包装成前端界面，供最终用户**离线使用**：

- **ComfyUI** 作为本地生成后端（默认 `127.0.0.1:8188`）
- **Next.js 服务端** 作为中间代理层（负责编排、上传、队列、错误处理、SSE 推送）
- **浏览器前端** 提供表单与结果展示

## 二、技术栈（以实际代码为准）

- 框架：Next.js App Router（next >= 16）、React 19、TypeScript strict
- UI：Tailwind CSS 4 + shadcn/ui + Radix primitives（`components/ui/*`）
- 表单：react-hook-form + zod（`components/ui/form.tsx`）
- 动画：framer-motion（`blur-fade`、`images-preview`）
- 主题：next-themes
- 状态：React Context + useReducer（`app/providers/view-comfy-provider.tsx`）
- 注意：`zustand`、`swr`、`socket.io-client` 在依赖中残留但**源码未使用**；`@clerk` / OpenAPI 客户端（`src/generated`）在本仓库中**不存在**。

## 三、三层架构与通信（核心）

```text
浏览器前端 (React 客户端组件)
    │  HTTP + SSE(流式)          ← 浏览器 ↔ Next.js 服务端用 SSE，不是 WebSocket
    ▼
Next.js 服务端 (Node.js / API routes + services)
    │  WebSocket (接收推送) + HTTP REST (主动调用)   ← 只有这一层与 ComfyUI 建 WS
    ▼
ComfyUI 后端 (本地进程, 默认 127.0.0.1:8188)
```

**关键结论**：WebSocket 只存在于 **Next.js 服务端 ↔ ComfyUI** 之间；浏览器与 Next.js 服务端之间用
**SSE（Server-Sent Events，基于 `fetch` 流式响应）** 通信。

### 1. 浏览器 ↔ Next.js 服务端（SSE）

- 入口：`app/api/comfy/route.ts`（POST，`multipart/form-data`，响应 `Content-Type: text/event-stream`）
- 服务端 `app/services/comfyui-service.ts` 的 `runWorkflow()` 返回 `ReadableStream`，按 SSE 帧输出：
  - `started`（真实 promptId）
  - `progress`（value/max，KSampler 步进）
  - `executing` / `executed`（当前节点）
  - `image`（输出文件，**base64** 编码在 data 里）
  - `done`（totalElapsedMs）
  - `error` / `cancelled`
- 客户端 `hooks/playground/use-post-playground.tsx` 用 `response.body.getReader()` **手动解析 SSE 字节流**
  （原生 `EventSource` 只支持 GET，所以这里手动解析）。
- 取消任务：`DELETE /api/prompt/[promptId]?status=running|queued`。
- 队列状态：`GET /api/comfy/queue`（浏览器轮询，见下）。

### 2. Next.js 服务端 ↔ ComfyUI（WebSocket + REST）

封装在 `app/services/comfyui-api-service.ts` 的 `ComfyUIAPIService`（进程级单例 `getComfyUIAPIService()`）：

- **WebSocket**：`new WebSocket(ws://127.0.0.1:8188/ws?clientId=...)`，收到推送后用 Node `EventEmitter` 分发：
  - `progress` 事件（executing/progress/executed/execution_error 等）
  - `queue` 事件（status 事件中的 `exec_info.queue_remaining` / `queue_in_progress`）
- **HTTP REST** 主动调用：
  - `POST /prompt` — 提交工作流（`startQueuePrompt` / `queuePrompt`）
  - `GET /view` — 取输出文件
  - `POST /upload/image`、`POST /upload/mask` — 上传输入图片/遮罩
  - `POST /interrupt`、`POST /queue` — 取消/中断
  - `GET /queue` — 拉取队列状态（`fetchQueueStatus`）

ComfyUI WS 事件类型（`ComfyUIWSEventType`）：
`status / executing / execution_cached / progress / executed / execution_error / execution_success / execution_interrupted / execution_cancelled`。

## 四、一次完整生成的时序

1. 前端 `components/pages/playground/playground-page.tsx` 的 `onSubmit` 生成 `localPromptId`，
   把 inputs 序列化为 JSON + 文件单独塞进 FormData，`POST /api/comfy`。
2. 服务端 `ComfyUIService.runWorkflow`：
   - `ComfyWorkflow.setViewComfy` 先把 File/遮罩上传到 ComfyUI input 目录；
   - 进入 `generationQueue`（**进程级串行队列，单飞**，同一时刻只提交一个任务）；
   - `startQueuePrompt` → `POST /prompt` 拿到真实 `prompt_id`；
   - 订阅 WS `progress` 事件，边收边转成 SSE 帧；
   - `waitForCompletion` 阻塞到 `execution_success/error`；
   - 取输出文件 → base64 → SSE `image` 帧 → `done` 帧。
3. 前端解析 SSE，把 `File` 转成 `objectURL` 展示；进度/队列状态写入 `ViewComfyProvider`。

## 五、目录结构

| 路径 | 职责 |
|---|---|
| `app/api/comfy/route.ts` | SSE 生成入口 |
| `app/api/comfy/queue/route.ts` | 队列状态（浏览器轮询） |
| `app/api/prompt/[promptId]/route.ts` | 取消/中断 |
| `app/api/comfy-view/route.ts` | 代理 ComfyUI `/view` |
| `app/services/comfyui-api-service.ts` | WS 连接 + 全部 ComfyUI HTTP 调用 + 事件分发 |
| `app/services/comfyui-service.ts` | 编排一次生成，产出 SSE 流 |
| `app/services/generation-queue.ts` | 进程级串行队列 |
| `app/services/settings-service.ts` | 读取 `.env` 配置 |
| `app/providers/view-comfy-provider.tsx` | 前端全局状态（结果/队列/进度） |
| `hooks/playground/use-post-playground.tsx` | 客户端发起请求 + 手动解析 SSE |
| `components/pages/playground/*` | 生成页 UI（表单、任务卡片、结果渲染） |
| `components/queue-drawer.tsx` | 顶部队列下拉（轮询队列状态） |
| `view_comfy.json` | 工作流配置：`workflows[].viewComfyJSON`（UI 可改）+ `workflowApiJSON`（不可改） |

## 六、配置（`.env`）

| 变量 | 说明 |
|---|---|
| `COMFYUI_API_URL` | ComfyUI 地址，默认 `127.0.0.1:8188` |
| `COMFYUI_SECURE` | 是否 wss/https（`true`） |
| `COMFY_OUTPUT_DIR` | ComfyUI 输出目录（绝对路径） |
| `VIEW_COMFY_FILE_NAME` | 工作流配置文件名，默认 `view_comfy.json` |
| `NEXT_PUBLIC_VIEW_MODE` | `true` 时隐藏编辑器，只读模式 |

## 七、关键约束 / 约定

- `view_comfy.json` 中 `workflowApiJSON` **不可编辑**，只改 `viewComfyJSON`。
- 串行队列 `generationQueue` 是**内存队列**，仅单进程有效（`next start` 单进程自托管场景）。
- 客户端无法直接订阅服务端与 ComfyUI 之间的 WebSocket，故队列状态通过 `GET /api/comfy/queue` 轮询（3s）。
