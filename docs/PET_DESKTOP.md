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
