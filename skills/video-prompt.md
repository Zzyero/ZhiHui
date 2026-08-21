# 视频提示词规范

## 结构
主体 + 场景 + 动作/运动 + 光线 + 情绪 + 镜头运动。

## 镜头运动命令
在提示词中用方括号写镜头命令，例如「[Push in]」：
- [Truck left] / [Truck right] 左右横移
- [Push in] 推近 / [Pull out] 拉远
- [Pan left] / [Pan right] 左右摇镜
- [Tilt up] / [Tilt down] 上下摇镜
- [Pedestal up] / [Pedestal down] 升降
- [Zoom in] / [Zoom out] 变焦
- [Static shot] 静止镜头（适合背景/稳定画面）
- [Tracking shot] 跟随主体
- [Shake] 手持晃动

## 其它
- 描述主体、场景、光线、情绪；默认会自动优化提示词。
- 网页背景视频：6 秒、加 [Static shot]。

## 时长/分辨率
- 常见 6s / 10s；1080P 只支持 6s。

## 限制
- 提示词不超过 2000 字符。
