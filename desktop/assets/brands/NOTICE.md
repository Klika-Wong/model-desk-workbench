# 第三方素材授权说明（assets/brands）

本目录是各 AI 模型的**官方标识（品牌 logo）**，不是本项目原创，使用前请读以下条款。

## 来源

- 项目：**Lobe Icons** — https://github.com/lobehub/lobe-icons
- 包名：`@lobehub/icons-static-svg`（静态 SVG，无依赖）
- 取用版本：1.102.0（2026-11 取回）
- 图标站：https://icons.lobehub.com

## 授权

- **代码与 SVG 文件：MIT**（见同目录 `LICENSE`，版权 2023 LobeHub）
- **商标：标识本身仍是各品牌的商标**，MIT 不授予商标权。
  本项目只在"指代该模型"的语境下使用（模型选择、模型舞台形象），
  不做改写、不做暗示官方背书的二次使用。

## 使用约束

1. 保留同目录 `LICENSE`（MIT 要求随分发保留版权与许可声明）。
2. 不要把这些标识用作本项目自己的图标或品牌。
3. 若某品牌方要求下架，删除对应 SVG 即可：认不出品牌的模型会自动退回 emoji 形象（见 `avatars.js` 的兜底逻辑）。

## 文件与品牌的对应

| 文件 | 品牌 |
| --- | --- |
| `deepseek-color.svg` | DeepSeek |
| `openai.svg` | OpenAI / GPT / Codex |
| `claude-color.svg` | Claude / Anthropic |
| `gemini-color.svg` | Google Gemini |
| `qwen-color.svg` | 通义千问 |
| `kimi-color.svg` | Kimi / Moonshot |
| `zhipu-color.svg` | 智谱 GLM |
| `doubao-color.svg` | 豆包 |
| `hunyuan-color.svg` | 腾讯混元 |
| `minimax-color.svg` | MiniMax |
| `yi-color.svg` | 零一万物 |
| `baichuan-color.svg` | 百川 |
| `mistral-color.svg` | Mistral |
| `grok.svg` | xAI Grok |
| `ollama.svg` | Ollama |
| `meta-color.svg` | Meta Llama |
| `spark-color.svg` | 讯飞星火 |

## 新增品牌的步骤

1. 从 `https://unpkg.com/@lobehub/icons-static-svg@latest/icons/<name>.svg` 下载到本目录。
2. 在 `avatars.js` 的 `BRANDS` 里加一行：`file`、`color`（品牌主色）、`mono`（单色标 `true`，多色标 `false`）。
3. 在 `RULES` 里加识别规则；注意顺序，**先特指后泛指**。
4. `node --test avatars.test.cjs` 会检查文件是否存在、颜色格式是否合法。
