# 本次发布验证

## 2026-11-13 多模型组的超时收敛与停止入口

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 单元测试 | `npm test` | 254/254（新增 10 项：`chat-multi` 4、`chat-group-cancel` 6） |
| 界面真机 | `npm run verify:ui` | 73 项，console 错误 0（新增 `chat-group-cancel-visible`、`chat-group-cancel-dispatches`） |
| 桌宠真机 | `npm run verify:pet` | 21 项，errors 0（回归） |
| 主进程真机 | `npm run verify:main` | 15 项（回归） |
| 桌面冒烟 | `npm run smoke` | 65 项通过 |
| vendor 素材离线校验 | `node scripts/vendor-assets.cjs --check` | 37 文件 / 2 来源 |
| 发布源码扫描 | `python scripts/check_public_source.py` | `{"files":540,"findings":[]}`，退出码 0 |

E 盘运行实例同步 5 个文件后复跑：单测 249 通过 + 5 明确跳过（缺根目录文档的既有 skip）、
界面 / 桌宠 / 主进程三层真机验证全部通过。

新增真机断言走的是真实点击路径：等两个分支真的 `dispatchSend` 之后，检查
「停止这一组任务」可见，点击后统计 `dispatchCancel` 调用数，并断言状态栏有如实反馈、
按钮已复位；不是只看 DOM 里有没有这个按钮。`chat-multi.test.cjs` 的超时测试真的调用
`markWaitTimeout`，断言 `isSettled()` 变 true、已有正文不被抹掉、文案不编造失败原因。

**边界，不能当成已验收**：

- 3 分钟等待上限没有真机计时跑过（需要一个永不返回终态的面板并等满 3 分钟）；
  覆盖它的是纯函数单测与 `chat-group-cancel.test.cjs` 的源码接线断言。
- `ui-verify-preload.cjs` 的 `dispatchSend` 桩让两个分支复用同一个 `task-1`，
  `multiTaskIds` 去重后只有一个 id，因此真机只验证了「至少发出一次取消请求」，
  没有验证「每个分支各发一次」；多 id 的逐个遍历只有源码断言覆盖。
- 取消请求的结果由面板决定，界面区分确认与未确认；这里没有验证面板是否真的终止了执行器。
- 下游执行器仍是 `max_workers=1` 单线程排队，本轮没有改变并发能力。

## 2026-11-11 多显示器窗口几何、主窗按工作区收缩

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 单元测试 | `npm test` | 244/244（新增 13 项：几何 8、桌宠多屏 5） |
| 界面真机 | `npm run verify:ui` | 71 项，console 错误 0（回归，主界面未改） |
| 桌宠真机 | `npm run verify:pet` | 21 项，errors 0（回归） |
| 主进程真机 | `npm run verify:main` | 15 项（新增 `main-window-fits-work-area`、`pet-display-aware`） |
| 桌面冒烟 | `npm run smoke` | 通过 |
| vendor 素材离线校验 | `node scripts/vendor-assets.cjs --check` | 37 文件 / 2 来源 |
| 源码清单 | `node scripts/build-source-manifest.cjs` | 539 文件 |
| 发布源码扫描 | `python scripts/check_public_source.py` | `{"files":539,"findings":[]}`，退出码 0 |
| E 盘运行实例 | `node scripts/sync-to-runtime.cjs` 后复跑 | 单测 239 通过 + 5 明确跳过（0 失败）、`verify:ui` 71 项、`verify:pet` 21 项、`verify:main` 15 项；窗口几何读数与仓库侧一致 |

新增断言不是只看字符串：

- `display-geometry.test.cjs` 覆盖双屏、负坐标屏、坏显示器数据、拔屏最小平移、窗口大于工作区、
  1366×728 与 640×480 下的尺寸及 `minWidth/minHeight` 夹取。
- `pet-display.test.cjs` 用假 `electron.screen` 真跑 `pet:open` 与 `display-*` 事件：
  副屏位置不被改动、启动时已越界会夹回并落盘、重复事件不重复搬窗、托盘隐藏时不弹出、
  三种事件各只绑一次。
- `verify:main` 在真 Electron 里断言主窗不超出工作区、桌宠确实读到显示器列表；
  真机读数：`window:[1381,901]`、`workArea:[1707,1067,0,0]`、`desired:[1380,900]`。

**边界与未解决**：

- 本机工作区 1707×1067 DIP 大于原尺寸，**主窗尺寸没有实际变化**；小屏收缩只由纯函数单测
  与源码断言覆盖，没有在 1366×768 或混合 DPI 双屏真机上实测。
- 桌宠多屏恢复 / 热插拔只在假 `screen` 下验证，没有真的拔过外接显示器。
- 透明桌宠窗口在部分显卡上的偶发闪烁仍缺可靠复现，本轮未动。
- 真实模型调用与计费、安装包与升级、系统休眠唤醒仍未覆盖。

## 2026-11-11 桌宠输入链路、清单跨机器核对、临时数据排除

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 单元测试 | `npm test` | 229/229（新增 10 项：桌宠拖拽/滞回 3、清单规则与真跑校验 7） |
| 界面真机 | `npm run verify:ui` | 71 项，console 错误 0（回归，未改主界面） |
| 桌宠真机 | `npm run verify:pet` | 21 项，errors 0（新增 `pet-menu-keyboard`） |
| 主进程真机 | `npm run verify:main` | 13 项（回归） |
| 桌面冒烟 | `npm run smoke` | 通过 |
| vendor 素材离线校验 | `node scripts/vendor-assets.cjs --check` | 37 文件 / 2 来源 |
| 源码清单 | `node scripts/build-source-manifest.cjs` | 536 文件 |
| 发布源码扫描 | `python scripts/check_public_source.py` | `{"files":536,"findings":[]}`，退出码 0 |
| E 盘运行实例 | `node scripts/sync-to-runtime.cjs` 后复跑 | 单测 224 通过 + 5 明确跳过（0 失败）、`verify:ui` 71 项、`verify:pet` 21 项、`verify:main` 13 项 |

新增断言不是只看字符串：

- `pet-drag.test.cjs` 用假 Electron 真调 `pet:control`：松手只带最终坐标时窗口落到该位置并落盘；
  hover 在穿透 / 可点两种状态下擦边不切、真正进出才切，且 `lastProbe.source` 必须是 `renderer`。
- `source-manifest.test.cjs` 证明 CRLF / LF 规范化后哈希一致、二进制不被改写，
  并**真的启动 Python** 跑一遍校验脚本，断言 findings 为空。
- `pet-verify.cjs` 在真桌宠窗口里派发 `ArrowDown` / `Escape`，断言焦点轮转、菜单收起、焦点归还角色。

**边界与未解决**：

- E 盘四层验证首轮串行时 `verify:pet` 有一次退出 1，当时输出被截断、原因未定位；
  随后单独复跑 3 次、按相同顺序（先 `verify:ui` 再 `verify:pet`）复现 1 次，均为 21 项通过。
  这不记为「已修好」，只记为未定位的偶发。代码里补掉的菜单聚焦竞态是独立的可解释缺陷，
  不宣称它就是那次失败的原因。
- 透明桌宠窗口在部分显卡上的偶发闪烁仍缺可靠复现；8px 滞回只减少窗口样式切换次数，
  不等于根治，右键「不透明窗口」仍是可用的缓解手段。
- `hover` 依赖 Electron 在穿透状态下转发 `mousemove`，转发中断时由 200ms 轮询兜底；
  混合 DPI 多显示器与真实鼠标手感的量化没有测。
- 历史提交里曾跟踪过 smoke 临时工作区，本轮只停止继续跟踪，没有重写 Git 历史。
- 最终全量时 `verify:ui` 的情绪标像素断言曾报 `0/441 全灰度`（DOM 解码 / 尺寸 / opacity
  检查全过），符合已知的 `capturePage` 缓存帧行为。已改为最多 4 次抓帧重试、每次等 120ms，
  阈值不变、失败时保留 4 次采样值；改的是验证脚本不是产品代码，改后连续 3 次 71 项通过。

## 2026-11-11 走路帧真生效、空房间分状态、项目定位写清

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 单元测试 | `npm test` | 219/219（新增 5 项，含两种目录布局兼容） |
| 界面真机 | `npm run verify:ui` | 71 项，console 错误 0（新增 7 项） |
| 桌宠真机 | `npm run verify:pet` | 20 项，errors 0 |
| 主进程真机 | `npm run verify:main` | 13 项 |
| 桌面冒烟 | `npm run smoke` | 通过 |
| vendor 素材离线校验 | `node scripts/vendor-assets.cjs --check` | 37 文件 / 2 来源 |
| 源码清单 | `node scripts/build-source-manifest.cjs` | 536 文件 |
| E 盘运行实例 | `npm test` / `npm run verify:ui` | 218 通过 + 1 明确跳过 / 71 项 |

新增的真机断言不是只看变量存在：

- `collab-walk-*` 用真实 `PointerEvent` 把角色拖到别处，再从右键菜单「取消固定位置」
  交回自动归位，采样 spritesheet 的 `--pet-row` / `--pet-frames` / `--pet-flip`：
  归位瞬间必须是 row 1/2、8 帧、不镜像，走完回到状态帧，手动位置被清掉。
- `stage-empty-*` 覆盖两种空状态：有在线模型未勾选（文案引导勾选、按钮隐藏），
  以及一个在线模型都没有（引导启用连接、按钮可点且真的跳到模型页），再恢复勾选确认卡片收回。
- 两种空状态都截了真图核对卡片位置与文字；`stage-page.png` / `stage-pet.png`
  由 `verify:ui` 在有角色时生成，不受影响。

**边界**：走路帧在真实归位时的触发已由上面的 DOM 事件路径覆盖，但没有逐帧录屏；
透明桌宠窗口在部分显卡上偶发闪烁仍缺可靠复现，未改动。

## 2026-11-11 设施可点、时段光照、头顶状态条

| 检查 | 命令 | 结果 | 边界 |
| --- | --- | --- | --- |
| 单元 | `npm test` | 214/214 | 新增 `facility-panel.test.cjs` 4 项接线与「不造假」断言 |
| 主界面真机 | `npm run verify:ui` | 64 项，console 错误 0 | 新增 9 项：铭牌 `elementFromPoint` 真命中、面板打开/锚定/拖动/关闭、真实占用与无编造指标、时段跟随时钟、状态条跟随状态、操作按钮接通已有能力 |
| 桌宠真机 | `npm run verify:pet` | 20 项 | 未改动桌宠逻辑，回归检查 |
| 主进程 | `npm run verify:main` | 13 项 | 未改动启动链路，回归检查 |
| 冒烟 | `npm run smoke` | 通过 | — |
| 素材 | `node scripts/vendor-assets.cjs --check` | 37 文件 / 2 来源 | 本轮未新增素材 |
| 清单 | `node scripts/build-source-manifest.cjs` | 535 文件 | 含两个新文件 |

仓库与 E 盘运行实例（`E:\多Agent工作台升级规划\desktop-shell-prototype`）两侧都跑过：
运行实例单测 214/214、`verify:main` 13 项。

截图核对过一次设施面板打开时的画面：面板贴画布顶部，三个角色形象与两块分区标签都完整可见。
临时截图与探测脚本未入库。

**没做的**：排班、产出结算、离线推进、心情/额度约束。本轮是交互与视觉层，
不是经营模拟；面板里没有任何凭空生成的数值。

## 2026-11-10 右键菜单浮到角色头顶 + 可拖动；桌宠拖动更跟手

| 检查 | 命令 | 结果 | 边界 |
| --- | --- | --- | --- |
| 单元 | `npm test` | 210/210 | `pet-drag.test.cjs` 的菜单钳制断言随锚定逻辑更新 |
| 主界面真机 | `npm run verify:ui` | 55 项，console 错误 0 | 覆盖 `collab-context-menu` 等右键菜单断言 |
| 桌宠真机 | `npm run verify:pet` | 20 项，errors 0 | 覆盖右键菜单、关闭、锁定 |

改动：桌宠右键菜单与协作视图右键菜单都从「光标落点」改为「锚在角色头顶、标题条可拖动」；
桌宠拖拽去掉 `drag-start` 回包等待，`drag-move` 直接带 `screenX/screenY`，主进程不再轮询全局光标。

**未覆盖**：桌宠拖拽的「丝滑度」只能靠真机手感判断，自动测试只验证「绝对定位公式不漂移」
（`pet-drag.test.cjs`）与「菜单能开、项数对、能关」。桌宠「偶尔闪一下」是透明窗口在部分
显卡上的 DWM 表面重组问题，缺真机复现，本轮未改，靠右键 → 不透明窗口缓解。

## 2026-11-10 主进程真实启动路径

| 检查 | 命令 | 结果 | 边界 |
| --- | --- | --- | --- |
| 单元 | `npm test` | 210/210 | 含 `main-verify-wiring.test.cjs` 7 项接线断言 |
| 主进程真机 | `npm run verify:main` | 13 项，errors 0 | 独立临时 profile，不拉起 Python 服务 |
| 冒烟 | `npm run smoke` | 65 项 | smoke 分支在建窗前返回，走不到本轮这条路 |
| 主界面真机 | `npm run verify:ui` | 55 项，console 错误 0 | 桩 preload，不建桌宠窗口 |
| 桌宠真机 | `npm run verify:pet` | 20 项，errors 0 | 独立 userData，不启动完整主进程 |

`verify:main` 覆盖的是此前唯一没有自动验证的分支：`whenReady` 之后建主窗 → 注册桌宠 →
拉托盘 → 关窗收进托盘 → 托盘恢复 → 退出停服务。逐项为
`single-instance-lock`、`main-window-created`、`main-window-isolation`、`main-window-shown`、
`main-window-first-paint`、`main-window-loaded`、`ipc-round-trip`、`tray-created`、`tray-menu`、
`pet-window-registered`、`close-hides-to-tray`、`restore-from-tray`、`ready-to-quit`。

三条踩过的坑，写在这里免得下次重新踩：

1. **`isVisible()` 不能当唯一证据**。这台机器上出现过：`show` 事件已触发、事件回调里
   `isVisible()` 为 `true`，几十毫秒后同一窗口读回 `false`，而窗口确实已经显示。
   现在的判定用窗口事件计数 + `ready-to-show` 里置的 `__shown` 标记，`isVisible()` 只写进
   `diagnostics` 供排查。另外 `ready-to-show` 对**只创建不显示**的窗口不会来，
   所以「首帧是否画完」必须真的显示一次才能验，不能省。
2. **`getLastWebPreferences()` 不返回 `backgroundThrottling`**。想在运行时断言它一定会失败，
   改成源码层断言「只有 `smokeMode` 才把它关掉」。
3. **别对固定目录做递归删除**。第一版把结果和 userData 放在 `desktop/` 下，清理时撞上
   批量删除保护。现在每次 `mkdtemp` 一个系统临时目录，清不掉也不影响判定。

运行 `verify:main` 时会短暂显示一次主窗和一只桌宠——不显示就没有首帧，这条验收无法伪造。

**仍然没覆盖**：多显示器与混合 DPI、拖到第二块屏、系统休眠唤醒、安装包与升级、
真实模型调用与计费。这是开发预览的自动验收，不是产品验收。

## 2026-11-10 侧栏图标统一与协作舱状态情绪标

| 检查 | 命令 | 结果 | 边界 |
| --- | --- | --- | --- |
| 单元 | `node --test *.test.cjs` | 203/203 | 含新增 3 项素材单测 |
| 素材离线完整性 | `node scripts/vendor-assets.cjs --check` | 37 文件、2 来源 | 只比对本地 SHA-256，不联网 |
| 主界面真机 | `npm run verify:ui` | 55 项，console 错误 0 | 桩 preload，不建桌宠窗口 |
| 桌宠真机 | `npm run verify:pet` | 20 项，errors 0 | 独立 userData，不启动完整主进程 |

新增 3 项真机检查：`sidebar-vendor-icons-decoded`（侧栏 12 张图标全部 `decode()` 成功、
`offsetWidth ≥ 12`、`opacity > 0.5`、src 都在本地 vendor 目录）、
`collab-mood-follows-state`（`setActorState('thinking')` 显示并切回 `waiting` 隐藏）、
`collab-mood-visible-pixels`（抓 `capturePage()` 的 BGRA，数情绪标矩形内的饱和像素）。

**为什么不只查 DOM**：情绪标最初有 `opacity:0 → 1` 的入场动画加 `fill-mode:both`。
真机验证窗口是 `show:false`，Chromium 不推进隐藏窗口里的 CSS 动画，`currentTime` 卡在 0，
于是「DOM 在 + 已解码 + 单测全过」但人看不见。现在断言覆盖
「解码成功 / 有布局尺寸 / `opacity:1` / 屏幕上真有彩色像素」四层，并去掉了入场动画。
像素统计还踩过一个坐标坑：位图是 1899×1137 设备像素，`getBoundingClientRect()` 是
1280×820 CSS 像素，必须按 `bitmap.width / window.innerWidth` 换算；不换算会采样到无关区域，
得到看似合理实则无意义的数字。修正后实测 ✨ 29.9%、🔥 44.7% 彩色像素，
另用可见窗口截图人工核对过侧栏深浅主题与三个角色的 ID 牌。

`vendor-assets.test.cjs` 新增 3 项：主界面 `index.html` 的 12 个引用都在清单里且无外链 /
无 inline handler、协作舱 `MOOD_ART` 的 5 张图都在清单里、这 5 张图的饱和色占比 ≥0.9
（💭/💬 只有 0.17~0.36，贴在白色 ID 牌上等于隐形）。仓库与运行实例两侧各跑一遍，结果一致。

## 2026-11-10 第三方素材接进桌宠

| 检查 | 命令 | 结果 | 边界 |
| --- | --- | --- | --- |
| 单元 | `node --test *.test.cjs` | 200/200 | 含新增 `vendor-assets.test.cjs` 6 项 |
| 素材离线完整性 | `node scripts/vendor-assets.cjs --check` | 25 文件、2 来源 | 只比对本地 SHA-256，不联网 |
| 主界面真机 | `npm run verify:ui` | 52 项，console 错误 0 | 桩 preload，不建桌宠窗口 |
| 桌宠真机 | `npm run verify:pet` | 20 项，errors 0 | 独立 userData，不启动完整主进程 |

`verify:pet` 新增 3 条：工具栏 6 张 Tabler SVG 全部 `decode()` 成功且 src 都在
`assets/vendor/tabler-icons/`；表情面板 8 张 Fluent Emoji SVG 同样解码成功；页面所有 `<img>`
没有一条 `http(s)` 外链。判据是 `complete && naturalWidth > 0`，不是只看 DOM 里有没有 `<img>` 节点。

`vendor-assets.test.cjs` 锁住：来源固定到 40 位 commit、每个文件 SHA-256 / 字节数与清单一致、
两份 LICENSE 原文存在且为 MIT、SVG 不是 404 页面、`pet.html` 与 `pet-ui.js` 的引用都在清单里
且无外链。测试按桌宠目录相对定位素材，所以同步后的运行实例跑的是同一套断言。
`node scripts/vendor-assets.cjs --check` 是仓库侧的独立离线核对，不依赖 Electron。
仓库与运行实例两侧各跑一遍，结果一致。

## 2026-11-09 桌宠链路：桩验证与真机验证分开

此前 `verify:ui` 中的 `pet-desktop-window` 是误报：它使用桩 preload，`petOpen` 直接返回
`{ok:true}`，从不创建窗口。现改名为 `pet-open-ipc-dispatch`，只断言 IPC 被派发；窗口本身
由 `npm run verify:pet` 在真实 Electron 中验证。

| 检查 | 命令 | 结果 | 边界 |
| --- | --- | --- | --- |
| 单元 | `node --test *.test.cjs` | 194/194 | Node 内置测试；含新增 `pet-motion.test.cjs` 10 项 |
| 主界面真机 | `npm run verify:ui` | 52 项，console 错误 0 | 桩 preload，不建桌宠窗口 |
| 桌宠真机 | `npm run verify:pet` | 17 项，errors 0 | 独立 userData，不启动完整主进程 |

`verify:pet` 覆盖：按钮绑定、`pet:open` 真的多出一个 `BrowserWindow`、`pet.html` 加载、
角色 sprite 动画与素材、工具栏 6 项、BGRA 非透明像素、30 个形象、右键 6 项、
hitbox 快照、`petControl('lock')`、以及 `petControl('close')` 真的销毁窗口。
2026-11-09 晚新增 5 条输入驱动动作断言：状态机 API 存在、光标左右翻转、
快速划过 `jump → 5 帧 / 1100ms`、打字 `work → 6 帧 / 1320ms`、动作冷却后回 idle。
后两条同时锁住「帧数必须跟动作行一起换」，防止只改 `--pet-row` 扫到空白格导致的闪烁回归。
仓库与 `E:\多Agent工作台升级规划\desktop-shell-prototype` 运行实例两侧各跑一遍，结果一致。

运行实例同步用 `node scripts/sync-to-runtime.cjs`（可先加 `--dry-run`）。桌面快捷方式
「模型工作台体验版」指向该目录下的 Electron 二进制；只 push GitHub 不改这份目录，
用户重启应用也看不到更新。同步后需完全退出应用再打开。

## 2026-10-30 派发体验增量

在实际开发源码修复前，新增4项回归测试分别复现查询断线后停止、窗口显示后不恢复、慢查询叠加和终态错误文案。修复后增加预览失效/确认变更等测试。

- `node --test dispatch-ui.test.cjs task-dispatch.test.cjs dispatch-state.test.cjs`：28项通过。
- `node ui-verify-run.cjs`：18项通过，包括可读预览与默认折叠的技术详情。
- `node verify-routing.cjs`：4项跨语言契约检查通过；真实桌面构造的请求交给Python服务源码 `requirements` 处理，无服务派发、无模型调用。短提示词估计4096，测试用长中文提示词估计32048；这些是算法估计，不是实测用量。
- 原有预算开关、总时限和单请求输出上限保持原值。

契约检查需要服务的Python依赖。默认使用仓库根目录 `.local-worker/venv/Scripts/python.exe`；分开安装时可设置 `MODEL_DESK_SERVICE_ROOT` 和 `MODEL_DESK_PYTHON`。这些变量不是密钥，示例应使用自己的安装路径。

下文保留首次发布的验证结果，未重新宣称全量服务或全新机器安装已经通过。

## 首次源码发布

日期：2026-10-30。验证对象是脱敏发布目录中的源码，Windows 本机执行；复用了现有 Python、Node、Electron 和 Playwright 依赖，没有在一台干净机器重新安装全部依赖。

| 检查 | 结果 | 边界 |
| --- | --- | --- |
| 桌面全部 `*.test.cjs` | 88 通过 | Node 内置测试，包含记忆隔离、派发参数、小窗缓存与主题 |
| Electron `smoke-runner.cjs` | 通过 | 生命周期与记忆等交互冒烟；含桩和演示，不是付费模型验收 |
| Electron `ui-verify-run.cjs` | 17 项通过 | 项目切换、页面、对话与动态流等桩测试 |
| `toolbar-verify.cjs` | 6 组通过 | 600/800/1280px × 深浅主题；16 控件、展开、键盘、溢出与保存可见性 |
| 服务端选测 | 166 项：164 通过，1 跳过，1 环境错误 | 缺少本机 DSH native-preset 包；本组整体退出码为 1，不能标全通过 |
| 发布源码扫描 | 生成发布清单后另行运行 | 常见秘密格式与禁止文件检查，不是完整安全审计 |

服务端选测在 `.local-worker/tests` 内执行：

```powershell
python -W ignore::ResourceWarning -m unittest test_opensource_bootstrap test_project_scope test_project_storage test_record_protection test_router
```

环境错误位于 `test_record_protection.PatchTests.test_preset_identity_and_revision_are_untouched`：该集成检查依赖已安装 DSH 的原生预设。源码包不提供该外部应用的用户配置，也不会为让测试通过而复制个人配置。应在正确配置的专用环境重跑。

桌面测试可在 `desktop` 安装依赖后使用 README 中的命令重跑。工具栏附加检查需要 Playwright 和 Edge；可用 `MODEL_DESK_NODE_MODULES` 指定含 Playwright 的模块目录。

未完成的验证：干净机器安装、正式安装包、所有执行软件版本兼容、真实长任务持续运行、故障恢复全链路、多项目负载、公平调度、真实单/多 Agent 成本质量对比。没有把这些写成通过。
