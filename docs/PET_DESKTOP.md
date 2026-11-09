# 独立悬浮桌宠

更新：2026-11-07。入口：协作视图右上角「悬浮到桌面」。

## 窗口

`desktop/pet-window.cjs` 创建 **250×300 的局部透明小窗**：`transparent` + `frame:false` +
`alwaysOnTop` + `skipTaskbar` + `hasShadow:false`。只占角色包围盒，不铺满屏幕——
这是 dsh-pet 等成熟桌宠为避免 Windows DWM 全屏透明层黑屏采用的取舍。

参考过的项目与做法：

| 项目 | 借鉴 |
| --- | --- |
| [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) | 浏览器/桌面双壳共用一套状态与动画、局部透明小窗、表情包与模型对话 |
| [isHarryh/Ark-Pets](https://github.com/isHarryh/Ark-Pets) | 拖拽物理、点击反应、多实例、透明穿透 |
| [BigPizzaV3/CodexPlusPlus](https://github.com/BigPizzaV3/CodexPlusPlus) | 表情包素材的授权核对 |
| [Mikolu/cute-fat-fish-pet](https://www.dshplugin.store/plugin/12we21/cute-fat-fish-pet) | Electron 透明窗口、托盘、位置记忆 |

## 功能

| 操作 | 结果 |
| --- | --- |
| 拖动角色 | 主进程移动窗口，位置写入 `userData/pet-window.json`，重启仍在原处 |
| 🔒 锁定 | 锁定后不再响应拖动；再点解锁 |
| 📌 置顶 | 切换 `alwaysOnTop` |
| 😀 表情包 | 8 个贴纸（🎉💡👀☕🔥💤❓👍），冒气泡并切对应动作 1.8 秒；双击角色随机来一个 |
| 💬 对话 | 下拉选本机面板里的模型，输入一句 → 复用 `dispatch:send / log / status` 派发，气泡显示回复 |
| ⇄ 换形象 | 在 5 个模型主题 Q 版角色间切换 |
| ✕ 关闭 | 关掉小窗；主窗口退出时也会一并关闭 |

配置读取有 `sanitizeState` 收紧，坏数据不会进入窗口构造参数。`pet.html` 已加入主进程的
`assertTrustedSender` 白名单，才能复用同一套派发 IPC；没有新造后端，也没有联网请求。

## 边界

- 「锁定」是禁止拖动，**不是**系统级鼠标穿透；全穿透 `setIgnoreMouseEvents` 需要额外唤醒入口，暂未做。
- 对话依赖本机面板与已选项目；面板未连接时下拉如实显示「未读到模型」，不伪造回答。
- 角色素材为同人创作，**非商业、需署名**，见 `THIRD_PARTY.md` 与
  `desktop/assets/characters/roster/NOTICE.md`。

## 验证

174 项单测与 33 项真机 UI 检查全过；另用真窗口检查了 sprite 渲染、8 个表情、3 个模型、
表情面板、对话面板与锁定切换。真机验证使用桩 preload，不代表真实付费调用。

## 权限边界（23:20 复查补）

桌宠窗口使用独立的 `desktop/pet-preload.cjs`，`window.workbench` 只暴露八个接口：
`getState`、`dispatchModels`、`dispatchSend`、`dispatchLog`、`dispatchStatus`、
`petOpen`、`petState`、`petControl`。主窗口的 `preload.cjs` 不动。
`pet:open` 只接受本地 `file:` 下以 `/index.html` 或 `/pet.html` 结尾的来源
（`isTrustedPetUrl()`），远程页面或路径拼接都进不来。
主进程的 `assertTrustedSender` 仍把 `pet.html` 列入白名单，因为派发链路需要它，
但实际可调用的通道已被 preload 限制到最小集合。

## 真机验证与运行实例同步（2026-11-09）

上文「174 项单测与 33 项真机 UI 检查」是当时那一版的历史结果，不是当前数字。
当前结果以 `CHANGELOG.md` 与 `docs/VALIDATION.md` 为准。

- `npm run verify:pet`：真实 Electron 里跑完「主界面按钮 → 独立桌宠窗口 → 窗口内交互 → 关闭」
  共 12 项。其中会数 BGRA 的非透明像素，避免 `isVisible()` 为真但屏幕上什么都没有。
- `verify:ui` 用桩 preload，只覆盖到 `petOpen` 被调用，检查名 `pet-open-ipc-dispatch`，
  不再冒充窗口验证。
- 代码改完跑 `node scripts/sync-to-runtime.cjs` 同步到桌面快捷方式指向的运行实例，
  否则 GitHub 更新了、桌面上还是旧版。同步后必须完全退出应用再打开。

## 拖动方向修复（2026-11-08）

早期版本由渲染层用 `clientX/Y` 增量调用 `petControl('move')`：窗口一动，渲染进程的
client 坐标会反向变化，表现为"往反方向跑"和抖动。现改为主进程用
`screen.getCursorScreenPoint()` 记录起点，`drag-start / drag-move / drag-end` 三段式，
以「起点窗口位置 + 累计屏幕位移」定位，不累加增量；渲染层只发信号并用 rAF 节流。
`pet-drag.test.cjs` 覆盖来回拖动与锁定状态。

## 输入驱动动作：仿 BongoCat / CatPet（2026-11-09 晚）

之前桌宠平时恒播 idle，只有表情、双击、拖动时短暂切一次。现在由 `desktop/pet-motion.js`
的状态机统一决定该播哪一行，纯逻辑、注入时钟，单测可直接跑，不碰 DOM。

| 输入 | 动作 | 说明 |
| --- | --- | --- |
| 光标移到角色左 / 右 | 只翻 `--pet-flip` | 不切动作行：`moveLeft/moveRight` 是走路，拿来转头会像自己跑起来 |
| 快速划过（≥0.9 px/ms） | `jump` | 追光，650ms 后回落 |
| 聊天框打字 | `work` | 700ms 无按键后回落，不采集输入内容 |
| 单击角色 | `wave` | 被摸一下，900ms |
| 表情 / 派发结果 | 指定行 | 可带自定义时长，优先级高于点击和打字 |
| 拖动 | `moveRight` | 由 `drag-start` / `drag-end` 显式界定 |
| 15 秒无任何输入 | `wait` | 打盹；一有输入立刻回 `idle` |

优先级：拖动 > 表情 > 点击 > 打字 > 追光 > 转身 > 打盹 > 待机。「降低动效」开启时完全静止。
`pet-ui.js` 用 rAF 每 110ms 取一次结果，只在行或朝向变化时写 DOM。

**同时修掉的闪烁**：旧 `setRow()` 只改 `--pet-row`，切到 4 帧的 `wave` / 5 帧的 `jump` 时
仍按 idle 的 6 帧播，每轮扫到素材空白格就闪一下。现在统一走 `applyRow()`，
`--pet-frames`、`--pet-dur`、`--pet-flip` 一起写。

**仿制边界**：借鉴的是交互模式，不是移植。`ayangweb/BongoCat`（Apache-2.0）的 Live2D 模型、
`vishnuace/CatPet`（MIT）的像素猫、两家的全局键鼠钩子和自定义模型导入都没搬。
不装 `uiohook-napi` 之类的新依赖，也不读全局键盘——只处理桌宠窗口自己收得到的事件，
所以角色不会在你登录别的窗口时敲键盘。来源与许可见 `THIRD_PARTY.md`。
