# 协作舱：基建式房间层

更新：2026-11-09。功能位置：协作视图画布。

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

## 头顶 ID 条与占用灯

两类编号都用同一套游戏式头顶代号牌，不铺地板：

- **设施**：每件家具带 `code` / `name` / `plateSide`，六条编号
  （PC-01、PC-02、SRV-01、GRN-01、BRW-01、LNG-01）挂在家具上方，带一根细引线；
- **角色**：头像上方一条短代号（`LOCAL` / `CLOUD` / `DEEPSEEK`，由模型 ID 去掉通用前缀后
  截成 10 字符大写），脚下的可编辑名字保留。代号固定、别名可改，两者不互相覆盖。

`applyEcosystem()` 统计每个座位实际坐了谁，调 `window.__room.setUsage({ propId: 人数 })`：
有人的设施亮绿灯，空座灯灭，绿植无座位恒灭。角色代号牌的状态点跟随
`setActorState()`：生成中是主色高亮，完成绿，失败红，待机灰。
`setUsage` 有缓存：`stage-ui.js` 首次 `applyEcosystem()` 可能早于房间 `mount()`，
先存 `pendingUsage`，`render()` 里补画一次，避免首屏灯全灭。

**为什么要挂头上**：贴地板时编号会被站在设施前的角色踩住，要保证可见就得恒定置顶，
要严格深度正确就得允许被挡，二者冲突。挪到家具/角色上方后，编号恒定
`z-index = 470`（高于所有家具 ≤456、低于拖拽角色 900）也不会压到脚，
和游戏里干员头顶代号牌一样是 UI 层，不参与深度遮挡。

**ID 条必须单独成层**：最初把它作为 `.room-prop` 子元素，跟着家具的 z 排序，
结果更靠近镜头的机柜 SVG 把 PC-01 整块盖掉、SRV-01 被画布左缘裁掉。现在是
`#stage-room` 的直接子元素，由 `room.js` 内联写 left/top；
`plateSide` 只做 ±10px 水平避让，不再决定锚点方位。

**锚点不能目测**：`.room-prop` 用 `translate(-50%, -100%)`，y% 是家具底沿，
所以头顶 = `y% - HEAD_ANCHOR[type]`。`HEAD_ANCHOR` 由 `--dump-dom` 读
`svg.getBBox().y` 反推，让每条底边正好落在绘图顶上方 8px。第一版凭目测取值，
机柜标签高出 29px 挂在墙上、沙发标签压进靠背；`room-plate-head-gap` 断言会在改 SVG
后把这类偏差抓出来。墙上状态屏因此上移到 `top: 3%`，避开盆栽/咖啡台的 ID 条。

角色代号牌是 `.stage-actor` 的绝对定位子元素，不进 flex 流，所以不改变角色盒高、
不影响「脚底 y + 95px」的深度公式。临时戳一下气泡出现时代号牌淡出，桌宠小窗里隐藏。

## 沙发画法

试过多个独立等轴盒子拼接，投影下必然读成「碎石 / 斜插的刀片」——小盒子在这个 2:1
投影里会露出菱形侧面。最终用经典等轴家具技法：**一个大坐垫盒 + 从坐垫后缘升起的
两块围合靠背板 + 两端小翼板扶手 + 坐垫上两枚椭圆软垫**。靠背/扶手用 `sk-*` 类压暗，
坐垫最亮。改这类家具时先放大 2.6 倍截图核对，全屋缩略图看不出几何穿插。

## 验证

- `node --test *.test.cjs`：184 项全过；
- `node ui-verify-run.cjs`：52 项全过、无 console 错误。房间与 ID 条相关断言：
  `room-facility-plates` / `room-plates-not-clipped` / `room-plates-overhead` /
  `room-plate-head-gap` / `room-plate-occupancy` /
  `collab-actor-id-tags` / `collab-actor-id-overhead` / `collab-actor-id-state-sync`；
- 临时预览页 + headless Chrome 截图核对深/浅两套主题（预览页不入库），
  另用 `--dump-dom` 实测每条 ID 条与家具 `getBBox()` 的像素差；
- 桌宠小窗（176×200）下房间层与角色代号牌一起隐藏。
