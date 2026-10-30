# 架构与数据边界

本仓库包含协作服务和 Electron 桌面预览。根目录安装服务依赖，`desktop` 单独安装桌面依赖；不捆绑模型权重、外部 AI 软件或它们的账户。

```text
用户 / 主导 AI 软件
        │ 选择项目、确认任务与权限
        ▼
Electron 桌面 ── 回环 HTTP ── Python 协作服务
  │ 预览/派发/观察              │ 路由、队列、任务记录、验收
  │                            ▼
  │                      执行端适配器
  │                  DSH / Pi / WorkBuddy / ZCode
  ▼                            │
本地记忆与结构草稿              ▼
                    用户配置的本地模型或在线服务
```

## 代码入口

| 目录/文件 | 职责 |
| --- | --- |
| `desktop/main.cjs`、`preload.cjs` | 原生窗口、IPC、托盘、小窗与发送确认 |
| `desktop/memory-store.cjs`、`memory-retrieval.cjs` | 本地记忆、检索、上下文筛选 |
| `desktop/architecture-store.cjs`、`designer.js` | 可编辑结构草稿、历史、验证与应用 |
| `desktop/panel-connector.cjs`、`task-dispatch.cjs` | 本机探测、项目绑定、派发与状态查询 |
| `.local-worker/panel_server.py` | 本机 API 与原始管理面板 |
| `.local-worker/model_router.py` | 基于声明的路由，不是模型能力排行榜 |
| `.local-worker/project_storage.py`、`review_task.py` | 项目记录与独立验收 |
| `.local-worker/agent-runtime/`、`integrations/` | 外部执行端适配 |

## 生命周期

任务应经过项目选择 → 权限及内容检查 → 派发 → 执行结果 → 独立验收。执行端返回 completed 只说明执行结束；不可自动当作验收通过。故障保留原始记录，不能通过切换供应商隐藏失败。

桌面中的模拟任务用于展示交互；测试中的桩服务验证协议和状态处理。它们都不是实际模型执行证据。旧额度/模型面板目前仍被内嵌，界面统一尚未完成。

## 记忆

本地记忆默认写入 Electron 的 `ModelDesk-Memory-Preview` 用户数据目录，结构有项目、私人和公共池分类。公共池表示本机共享范围，不表示允许向互联网公开。结构编辑经过草稿、预览与保存；“AI 建议”当前是复制结构提示词、粘贴结果并校验的手动流程。

项目任务记录归属于所选项目 `.model-desk`；安装目录不是项目身份。项目切换时必须重新绑定查询，不能沿用另一项目的响应或小窗缓存。应用层分类和参数防护不构成操作系统隔离，也不构成文件加密。
