# 本次发布验证

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
