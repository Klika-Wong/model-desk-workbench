# 协作舱：基建式房间层

更新：2026-11-08。功能位置：协作视图画布。

协作视图的画布不再是「网格 + 虚线地毯」，而是一间连续的等轴舱室：后墙、地板、六件家具，
角色按状态坐进对应设施。视觉参考明日方舟基建的「俯视房间 + 家具遮挡」做法；
家具由本仓库自绘（内联 SVG，零外部素材、零授权负担）。

## 结构

| 文件 | 职责 |
| --- | --- |
| `desktop/room.js` | 房间渲染：墙、地板、家具 SVG；对外暴露 `window.__room` |
| `desktop/room.css` | 房间视觉层，颜色全部走变量，三套主题自动跟随 |
| `desktop/assets/rooms/office.js` | 布局真源（`window.__ROOM_LAYOUT`），改这里 |
| `desktop/assets/rooms/office.json` | 布局快照，由 `scripts/sync-room-layout.cjs` 生成，只读 |
| `desktop/stage-ui.js` | `applyEcosystem()` 按座位归位角色，`setActorPos()` 写深度 |

## 深度轴（遮挡规则）

角色与家具共用同一条「接地线深度轴」：

- 家具 `z-index = 20 + round(接地线 y × 436)`；
- 角色 `z-index = 20 + round(脚底 y × 436)`，脚底 = 中心 y + 约 95px；
- 结果：把角色拖到桌子后面（脚 y 更小）会被桌子挡住，符合等轴透视直觉；
- 拖动中角色强制置顶（`z-index: 900 !important`），避免看不清。

## 座位分配（applyEcosystem）

优先级：**工位 → 摸鱼角 → 地板补位 → 网格兜底**。

1. 有角色在生成（busy）：work 状态按序入工位（两张桌 + 机柜旁），rest 状态入咖啡台/沙发；
2. 无人生成：先填工位再填摸鱼角，像「大家各自在位置上」；
3. 座位满了走 `fallbackSeats`（地板前部两排）；
4. 座位 + 补位都满（>15 人）退回按宽度均分的网格。

手动拖过的角色（`manualPos`）不参与自动归位，位置存本机。

## 改布局

1. 编辑 `desktop/assets/rooms/office.js`（x/y 是归一化坐标，y 是接地线）；
2. `node scripts/sync-room-layout.cjs` 同步 json 快照；
3. 刷新协作视图。座位写在每个 prop 的 `seats` 里，`role` 决定服务 work 还是 rest。

## 为什么不是 Kenney 素材包

调研过 Kenney Furniture Kit（CC0），但素材站反爬（403）且像素比例与现有
ZipZipPipe 角色不匹配。自绘 SVG 有三个实际好处：跟随主题变量变色、尺寸精确可控、
没有任何授权链路要维护。Ark-Pets（GPL-3.0）与 WorkAdventure（AGPL）只作参考，未抄代码。

## 验证

- `node --test *.test.cjs`：204 项全过；
- `_room-preview.html`（未入库）+ headless Chrome 截图核对深/浅两套主题；
- 运行时与既有 44 项 `verify:ui` 检查共存，桌宠小窗（176×200）下房间层整体隐藏。
