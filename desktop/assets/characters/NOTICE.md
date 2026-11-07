# 第三方素材授权说明（assets/characters）

这里的形象**不是本项目画的**，是从 GitHub 上找来的开源桌宠素材，按 MIT 协议取用并做了压缩。
使用前请读完本文件。

## 来源

- 仓库：**Ice-teapop/desktop-pet** — https://github.com/Ice-teapop/desktop-pet
- 版本：2026-11-07 从 `main` 分支取回
- 作者：han（https://github.com/Ice-teapop）
- 许可：**MIT**，全文见同目录 `LICENSE-deskpet`（Copyright (c) 2026 han）
- 取用的两个主题：
  - `themes/deskpet-furina/`：Q 版拟人少女，作者原创重画的 SMIL 序列帧 sprite
  - `themes/deskpet-cc/`：像素螃蟹 mascot，作者声明为原创（致敬 Claude Code 公开形象）

## 重要：角色形象的权利边界

- MIT 覆盖的是**这些 SVG / sprite 文件本身**，**不覆盖角色 IP**。
- `char-*.svg` 的原型是《原神》芙宁娜（Furina）的同人 Q 版形象。角色权利归原权利方，
  MIT 不能授予角色使用权。本项目是**本机、非商业、个人使用**的原型，不作分发、不商用、不暗示官方背书。
- 仓库作者也明确写了：`Clawd 形象本身未获原作者授权使用`，其主题只参考了动画骨架、sprite 全部独立重画。
  本项目**只取了 CC 螃蟹原创主题，没有取 Clawd 素材**。
- 如果本项目将来要**公开发布或商业化**：必须把 `char-*.svg` 换成自有/CC0 的拟人素材。
  `crab-*.svg` 为作者原创，仍需保留本文件与 `LICENSE-deskpet`。

## 我们对素材做了什么

原始 `deskpet-furina/svg/*.svg` 每张 2–3 MB（内嵌 base64 PNG 序列帧，11100×300，37 帧 pingpong）。
直接放进应用太重，所以做了**格式转换，没有改画**：

1. 从 SVG 里解出内嵌 PNG 序列帧；
2. ffmpeg 降采样一半（5550×150）并编码为 WebP（q=48）；
3. 把 `data:image/png;base64,…` 换成 `data:image/webp;base64,…` 回嵌，
   **SMIL 帧动画原样保留**，<img> 加载即可动。

结果：6 张拟人状态图共约 1.4 MB（原约 13 MB），螃蟹主题 6 张共约 35 KB。

## 文件与状态对应

| 文件 | 状态 | 用于 |
| --- | --- | --- |
| `char-idle.svg` | 待机呼吸 | `waiting` / `failed` |
| `char-thinking.svg` | 思考 | `thinking` / `stalled` |
| `char-typing.svg` | 打字 | `speaking` |
| `char-happy.svg` | 开心 | `done` |
| `char-poke.svg` | 被戳反应 | 双击形象时 1.7 秒 |
| `char-drag.svg` | 被拖反应 | 拖动过程中 |
| `crab-*.svg` | 同上六态 | Claude 系模型的默认形象 |

另外 `dafeiyu` 用的是 `assets/pets/*.gif`（大肥鱼 / 鲸鱼娘），授权见 `assets/pets/NOTICE.md`：
**CC BY-NC-SA 4.0、非商业、需署名、改编需同协议**，比 MIT 严格得多，商业化时同样必须替换。

## 换素材的方法

1. 把自己有权使用的图按上面六个状态命名，覆盖 `assets/characters/char-*.svg`。
2. 或在 `avatars.js` 的 `CHARACTERS` 表里加一档新角色，把六个状态指到新文件。
3. `node --test avatars.test.cjs` 会逐个检查文件是否存在、颜色值是否合法。
4. 若换掉芙宁娜，可删掉本文件中关于角色 IP 的那一段；`LICENSE-deskpet` 若仍在用螃蟹主题就要保留。
