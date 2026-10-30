# 第三方依赖与外部应用

本公开版整合 [Gambler134201/multi-agent-collaboration](https://github.com/Gambler134201/multi-agent-collaboration) 的 MIT 服务源码与后续桌面工作台改动，保留原版权声明。当前副本来自本机源码快照，未保留可核验的上游提交号，不声称等同于上游最新版本。根目录的安装脚本只负责服务依赖；`desktop` 需要单独执行 `npm ci`。

桌面直接依赖 Electron 45.0.0，锁文件见 `desktop/package-lock.json`。可选的 `toolbar-verify.cjs` 验证需要自行提供 Playwright 和 Microsoft Edge；Playwright 不属于运行时依赖，不随源码包附带。普通单元测试使用 Node 内置测试模块。

本目录提供本项目源码，不附带 Python/Node 运行环境、依赖安装目录、DSH/Pi/Codex/WorkBuddy 应用或这些应用的用户数据。

## 直接依赖

| 依赖 | 固定版本 | 安装来源 |
| --- | --- | --- |
| anyio | 4.12.1 | PyPI |
| mcp | 1.30.0 | PyPI |
| psutil | 7.2.2 | PyPI |
| tiktoken | 0.12.0 | PyPI |
| PyYAML | 6.0.3 | PyPI |
| acpx | 0.19.5 | npm registry，通过 pnpm-lock.yaml 安装 |

Python 清单见 requirements.txt；Node 直接依赖与传递依赖见 .local-worker/agent-runtime/package.json 及 pnpm-lock.yaml。
依赖自身的许可与声明随对应软件包提供，本项目的许可证不会替代它们。

## 用户单独安装

DSH（DeepSeek Harness）、Pi Agent、Codex、WorkBuddy、Python、Node 和 pnpm 由使用者独立安装。本项目只提供适配代码，未将它们的程序、SDK安装目录、原生探测目录或用户配置复制到源码包。

WorkBuddy 适配使用用户本机已安装应用提供的原生能力；账户、积分、模型访问和第三方服务条件由对应平台管理，不随本项目的 MIT 许可授予。

本项目自身源码采用 [MIT 许可证](LICENSE)，Copyright (c) 2026 Gambler134201。此许可不替代上述第三方依赖或外部应用的许可。
