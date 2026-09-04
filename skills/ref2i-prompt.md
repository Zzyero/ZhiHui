# MiniMax H3 参考生图（REF2I）提示词规范

适用于「参考生图」工作流。该工作流实际用 **MiniMax H3 视频模型**当图像编辑器：以参考图为输入、生成约 5 帧后取 1 张静态图。目标是一张**编辑后的静态图**，不是运动视频。

## 核心原则
- 默认**静态**：镜头固定、无动作、无运动（可写 `Camera stays fixed` / `[Static shot]`），否则抽帧会糊/有鬼影。
- 默认**整图保持一致**：保留参考图的构图、主体、光线、画风、色彩、画幅；**只改用户要求改的部分**。
- **改谁 / 留谁分开写清楚**，逐项列清单，越具体越听话。
- 不要脑补参考图之外的场景/主体/文字。

## 六段式语法（填入工作流「提示词」参数）
按顺序写六段，每段以 `段名:` 另起一行：

### 1. subject_definitions
把参考图绑定成主体，写清长相/服装/特征：
```
subject_definitions:
<Subject 1> is the <角色/物品> in <Picture N>: <逐项特征：发型、五官、服装、表情、道具>
```
第二张参考图用 `<Subject 2> is … in <Picture N>`。

### 2. summary
一句话任务书：
```
summary:
[reference generation] <一句话：把图 A 的 X 换成图 B 的 Y，其余全部保持不变。>
```

### 3. retention_analysis ★（编辑指令核心，三种用法）
- **partially_preserved（主力，日常替换/改造）**
```
retention_analysis:
partially_preserved: <保留清单逐项：face/hair/pose/clothing retained exactly …>；<替换指令：X replaced by Y>
```
- **attribute_transfer（跨图迁移）**：Subject 1 的身份/脸来自图 A，Subject 2 的服装/道具来自图 B，逐项绑定来源图。
- **cosplayer 重构（3D / 动漫 → 真人）**：保留清单只放「可穿戴件」（假发、美瞳、服装）；脸部写 `NOT retained`，明确替换为真人面部特征。
- 写清楚：哪些元素**原样保留**、哪个对象**被替换**、替换成什么。

### 4. detailed_description
静态构图锚点 + 目标画面细节：
```
detailed_description:
<目标画风/构图与参考图一致的声明>
[Shot 1] <静态镜头> <最终画面描述>
```
- 防裁切构图锚点：`entire body from head to toes visible, headroom above, floor space below`（全身主体时）。
- 重申画风 / 构图 / 光线 / 色彩与参考图一致（除非用户要求改）。
- 给出被修改对象的最终细节（表情、姿态、服装、道具）。

### 5. overall_soundscape
```
overall_soundscape:
N/A
```

### 6. non_diegetic_music
```
non_diegetic_music:
N/A
```
（图像任务第 5、6 段一律填 N/A）

## 输出
- 整段英文六段式提示词填入「参考生图」的「提示词」参数；「宽/高」按参考图比例填（一致比例，避免黑边/裁切），然后调用工作流生成。
- 提示词内容建议用英文（与 MiniMax H3 官方示例一致，识别最稳），中文描述可辅助但保留 6 个英文段名。

## 防错
- 不要写镜头运动 / 动作 / 转场——这是静态编辑，否则生成会抖动。
- 防身份漂移 / 换脸 / 多指 / 裁切：靠明确的保留清单 + 构图锚点。
- 用户说「改成 X」就只替换 X；没说保留的默认原样保留；没说的不要自行增删。
