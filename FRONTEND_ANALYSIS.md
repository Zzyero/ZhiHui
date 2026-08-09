# ViewComfy 前端组件与页面分析

> 分析对象：`e:\Smart_Painting\ViewComfy`
> 技术栈：Next.js App Router + React 19 + TypeScript + Tailwind CSS 4 + Radix UI / shadcn
> 状态管理：Zustand + React Context/Reducer
> 数据请求：SWR
> 表单：React Hook Form + Zod
> 认证：Clerk
> 实时通信：Socket.IO

---

## 一、前端根布局

- `ViewComfy/app/layout.tsx`
- `ViewComfy/app/layout-client.tsx`

全局布局包含：

- 顶部导航 `TopNav`
- 左侧导航 `AppSidebar`
- 当前页面内容
- Toast 提示
- 图片比较 Provider
- 全局部署弹窗
- Clerk 认证包装器
- Workflow 执行状态 Provider
- API App 执行状态 Provider
- Socket Provider

布局变量：

- 顶栏高度 `57px`
- 侧栏宽度 `12rem`
- 根布局为全屏 `h-screen`
- 主区域独立处理横向溢出
- ViewComfy 云端 View Mode 时隐藏侧栏

`/` 路由会根据运行模式重定向：

- 本地模式访问 `/`，跳到 `/editor`
- ViewComfy 非 View Mode，跳到 `/editor`
- ViewComfy View Mode，普通访问跳到 `/apps`，带 `appId` 跳到 `/playground?appId=...`

---

## 二、全部页面与路由

### 1. `/` 根页面

- 文件：`ViewComfy/app/page.tsx`
- 不渲染业务内容，只触发重定向

### 2. `/editor` Editor 页面

- 入口：`ViewComfy/app/editor/page.tsx`
- 主组件：`ViewComfy/components/pages/view-comfy/view-comfy-page.tsx`

页面职责：

- 上传 `workflow_api.json` 或 `view_comfy.json`
- 将 ComfyUI API Workflow 转成 ViewComfy 表单描述
- 管理多个 Workflow
- 编辑 App 标题与 App 图片 URL
- 保存、下载或部署 ViewComfy 配置
- 显示 JSON 解析错误

使用组件：

- `Header`
- `Dropzone`
- `WorkflowSwitcher`
- `Input` / `Label` / `Button`
- `ViewComfyFormEditor`
- `ErrorAlertDialog`

页面主要按钮：

| 按钮 | 位置 | 行为 |
| --- | --- | --- |
| 上传区（Dropzone） | 未加载 Workflow 时显示 | 点击/拖放上传 `.json`，识别 `workflow_api.json` 与 `view_comfy.json` |
| `App Title` 输入 | App 信息区 | placeholder `ViewComfy`，失焦写入 `SET_APP_TITLE` |
| `App Image URL` 输入 | App 信息区 | placeholder `https://example.com/image.png`，失焦校验 URL |
| Workflow Switcher | 工作流操作栏 | 弹出 Popover 命令菜单，搜索并切换 Workflow |
| `Delete Workflow` | 工作流操作栏 | destructive 按钮，删除当前 Workflow |
| `Add Workflow` | 工作流操作栏 | 清空当前与草稿，重新显示上传区 |

### 3. `/playground` Playground 页面

- 入口：`ViewComfy/app/playground/page.tsx`
- 主组件：`ViewComfy/components/pages/playground/playground-page.tsx`

页面职责：

- 根据 URL `appId` 加载 ViewComfy App 或 API App
- 动态渲染输入表单
- 提交生成请求
- 接收 WebSocket 与轮询结果
- 展示图片、视频、音频、文本与文件输出
- 取消正在执行的 Workflow
- 打开历史面板
- 选择两张图片对比
- 请求浏览器通知并提示完成

App 类型：

- ViewComfy App：`/playground?appId=<id>`
- API App：`/playground?appId=api-<id>`
- 统一接口：`ViewComfy/app/interfaces/unified-app.ts`

布局：

- 桌面：左表单（最大 `450px`）+ 右结果区
- 移动：顶部 Workflow Switcher + Settings 按钮 + 底部 Drawer 表单

主要按钮：

| 按钮 | 来源 | 行为 |
| --- | --- | --- |
| `Settings` | `PlaygroundPageContent` | 仅移动端，打开底部参数 Drawer |
| Workflow Switcher | 桌面/移动 | 切换当前 Workflow |
| `Generate` / `Generating...` | `PlaygroundForm` 与 `ApiAppPlaygroundForm` | 提交 Workflow 或 API App，loading 时禁用 |
| `Compare` / `Cancel` | `ComparisonButton` | 进入/退出 Compare Mode |
| 图片对比 Checkbox | `ComparisonCheckbox` | 最多选两张，选满自动打开对比弹窗 |
| `History` | 顶部 | 打开右侧 `HistorySidebar` |
| 生成中卡片按钮 | 生成中状态 | 打开取消确认弹窗 |
| `Continue generating` | 取消弹窗 | 关闭弹窗继续生成 |
| `Cancel generation` | 取消弹窗 | 调用 `cancelJob(promptId)` |
| `Show Error` | 生成中状态 | 打开 `ErrorAlertDialog` |
| 图片输出点击 | 输出卡片 | 打开大图 Dialog，支持缩放/平移/拖回输入 |
| `Download` | 图片 Dialog | 下载当前图片 |
| 视频输出点击 | 输出卡片 | 打开大尺寸 Dialog |
| 音频输出点击 | 输出卡片 | 打开 Dialog |
| 文件输出按钮 | 输出卡片 | 下载文件 |

### 4. `/apps` Apps 页面

- 文件：`ViewComfy/app/apps/page.tsx`

功能：

- 根据 Team 加载 ViewComfy Apps 与 API Apps
- 合并为统一列表并以响应式网格展示

响应式列数：

- 1 列
- `sm` 2 列
- `md` 3 列
- `lg` 4 列
- `xl` 5 列

App 卡片组件：

- `ViewComfy/components/apps/app-card-base.tsx`
- `ViewComfy/components/apps/apps-card.tsx`

按钮：

- 卡片底部 `Use App`
  - 跳转 `/playground?appId=<id>` 或 `/playground?appId=api-<id>`
- 选中态 `Check` 图标（App Switcher 模式使用）

### 5. `/login/[[...login]]` 登录页面

- 文件：`ViewComfy/app/login/[[...login]]/page.tsx`

布局：

- 桌面双栏：左 Clerk SignIn + 右 ViewComfy Logo
- 小屏仅显示左栏

自定义按钮：

| 按钮 | 行为 |
| --- | --- |
| `Single Sign-On` | 跳转 `/sso` |
| Clerk SignIn 表单 | 由 Clerk 渲染邮箱/密码/社交登录等控件 |

### 6. `/sso/[[...sso]]` SSO 登录

- 文件：`ViewComfy/app/sso/[[...sso]]/page.tsx`

内容：

- Clerk `SignIn`
- 隐藏社交登录
- 桌面双栏显示 Logo

页面本身没有自定义按钮，输入框与提交按钮由 Clerk 提供。

---

## 三、全局导航与控件

### 顶部导航

文件：`ViewComfy/components/top-nav.tsx`

| 控件 | 图标 | 行为 |
| --- | --- | --- |
| Logo / Home | Icon Button + Link | `aria-label="Home"`，本地模式跳转 `https://viewcomfy.com`，云端跳转 `/apps` |
| App 标题 | 文本 | 优先级：Team 的 `playgroundLandingName` → `appTitle` → `ViewComfy` |
| GitHub 按钮 | GitHub SVG | 新标签打开 `https://github.com/ViewComfy/ViewComfy`，仅非云端运行时显示 |
| Discord 按钮 | Discord SVG | 新标签打开 Discord invite，仅非云端运行时显示 |
| Team Switcher | Outline Button + Popover/Drawer | 多 Team 时显示，可搜索切换 |
| App Switcher | `AppWindow` + `ChevronDown` | 多 App 时显示，弹窗切换 App |
| 主题切换 | Sun / Moon | 下拉菜单含 `Light` / `Dark` / `System` |
| 用户菜单 | Clerk `UserButton` | 由 Clerk 渲染菜单项 |

#### Team Switcher

文件：`ViewComfy/components/team-switcher.tsx`

- 单 Team 用户不显示
- 桌面 Popover，移动 Drawer
- 含搜索框 `Filter teams...`
- 当前 Team 显示 `CheckIcon`
- 选择后写入 Zustand `setCurrentTeam`，跳到 `/apps`

#### App Switcher Dialog

文件：`ViewComfy/components/apps/app-switcher-dialog.tsx`

- 标题 `Switch App`
- 描述提示切换应用时当前输出会保留
- 卡片按钮：`Selected`（当前） / `Select App`（其他）

#### 主题切换

文件：`ViewComfy/components/toggle.tsx`

- 触发按钮图标 Sun/Moon
- 菜单：`Light` / `Dark` / `System`

### 左侧导航

文件：`ViewComfy/app/layout-client.tsx`

| 菜单 | 图标 | 目标 |
| --- | --- | --- |
| `Editor` | `FileJson` | `/editor` |
| `Apps` | `SquarePlay` | `/apps`，ViewComfy View Mode 中加入 |
| `Playground` | `SquareTerminal` | 通常 `/playground`，View Mode 下代码可能传空 href |

---

## 四、Editor 动态表单

核心文件：`ViewComfy/components/view-comfy/view-comfy-form.tsx`

### Workflow 基本字段

| 字段 | 控件 | 备注 |
| --- | --- | --- |
| `Title` | Input | placeholder `The name of your workflow` |
| `Description` | Textarea | placeholder `The description of your workflow` |
| `ViewComfy Endpoint` | Input / Select | 普通模式为 Input，云端模式为 Team Workflow 下拉 |
| `Enable text output` | Checkbox | 控制文本输出渲染，带 beta 提示 |
| `Show file names on output` | Checkbox | 控制结果下显示文件名 |

### 字段类型与对应控件

| 类型 | 组件 | 控件 |
| --- | --- | --- |
| 文本/数值 | `FormBasicInput` | Input + min/max 校验 |
| 长文本 | `FormTextAreaInput` | Textarea + Tooltip + 校验 |
| Boolean | `FormCheckboxInput` | Checkbox + 可选 Info Tooltip |
| Seed | `FormSeedInput` | Number Input + `Randomize` Checkbox |
| Select | `FormSelectInput` | Radix Select |
| Combobox | `FormComboboxInput` | 按钮 + `ChevronsUpDown` + Popover 搜索 |
| Slider | `FormSliderInput` | Slider + 当前数值框 |
| 图片/视频/音频 | `FormMediaInput` | Dropzone + 媒体预览 + `Remove` 按钮 |
| Image Mask | `FormMaskInput` | Dropzone + Mask Editor + `Edit Mask` / `Remove Image` |

`FormMediaInput` 按钮：

- `Remove image` / `Remove video` / `Remove audio`，图标 `Trash2`

`FormMaskInput` 按钮：

- `Edit Mask`，图标 `Brush`，打开 MaskEditor
- `Remove Image`，图标 `Trash2`

### 字段动作按钮

文件：`FieldActionButtons`

| 按钮 | 图标 | 行为 |
| --- | --- | --- |
| 编辑字段 | `SquarePen` | 打开 `Transform input` 弹窗 |
| 显示/隐藏 | `Eye` / `EyeOff` | 切换 `active` / `hidden` |
| 删除字段 | `Trash2` | 设置 `visibility="deleted"` |

### 输入组动作

| 按钮 | 位置 | 行为 |
| --- | --- | --- |
| `MoveDown` | Basic 组 | 将字段移到 Advanced |
| `MoveUp` | Advanced 组 | 将字段移回 Basic |
| `Trash2` | Basic/Advanced 组 | 删除整个组 |

### Advanced Inputs

- 折叠按钮文字：`Advanced Inputs`
- 图标：`ChevronsUpDown`
- 编辑模式下默认展开

---

## 五、Transform Input 弹窗

字段：

- `Label`
- `Type`（Text/Long text/Image/Image with Mask Editor/Video/Audio/Select/Slider/Number/Float/CheckBox/Seed）
- Select 类型附加 `Options (one per line)`
- Slider 附加 Min / Max / Step
- Number/Float 附加 Min optional / Max optional
- `Default value`
- `Help text`
- `Tooltip`
- `Required`
- `Error message (shown when required)`

按钮：

- `Cancel`：关闭弹窗
- `Save changes`：更新字段、React Hook Form 与 ViewComfyProvider

---

## 六、Editor 底部操作栏

| 按钮 | 行为 |
| --- | --- |
| `Save Changes` | 保存并显示 `Form Saved!` Toast |
| `Deploy App` | 仅云端环境显示，打开 `DeployAppDialog` |
| `Download as ViewComfy JSON` | 先保存，再构建并下载 `view_comfy.json` |

---

## 七、Editor 右侧面板

| 面板 | 内容 | 控件 |
| --- | --- | --- |
| `Deleted Inputs` | 已删除字段列表 | 数量 Badge + `Undo2` 按钮恢复字段 |
| `Preview Images` | 三张预览图 | 三个 URL 输入框 + 图片预览 + `Remove image` 按钮 |

---

## 八、Deploy App 弹窗

文件：`ViewComfy/components/apps/deploy-app.tsx`

表单字段：

- Name
- Description
- Project Select
- App Hub Switch

按钮：

- `Cancel`：关闭并重置
- `Deploy`：提交部署，loading 时显示 `Loader2`

成功状态：

- 标题：`Deployment Successful`
- 图标：`CheckCircle2`
- `App`（图标 `ExternalLink`）：新窗口打开应用
- `App Url`（图标 `Copy`）：复制链接并 Toast
- `Done`：关闭并清理状态

---

## 九、全局 Deploy Dialog

文件：`ViewComfy/components/deploy/deploy-dialog.tsx`

标题：`Deploy your workflow in the cloud`

按钮：

- `Deployment guide`：新窗口打开 YouTube 教程并关闭弹窗
- `Deploy now`：新窗口打开 `https://app.viewcomfy.com/` 并关闭弹窗

当前静态分析中没有明确发现打开入口，可能不可达。

---

## 十、Mask Editor

文件：`ViewComfy/components/ui/mask-editor.tsx`

工具按钮：

| 按钮 | 图标 | 行为 |
| --- | --- | --- |
| 画笔 | `Pencil` | 进入画笔模式 |
| 橡皮/清除 | `Trash2` | 橡皮或清空 Mask |
| 移动 | `Move` | 平移画布 |
| 撤销 | `Undo2` | Undo |
| 重做 | `Redo2` | Redo |
| 放大 | `ZoomIn` | 放大 |
| 缩小 | `ZoomOut` | 缩小 |
| 适配屏幕 | `Maximize2` | 自适应画布 |
| 保存 | `Save` | 通过 `onSave(maskFile)` 返回 Mask |

参数控件：

- Brush Size Slider
- Brush Opacity Slider
- Brush Hardness Slider
- Eraser Opacity Slider
- Eraser Hardness Slider

---

## 十一、图片比较

文件：

- `ViewComfy/components/comparison/comparison-button.tsx`
- `ViewComfy/components/comparison/comparison-checkbox.tsx`
- `ViewComfy/components/comparison/comparison-dialog.tsx`
- `ViewComfy/components/comparison/image-comparison-provider.tsx`

按钮：

| 按钮 | 图标 | 行为 |
| --- | --- | --- |
| `Compare` / `Cancel` | `Images` | 进入/退出 Compare Mode |
| 图片 Checkbox | 原生 | 最多选两张，选满自动打开对比弹窗 |
| `Zoom in` | `ZoomIn` | 放大 |
| `Zoom out` | `ZoomOut` | 缩小 |
| `Move up` | `ChevronUp` | 上移 |
| `Move down` | `ChevronDown` | 下移 |
| `Move left` | `ChevronLeft` | 左移 |
| `Move right` | `ChevronRight` | 右移 |

Provider 状态：

- `selectedImages`
- `isCompareModeActive`

---

## 十二、History Sidebar

文件：`ViewComfy/components/history-sidebar.tsx`

仅在 `NEXT_PUBLIC_USER_MANAGEMENT=true` 时启用。

头部按钮：

| 按钮 | 图标 | 行为 |
| --- | --- | --- |
| 关闭 | `ChevronRight` | 关闭侧栏 |
| `Filters` | `Filter` | 展开/折叠过滤区 |

过滤区：

- ViewComfy 模式：WorkflowSwitcher + DatePickerWithRange
- API App 模式：显示 App 名
- `Images per page` Select：5 / 10 / 20

历史项按钮：

| 按钮 | 图标 | 行为 |
| --- | --- | --- |
| `Copy prompt` | `Copy` | 复制 Workflow prompt JSON |
| `Copy input data` | `Copy` | 复制 API App 输入数据 |
| `Show Error` | 无 | 打开 `ErrorAlertDialog` |
| `Previous` | `ChevronLeft` | 上一页 |
| `Next` | `ChevronRight` | 下一页 |
| `Go back` | `ChevronLeft` | 无更多内容时回退 |

预览控件：

- 图片点击打开缩放 Dialog
- 视频点击打开带 controls 的 Dialog
- 音频显示 `Play` 图标
- PSD 显示 `File`
- 文本显示 `FileType`
- 多结果时左右切换图标 `ChevronLeft` / `ChevronRight`
- `Download` 按钮下载当前结果

---

## 十三、上传区域（通用 Dropzone）

文件：`ViewComfy/components/ui/dropzone.tsx`

使用位置：

- Editor JSON 上传
- 图片/视频/音频输入
- Mask 输入
- API App 单文件与数组文件输入

交互：

- 点击或拖放
- 接收内部结果拖拽
- 远程媒体通过 `/api/media-proxy` 拉取

状态文字：

- 默认：`Drag Files to Upload`
- 加载远程：`Loading media...`，图标 `Loader2`
- 错误：单文件限制、类型错误、远程加载失败

---

## 十四、API App 动态表单

文件：

- `ViewComfy/components/api-apps/app-form.tsx`
- `ViewComfy/components/api-apps/app-form-field.tsx`
- `ViewComfy/components/pages/playground/api-app-form.tsx`

支持字段：

- Input / Textarea / Checkbox / Slider / Select
- 文件 Dropzone 与文件数组
- Random Seed

按钮与图标：

- `Info`：显示描述与约束
- `Dices`：随机 Seed
- `Trash2`：移除单文件
- `X`：移除数组中的文件
- `Loader2`：上传中

无输入字段时显示：

- `No input fields configured for this app.`

文件上传流程：

1. 请求 Presigned Upload URL
2. PUT 上传文件
3. 取公共 URL 写入表单

---

## 十五、状态管理

### ViewComfy Provider（useReducer）

文件：`ViewComfy/app/providers/view-comfy-provider.tsx`

状态：

- `appTitle` / `appImg` / `viewComfys` / `viewComfyDraft` / `currentViewComfy`

主要 Action：

- `ADD_VIEW_COMFY` / `UPDATE_VIEW_COMFY` / `REMOVE_VIEW_COMFY`
- `SET_VIEW_COMFY_DRAFT` / `UPDATE_CURRENT_VIEW_COMFY`
- `RESET_CURRENT_AND_DRAFT_VIEW_COMFY` / `INIT_VIEW_COMFY`
- `SET_APP_TITLE` / `SET_APP_IMG`

### Zustand Bound Store

文件：`ViewComfy/stores/bound-store.ts`

组合：

- Team Store
- Workflow Store
- ViewComfy App CRUD Store
- Shared Store

CRUD 接口：

- `createViewComfyApp`
- `isCRUDViewComfyAppLoading`
- `isCRUDViewComfyAppError`

### Workflow Data Provider

文件：`ViewComfy/app/providers/workflows-data-provider.tsx`

状态：

- `runningWorkflows` / `cancellingWorkflows` / `workflowsCompleted`

### API App Execution Provider

文件：`ViewComfy/app/providers/api-app-execution-provider.tsx`

状态：

- `runningExecutions` / `completedExecutions` / `processedIds`

每 2 秒轮询一次。

### 图片比较 Provider

文件：`ViewComfy/components/comparison/image-comparison-provider.tsx`

- `selectedImages`
- `isCompareModeActive`

### 认证 Provider

文件：`ViewComfy/components/auth/authenticated-wrapper.tsx`

职责：

- 初始化 OpenAPI 客户端认证
- 根据用户与 `appId` 解析 Team
- 加载 Team Workflows
- 包裹 WorkflowDataProvider / ApiAppExecutionProvider / SocketProvider

---

## 十六、前端数据 Hooks 与 API

文件：`ViewComfy/hooks/use-data.tsx`（`fetcherWithAuth`）

- Clerk token 模板：`long_token`
- 自动重试 502/503，最多 3 次，指数退避
- 401/403 视为 token 失效

Hook 清单：

| Hook | 端点 | 刷新频率 |
| --- | --- | --- |
| `useWorkflowHistory` | `team/workflow-history/playground/<endpoint>` | 按需 |
| `useRunningWorkflow` | `workflow/infer/running` | 按需 |
| `useWorkflowByPromptIds` | `workflow/infer/?prompt_ids=...` | 按需 |
| `useViewComfyApps` | `viewcomfy-app/playground/apps/<teamId>` | 5 秒 |
| `useUser` | `user/playground/me` | 60 秒 |
| `useWorkflows` | `viewcomfy-app/playground/workflows?team_id=<teamId>` | 15 秒 |
| `useGetTeamByAppId` | `viewcomfy-app/app/team/<appId>` | 按需 |
| `useApiApps` | `AppsService.listAppsApiAppsGet(projectId)` | 5 秒 |
| `useAllApps` | 合并 Apps | — |

API App 轮询：

- 文件：`ViewComfy/hooks/use-api-app-executions.tsx`
- 端点：`AppsService.getExecutionsApiAppsAppIdHistoryRunningGet`
- 每 2 秒轮询

API App 历史：

- 文件：`ViewComfy/hooks/use-api-app-history.tsx`
- 端点：`AppsService.listExecutionsApiAppsAppIdHistoryGet`

ViewComfy 提交：

- 文件：`ViewComfy/hooks/playground/use-post-playground.tsx`
- 端点：`POST /api/viewcomfy` 或 `POST /api/comfy`
- 多结果使用 `--BLOB_SEPARATOR--` 拆分

---

## 十七、Next.js API 路由

| 路由 | 文件 | 作用 |
| --- | --- | --- |
| `GET /api/playground` | `ViewComfy/app/api/playground/route.ts` | 加载指定 App 或读取本地 `view_comfy.json` |
| `POST /api/viewcomfy` | `ViewComfy/app/api/viewcomfy/route.ts` | 调用云端 ViewComfy Workflow |
| `POST /api/comfy` | `ViewComfy/app/api/comfy/route.ts` | 调用本地 ComfyUI |
| `GET /api/media-proxy` | `ViewComfy/app/api/media-proxy/route.ts` | 代理远程媒体 |
| `GET /api/text-proxy` | `ViewComfy/app/api/text-proxy/route.ts` | 代理远程文本输出 |

---

## 十八、WebSocket

文件：

- `ViewComfy/app/providers/socket-provider.tsx`
- `ViewComfy/lib/socket.ts`

事件：

- `connect` / `disconnect` / `connect_error` / `error`
- `infer_error_message` / `infer_result_message`
- `reconnect_attempt`

收到结果后写入 `workflowsCompleted`。

---

## 十九、主要业务组件总表

### 页面级

- `ViewComfyPage`
- `PlaygroundPage` / `PlaygroundPageContent`
- `PlaygroundForm` / `ApiAppPlaygroundForm`
- `AppsPage`
- `LoginPage` / `SSOPage`

### 导航

- `TopNav`
- `AppSidebar`
- `TeamSwitcher`
- `WorkflowSwitcher`
- `AppSwitcherDialog`
- `ModeToggle`
- Clerk `UserButton`

### Editor

- `ViewComfyFormEditor`
- `FormBasicInput` / `FormTextAreaInput` / `FormCheckboxInput` / `FormSeedInput`
- `FormSelectInput` / `FormComboboxInput` / `FormSliderInput`
- `FormMediaInput` / `FormMaskInput`
- `FieldActionButtons`
- `PreviewImagesInput`

### Playground

- `PlaygroundForm` / `ApiAppPlaygroundForm`
- `PreviewOutputsImageGallery`
- `HistorySidebar`
- `SelectableImage`
- `TextOutput`
- 生成中状态卡片
- 各类媒体输出组件

### Comparison

- `ComparisonButton` / `ComparisonCheckbox` / `ComparisonDialog` / `ImageComparisonProvider`

### 弹窗

- `Transform input` Dialog
- `DeployAppDialog` / `DeployDialog`
- `MaskEditor`
- `ErrorAlertDialog` / `ApiErrorDialog`
- 取消生成 AlertDialog
- 各类媒体预览 Dialog

### 基础 UI

Button、Input、Textarea、Checkbox、Slider、Select、Dialog、AlertDialog、Drawer、Popover、DropdownMenu、Command、Card、Badge、Label、Tooltip、Tabs、ScrollArea、Skeleton、Avatar、Separator、Switch、Form、Toast、Date Picker、Date Range Picker、Sidebar 等。

---

## 二十、静态分析的限制

- Clerk 登录表单与用户菜单中的部分按钮由 Clerk 运行时渲染，仓库无法完整确认其文字
- 部分组件根据环境变量、登录状态、Team 数量与 View Mode 条件显示
- 全局 `DeployDialog` 已挂载，但没有明确发现可达的打开入口
- `logged-user.tsx` 中存在自定义用户菜单，但顶栏实际使用 Clerk `UserButton`，自定义菜单似乎未被引用
