# Model Desk Workbench

Windows 上的 Electron 桌面协作与记忆工作台。仓库包含根目录的本机协作服务 `.local-worker\`、
桌面源码 `desktop\`，以及根目录的安装与启动脚本。

基于 MIT 许可的上游项目
[multi-agent-collaboration](https://github.com/Gambler134201/multi-agent-collaboration) 开发，
上游版权与许可见 [LICENSE](LICENSE)、[THIRD_PARTY.md](THIRD_PARTY.md)。

## 开发状态：预览版，未成熟

本版保留上游服务源码并加入桌面升级，但很多目标尚未完成，功能仍在变动，不保证稳定。
本文和界面上的任何提示都不代表「功能已全部完成」。

## 目前已具备

- 记忆空间、架构画布、拖动与工具栏折叠
- 本地记忆检索、上下文预览、发送前确认
- 真实的本机服务探测、显式选择项目、配置模型连接并派发任务
- 任务的对话式动态与详情、小窗、托盘、深浅主题、本机壁纸、性能视图

「模型与额度」已有统一列表、搜索筛选、账户快照与选择模型进入对话；复杂配置保留在「高级设置」内嵌面板。使用说明与限制见 [模型与额度](docs/MODELS_OVERVIEW.md)。

## 未完成 / 未验证

- 主导软件内的原生跳转尚未打通
- 实时多组讨论与互评
- 闲时 7B 记忆提炼队列
- 准确的每模型 GPU 归因
- 可信的单 Agent / 多 Agent 节省百分比
- 跨机器全新安装的验收

其他限制：

- 桌面派发已交由服务端按内容和任务类型估算 Token；这仍是近似值，**不是实际账单或费用保证**。
- 7B 测试只代表那一次任务，**不构成通用能力评分**。
- 权限是应用层实现，**不是 OS 沙箱**；本地存储**不是加密存储**。

## 模拟、桩测试与真实任务必须区分

- 界面里的演示/模拟数据不等于真实任务。
- 自动化测试使用桩和 mock，不等于真实付费调用。
- 「连接成功」不等于模型调用已验收。
- 任务状态 `completed` 不等于 `accepted`（已交付 ≠ 已验收）。

## 快速运行

前提：Windows x64、PowerShell 7、Python 3.11+、Node 22.12+、pnpm 10.26+。Windows 自带的 PowerShell 5.1
不支持启动脚本，请用 `pwsh`。在包含 `setup.ps1` 的目录中执行：

```powershell
pwsh -File ./setup.ps1 -Check          # 只读检查前提，不写文件
pwsh -File ./setup.ps1                 # 创建虚拟环境并安装服务依赖
pwsh -File ./打开模型工作台.ps1 -NoBrowser   # 启动本地服务，不打开浏览器
```

另开一个终端启动桌面端：

```powershell
cd desktop
npm ci
npm start
```

- `setup.ps1` 不会替你安装 Python、Node、pnpm、执行软件或模型，缺什么只会报出来。
- 只体验本地界面时，可以不启动真实服务。
- 环境变量、模型配置、退出与回退见 [docs/INSTALL.md](docs/INSTALL.md)。

## 真实调用需要你自己准备

工作台不带模型、账号或密钥。发出真实调用需要你：

1. 自行安装并配置执行软件，按 INSTALL.md 用环境变量告知其位置；
2. 在面板中填写自己的模型服务地址、模型 ID 和密钥（或环境变量名）；
3. 显式选择要操作的项目；
4. 自行确认协作开关与付费授权（默认关闭）。

未完成这些，只能看到界面和模拟数据，不会有真实模型调用。

## 验证命令

在 `desktop` 目录内执行：

```powershell
npm test
npm run smoke
npm run verify:ui
```

这些自动测试**不代表**真实付费调用，也**不代表**完整产品验收。本文不给出任何通过数量结论。

## 隐私

发布清单排除了账户配置、密钥、任务记录、个人记忆及截图，本机专属模型编号和路径已替换为测试占位。通用模型名称仍会出现在适配代码和文档中。
新增数据不会自动进入 Git，请自行检查提交内容。详见 [docs/PRIVACY.md](docs/PRIVACY.md)。

## 进一步阅读

[安装与配置](docs/INSTALL.md) · [隐私](docs/PRIVACY.md) · [架构](docs/ARCHITECTURE.md) ·
[路线图](docs/ROADMAP.md) · [验证](docs/VALIDATION.md) · [功能入口与缺陷核对](docs/UI_FUNCTION_AUDIT.md)
