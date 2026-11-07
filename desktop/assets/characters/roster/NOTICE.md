# 第三方素材授权说明（assets/characters/roster）

30 个模型主题的手绘 Q 版角色（15 个模型 × 标准版 / Q 版），来自 GitHub，不是本项目原创。

## 来源

- 仓库：**savanna0425/llm-pet** — https://github.com/savanna0425/llm-pet
- 取用日期：2026-11-07
- 形象原创作者：B 站 UP 主 **ZipZipPipe**（https://space.bilibili.com/4168597）
- 原作品说明：https://www.pixiv.net/artworks/148186519
- DeepSeek 形象另基于创作者 **上善** 的鲸鱼角色设定二创
- 仓库 `NOTICE.md` 原文见同目录 `NOTICE-llm-pet.md`

## 使用条件（必须遵守）

1. **署名**：使用、修改、再分享都必须标注作者 ZipZipPipe；用 DeepSeek 相关素材时还要同时标注 **上善**。
2. **仅限非商业用途**。本项目是本机、个人、非商业原型，符合该条件；**商业化前必须全部替换**。
3. **DeepSeek 素材额外遵循 CC BY-NC-SA 4.0**（署名 · 非商业 · 相同方式共享）：
   https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans
   基于它的改编也要用同一协议发布。
4. 这些是**同人形象**，与 OpenAI / Anthropic / DeepSeek / Google / xAI 等公司**没有官方关联**，
   不得暗示官方背书。仓库没有提供覆盖全部素材的统一开源软件许可证。

## 文件说明

| 文件 | 内容 |
| --- | --- |
| `<id>.webp` | 9 种动作 × 8 帧的序列帧，768×936（每帧 96×104），由原始 1536×1872 `spritesheet.webp` 降采样重编码 |
| `<id>.gif` | 官方预览的待机动画，用于形象选择器缩略图（192×208） |
| `roster.json` | 每个形象的显示名与文件对应关系 |
| `NOTICE-llm-pet.md` | 上游仓库的署名与使用条件原文 |

九种动作按行排列（第 0–8 行）：待机、向右移动、向左移动、招手、跳跃、失败、等待、工作、审查。
本项目把状态映射到这些行：待机→0、思考/输出→7（工作）、完成→3（招手）、
被戳→4（跳跃）、被拖→1（移动）、失败→5、状态未明→6（等待）。

## 覆盖的模型

ChatGPT、Claude、DeepSeek、Gemini、Grok、GLM、Kimi、Qwen、Doubao、文心 ERNIE、
MiniMax、腾讯混元、Meta Muse、MiMo、Mistral —— 每个都有 `-chibi` 和 `-standard` 两个形象。

## 替换方式

把对应 `<id>.webp` / `<id>.gif` 换成自有素材即可，或在 `avatars.js` 的 `ROSTER` 里改映射。
替换后可删除本文件中关于 ZipZipPipe / 上善 的署名段落。
