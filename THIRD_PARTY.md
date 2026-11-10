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

## 界面形象素材（2026-11-07 新增）

| 素材 | 来源 | 许可 | 位置 |
| --- | --- | --- | --- |
| Q 版拟人少女、像素螃蟹的六态动画 | [Ice-teapop/desktop-pet](https://github.com/Ice-teapop/desktop-pet) | MIT（文件；许可证全文 `LICENSE-deskpet`） | `desktop/assets/characters/` |
| 大肥鱼 / 鲸鱼娘桌宠 GIF | [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) | **CC BY-NC-SA 4.0**：署名、非商业、改编同协议 | `desktop/assets/pets/` |
| 17 个模型品牌标识 | [lobehub/lobe-icons](https://github.com/lobehub/lobe-icons) | MIT（代码）；标识本身仍是各品牌商标 | `desktop/assets/brands/` |

**授权边界**：MIT 只覆盖这些 SVG / sprite 文件，**不覆盖角色 IP**。拟人少女的原型是《原神》芙宁娜同人形象，
角色权利归原权利方；本项目仅作本机、非商业、个人使用的原型，不暗示官方背书。上游仓库亦声明
Clawd 形象未获原作者授权，本项目**没有采用 Clawd 素材**，只取了作者原创的像素螃蟹主题。
大肥鱼 GIF 的 CC BY-NC-SA 4.0 比 MIT 严格，同样限制商业使用。

**公开发布或商业化前**：必须把 `char-*.svg` 换成自有 / CC0 的拟人素材，把 `assets/pets/` 三个 GIF
换成自有素材，并相应更新或删除对应 NOTICE。完整条款、压缩方式与替换步骤见三个目录里的 `NOTICE.md`。

## 实际复制进仓库的第三方素材（2026-11-10）

与下一节「只借鉴模式」不同，这一节的文件是**从上游仓库逐字复制进来的**，运行时直接加载，
不经过 CDN、不需要联网。两份上游 LICENSE 原文已随附。

| 项目 | 固定 commit | 许可 | 复制内容 | 本地位置 |
| --- | --- | --- | --- | --- |
| [microsoft/fluentui-emoji](https://github.com/microsoft/fluentui-emoji) | `1ffb34c752ecf5d402f04cfb4b392c77f57c54bc` | MIT，Copyright (c) Microsoft Corporation | Color 风格 SVG 15 张（8 个表情 + 7 个状态气泡） | `desktop/assets/vendor/fluent-emoji/` |
| [tabler/tabler-icons](https://github.com/tabler/tabler-icons) | `58f60538fe2fab2e1459a09198f9bd3b033bf90e` | MIT，Copyright (c) 2020-2026 Paweł Kuna | outline / filled SVG 8 张，用于桌宠工具栏 6 个按钮及锁定、置顶两种状态 | `desktop/assets/vendor/tabler-icons/` |

`desktop/assets/vendor/SOURCES.json` 逐文件记录上游路径、本地路径、SHA-256 和字节数；
`node scripts/vendor-assets.cjs --check` 纯离线核对，`node scripts/vendor-assets.cjs`
按固定 commit 重新拉取（需要系统 `curl`，网络受限时可加 `--proxy URL`，中途断线可直接重跑）。
**没有引入 npm 依赖**，也没有把整包 emoji / 图标库塞进仓库，只取实际用到的 23 张 SVG + 2 份 LICENSE。
素材目录里的 `.gitattributes` 用 `* -text` 禁止 Git 行尾转换；否则 Windows 上 `core.autocrlf=true`
会把 LF 改成 CRLF，`--check` 记录的 SHA-256 会全部对不上。

**为什么换**：原来工具栏和表情用 Unicode 字符，由系统 emoji 字体渲染，不同 Windows 版本字形不一致，
`✕`、`⇄` 这类符号还和彩色 emoji 混在一起。换成固定矢量文件后跨机器一致。素材加载失败时
代码会退回原来的 Unicode 字符，不显示破图。

**许可边界**：MIT 覆盖这些 SVG 文件本身，不覆盖相关名称 / 商标。这两批素材可商用，
但项目里其它形象素材（`llm-pet`、`assets/pets/`）仍受非商业限制，整体发布 / 商业化状态**没有改变**。

## 借鉴的开源交互模式（2026-11-09，未复制代码或素材）

| 参考项目 | 许可 | 借鉴了什么 | 没有搬什么 |
| --- | --- | --- | --- |
| [ayangweb/BongoCat](https://github.com/ayangweb/BongoCat)（24.6k stars） | Apache-2.0（2026-09-28 由 MIT 改授） | 输入驱动动作、动作冷却回落到待机、离线无采集的设计取向 | Live2D 模型与 Cubism 运行时、全局键鼠/手柄钩子、Tauri/Rust 实现、自定义模型导入 |
| [vishnuace/CatPet](https://github.com/vishnuace/catpet) | MIT | 光标跟随转身、快速移动追光、闲置打盹、拖动反馈这些交互**模式** | 像素猫美术、canvas 渲染器、`uiohook-napi` 全局钩子、番茄钟与拉伸提醒 |

`desktop/pet-motion.js` 是本项目自己写的纯逻辑状态机，动作行映射到已有 `llm-pet` spritesheet，
**没有复制上述项目的任何源代码、模型文件或美术资源**，因此没有引入它们的再分发义务；
此处列出仅为标明设计来源、便于追溯。

**明确未采用**：[kiraio-moe/Arknights-Base](https://github.com/kiraio-moe/Arknights-Base) 等
游戏解包资源仓库，其 README 自述素材版权归 Hypergryph 所有，不构成可用授权。协作舱的等轴房间
与家具全部是本项目自绘 SVG（`desktop/assets/rooms/office.js`），只取「基建感」这一视觉方向。

## 30 个模型主题 Q 版角色（2026-11-07 晚新增）

| 素材 | 来源 | 许可 | 位置 |
| --- | --- | --- | --- |
| 15 个模型 × 标准版 / Q 版，共 30 个角色、每个 9 种动作序列帧 | [savanna0425/llm-pet](https://github.com/savanna0425/llm-pet) | **无统一开源软件许可**：形象作者 **ZipZipPipe** 要求署名、**仅限非商业**；DeepSeek 形象另遵循 **CC BY-NC-SA 4.0**（另署名 **上善**） | `desktop/assets/characters/roster/` |

这些是同人形象，与 OpenAI / Anthropic / DeepSeek / Google / xAI 等公司无官方关联。
上游 `NOTICE.md` 原文见 `desktop/assets/characters/roster/NOTICE-llm-pet.md`，
本项目的取用与压缩说明见同目录 `NOTICE.md`。
**公开发布或商业化前必须替换这批素材**；本项目仅作本机、个人、非商业原型。

