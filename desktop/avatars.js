(function (global) {
'use strict';

// 形象系统：每个模型有多个可点选的拟人角色，角色自带 9 种动作。
// 纯映射放在这里，协作视图与对话页共用；DOM 渲染也在这一层，避免两处各写一套。

const EMOJIS = ['🐳', '🦊', '🐱', '🐼', '🐸', '🦉', '🐙', '🐹', '🐰', '🐯'];
const BRAND_ID = 'brand';
const CHARACTER_ID = 'character';
const CRAB_ID = 'crab';
const GIF_ID = 'dafeiyu';
const C = 'assets/characters/';
const R = C + 'roster/';

// GitHub: savanna0425/llm-pet，15 个模型 × 标准版/Q 版 = 30 个手绘 Q 版角色。
// 授权见 assets/characters/roster/NOTICE.md：署名 ZipZipPipe（DeepSeek 另署名上善）、仅非商业。
const ROSTER = {
  deepseek: { label: 'DeepSeek · 蓝色大肥鱼', ids: ['deepseek-chibi', 'deepseek-standard'] },
  openai: { label: 'ChatGPT · 银白龙裔', ids: ['chatgpt-chibi', 'chatgpt-standard'] },
  claude: { label: 'Claude · 向日葵', ids: ['claude-chibi', 'claude-standard'] },
  gemini: { label: 'Gemini · 星辰猫耳', ids: ['gemini-chibi', 'gemini-standard'] },
  grok: { label: 'Grok · 星冠双马尾', ids: ['grok-chibi', 'grok-standard'] },
  zhipu: { label: 'GLM', ids: ['glm-chibi', 'glm-standard'] },
  kimi: { label: 'Kimi', ids: ['kimi-chibi', 'kimi-standard'] },
  qwen: { label: 'Qwen · 通义千问', ids: ['qwen-chibi', 'qwen-standard'] },
  doubao: { label: '豆包', ids: ['doubao-chibi', 'doubao-standard'] },
  hunyuan: { label: '腾讯混元', ids: ['hunyuan-chibi', 'hunyuan-standard'] },
  minimax: { label: 'MiniMax', ids: ['minimax-chibi', 'minimax-standard'] },
  mistral: { label: 'Mistral', ids: ['mistral-chibi', 'mistral-standard'] },
  meta: { label: 'Meta Muse', ids: ['metamuse-chibi', 'metamuse-standard'] },
  ollama: { label: 'MiMo', ids: ['mimo-chibi', 'mimo-standard'] },
  spark: { label: '文心 ERNIE', ids: ['ernie-chibi', 'ernie-standard'] },
};

// spritesheet 九行：待机 / 右移 / 左移 / 招手 / 跳跃 / 失败 / 等待 / 工作 / 审查
const ACTIONS = { idle: 0, moveRight: 1, moveLeft: 2, wave: 3, jump: 4, fail: 5, wait: 6, work: 7, review: 8 };
const STATE_ACTION = {
  waiting: 'idle', thinking: 'work', speaking: 'work', done: 'wave',
  failed: 'fail', stalled: 'wait', poke: 'jump', drag: 'moveRight',
  wave: 'wave',
};
const SCENE_ACTION = { discuss: null, work: 'work', slack: 'idle' };

// 本项目早期用的三套形象，保留为额外可选，不再是默认。
const CHARACTERS = {
  character: {
    label: 'Q 版少女',
    waiting: C + 'char-idle.svg', thinking: C + 'char-thinking.svg',
    speaking: C + 'char-typing.svg', done: C + 'char-happy.svg',
    failed: C + 'char-idle.svg', stalled: C + 'char-thinking.svg',
    poke: C + 'char-poke.svg', drag: C + 'char-drag.svg',
    tint: true,
  },
  crab: {
    label: '像素螃蟹',
    waiting: C + 'crab-idle.svg', thinking: C + 'crab-thinking.svg',
    speaking: C + 'crab-typing.svg', done: C + 'crab-happy.svg',
    failed: C + 'crab-idle.svg', stalled: C + 'crab-thinking.svg',
    poke: C + 'crab-wave.svg', drag: C + 'crab-jump.svg',
  },
  dafeiyu: {
    label: '大肥鱼',
    waiting: 'assets/pets/idle.gif', thinking: 'assets/pets/thinking.gif',
    speaking: 'assets/pets/speaking.gif', done: 'assets/pets/idle.gif',
    failed: 'assets/pets/idle.gif', stalled: 'assets/pets/idle.gif',
    poke: 'assets/pets/speaking.gif', drag: 'assets/pets/thinking.gif',
  },
};

const BRANDS = {
  deepseek: { label: 'DeepSeek', file: 'assets/brands/deepseek-color.svg', color: '#4D6BFE', mono: true },
  openai: { label: 'OpenAI', file: 'assets/brands/openai.svg', color: '#10A37F', mono: true },
  claude: { label: 'Claude', file: 'assets/brands/claude-color.svg', color: '#D97757', mono: true },
  gemini: { label: 'Gemini', file: 'assets/brands/gemini-color.svg', color: '#3186FF', mono: false },
  qwen: { label: '通义千问', file: 'assets/brands/qwen-color.svg', color: '#2B45E8', mono: true },
  kimi: { label: 'Kimi', file: 'assets/brands/kimi-color.svg', color: '#1783FF', mono: true },
  zhipu: { label: '智谱 GLM', file: 'assets/brands/zhipu-color.svg', color: '#3859FF', mono: true },
  doubao: { label: '豆包', file: 'assets/brands/doubao-color.svg', color: '#1E37FC', mono: false },
  hunyuan: { label: '腾讯混元', file: 'assets/brands/hunyuan-color.svg', color: '#0055E9', mono: false },
  minimax: { label: 'MiniMax', file: 'assets/brands/minimax-color.svg', color: '#F0405F', mono: false },
  yi: { label: '零一万物', file: 'assets/brands/yi-color.svg', color: '#16C46A', mono: true },
  baichuan: { label: '百川', file: 'assets/brands/baichuan-color.svg', color: '#0E7BFF', mono: false },
  mistral: { label: 'Mistral', file: 'assets/brands/mistral-color.svg', color: '#FA500F', mono: false },
  grok: { label: 'Grok', file: 'assets/brands/grok.svg', color: '#111827', mono: true },
  ollama: { label: 'Ollama', file: 'assets/brands/ollama.svg', color: '#1F2937', mono: true },
  meta: { label: 'Meta Llama', file: 'assets/brands/meta-color.svg', color: '#0082FB', mono: false },
  spark: { label: '讯飞星火', file: 'assets/brands/spark-color.svg', color: '#1652D8', mono: false },
};

const RULES = [
  [/claude|anthropic/, 'claude'],
  [/deepseek|dsh|深度求索|鲸/, 'deepseek'],
  [/codex|chatgpt|openai|gpt|(^|[^a-z])o[1-4]([^0-9]|$)/, 'openai'],
  [/gemini|bard|google|谷歌/, 'gemini'],
  [/qwen|tongyi|通义|千问/, 'qwen'],
  [/kimi|moonshot|月之暗面/, 'kimi'],
  [/glm|zhipu|智谱/, 'zhipu'],
  [/doubao|豆包|volc/, 'doubao'],
  [/hunyuan|混元/, 'hunyuan'],
  [/minimax|abab/, 'minimax'],
  [/baichuan|百川/, 'baichuan'],
  [/yi-|零一万物|01[.\-]?ai/, 'yi'],
  [/mistral|mixtral|codestral/, 'mistral'],
  [/grok|xai|x-ai/, 'grok'],
  [/spark|星火|讯飞/, 'spark'],
  [/ollama/, 'ollama'],
  [/llama|meta-?llama|羊驼/, 'meta'],
];

function haystack(model) {
  if (!model) return '';
  return [model.id, model.name, model.provider, model.providerLabel, model.executorLabel]
    .filter(Boolean).join(' ').toLowerCase();
}

function keyOf(model) {
  const text = haystack(model);
  if (!text) return '';
  for (const [re, key] of RULES) if (re.test(text)) return key;
  return '';
}

function brandOf(model) {
  const key = keyOf(model);
  return key ? Object.assign({ key }, BRANDS[key]) : null;
}

function hashOf(model) {
  const s = String((model && (model.id || model.name)) || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
function hashEmoji(model) { return EMOJIS[hashOf(model) % EMOJIS.length]; }
function hueOf(model) { return hashOf(model) % 360; }

// 每个模型至少两个专属形象：认得出品牌用该品牌的两版；认不出按 id 稳定挑两组。
function rosterFor(model) {
  const key = keyOf(model);
  if (ROSTER[key]) return { label: ROSTER[key].label, ids: ROSTER[key].ids.slice(), own: true };
  const groups = Object.values(ROSTER);
  const h = hashOf(model);
  const a = groups[h % groups.length];
  const b = groups[(h + 7) % groups.length];
  const ids = [a.ids[h % 2], b.ids[(h + 1) % 2]];
  return { label: '通用形象', ids, own: false };
}

function defaultChoice(model) { return 'roster:' + rosterFor(model).ids[0]; }

// 形象选择器的数据：专属两版在前，通用形象在后，全部带缩略图。
function choicesFor(model) {
  const roster = rosterFor(model);
  const list = roster.ids.map((id) => ({
    value: 'roster:' + id,
    label: roster.label + (id.endsWith('-chibi') ? ' · Q 版' : ' · 标准版'),
    thumb: R + id + '.webp',
    own: true,
  }));
  list.push({ value: CHARACTER_ID, label: '通用 · Q 版少女', glyph: '👧', own: false });
  list.push({ value: CRAB_ID, label: '通用 · 像素螃蟹', glyph: '🦀', own: false });
  list.push({ value: GIF_ID, label: '通用 · 大肥鱼', glyph: '🐳', own: false });
  if (keyOf(model)) list.push({ value: BRAND_ID, label: '官方标识', glyph: '◈', own: false });
  for (const e of EMOJIS.slice(0, 4)) list.push({ value: 'emoji:' + e, label: '表情 ' + e, glyph: e, own: false });
  return list;
}

function optionsFor(model) { return choicesFor(model).map((c) => c.value); }

function resolve(model, choice) {
  if (typeof choice === 'string' && choice.indexOf('roster:') === 0) {
    const id = choice.slice(7);
    if (/^[a-z0-9-]+$/.test(id)) {
      return { kind: 'roster', id, sheet: R + id + '.webp', thumb: R + id + '.webp' };
    }
  }
  if (choice === BRAND_ID) {
    const brand = brandOf(model);
    if (brand) return { kind: 'brand', brand };
  }
  if (CHARACTERS[choice]) return { kind: 'character', role: choice, def: CHARACTERS[choice] };
  if (typeof choice === 'string' && choice.indexOf('emoji:') === 0) {
    return { kind: 'emoji', emoji: choice.slice(6) };
  }
  return resolve(model, defaultChoice(model));
}

function stateFile(choice, state) {
  const def = CHARACTERS[choice];
  if (!def) return null;
  return def[state] || def.waiting;
}

// 状态 + 场景 → 动作行。场景只覆盖视觉动作，不改变真实状态。
function actionRow(choice, state, scene) {
  const sceneAction = SCENE_ACTION[scene || 'discuss'];
  const name = sceneAction || STATE_ACTION[state] || 'idle';
  return ACTIONS[name] === undefined ? 0 : ACTIONS[name];
}

function mount(el, model, choice, opts) {
  const options = opts || {};
  const state = options.state || 'waiting';
  const scene = options.scene || 'discuss';
  const hit = resolve(model, choice);
  el.replaceChildren();
  el.classList.toggle('is-brand', hit.kind === 'brand');
  el.classList.toggle('is-character', hit.kind === 'character');
  el.classList.toggle('is-roster', hit.kind === 'roster');
  el.classList.toggle('is-emoji', hit.kind === 'emoji');
  el.style.removeProperty('--brand');
  el.style.removeProperty('--brand-logo');
  el.style.removeProperty('--avatar-hue');
  el.style.removeProperty('--char-hue');
  el.dataset.avatarChoice = hit.kind === 'roster' ? 'roster:' + hit.id : (hit.kind === 'character' ? hit.role : hit.kind);
  el.dataset.avatarState = state;
  if (hit.kind === 'roster') {
    // 外层是固定大小的「取景窗」，内层 strip 才是整行序列帧。
    // 帧推进用 transform（合成器），不再用 background-position（每帧 paint）。
    const sprite = document.createElement('div');
    sprite.className = 'pet-sprite';
    sprite.dataset.sprite = '1';
    sprite.style.setProperty('--pet-row', String(actionRow(choice, state, scene)));
    sprite.style.setProperty('--pet-flip', options.facing === 'left' ? '-1' : '1');
    const strip = document.createElement('div');
    strip.className = 'pet-strip';
    strip.dataset.strip = '1';
    strip.style.setProperty('--pet-sheet', `url("${hit.sheet}")`);
    sprite.append(strip);
    el.append(sprite);
    el.title = '点形象可选中、双击戳一下、拖动换位';
    return 'roster';
  }
  if (hit.kind === 'brand') {
    const coin = document.createElement('span');
    coin.className = 'brand-coin';
    el.style.setProperty('--brand', hit.brand.color);
    el.style.setProperty('--brand-logo', `url("${hit.brand.file}")`);
    coin.title = `${hit.brand.label} 官方标识（lobe-icons · MIT）`;
    const glyph = document.createElement('span');
    glyph.className = 'brand-glyph ' + (hit.brand.mono ? 'is-mono' : 'is-color');
    coin.append(glyph);
    el.append(coin);
    el.title = hit.brand.label + ' 标识';
    return 'brand';
  }
  if (hit.kind === 'character') {
    const img = document.createElement('img');
    img.className = options.imgClass || 'avatar-figure';
    img.dataset.avatar = '1';
    img.src = stateFile(hit.role, state);
    img.alt = '';
    img.onerror = () => { img.remove(); el.textContent = hashEmoji(model); };
    if (hit.def.tint) el.style.setProperty('--char-hue', hueOf(model) + 'deg');
    el.append(img);
    el.title = hit.def.label;
    return hit.role;
  }
  el.textContent = hit.emoji;
  el.style.setProperty('--avatar-hue', String(hueOf(model)));
  el.title = '表情 ' + hit.emoji;
  return 'emoji';
}

// 状态变化时只改 CSS 变量，不重建节点——spritesheet 动画不会跳回第一帧。
function updateState(el, choice, state, scene, facing) {
  if (!el) return;
  el.dataset.avatarState = state;
  const sprite = el.querySelector('[data-sprite]');
  if (sprite) {
    const row = String(actionRow(choice, state, scene));
    if (sprite.style.getPropertyValue('--pet-row') !== row) sprite.style.setProperty('--pet-row', row);
    if (facing) {
      const flip = facing === 'left' ? '-1' : '1';
      if (sprite.style.getPropertyValue('--pet-flip') !== flip) sprite.style.setProperty('--pet-flip', flip);
    }
    return;
  }
  const img = el.querySelector('img[data-avatar]');
  if (img) {
    const next = stateFile(el.dataset.avatarChoice, state);
    if (next && img.getAttribute('src') !== next) img.src = next;
  }
}

const api = {
  BRAND_ID, CHARACTER_ID, CRAB_ID, GIF_ID, EMOJIS, CHARACTERS, BRANDS, ROSTER,
  ACTIONS, STATE_ACTION, SCENE_ACTION, R,
  keyOf, brandOf, optionsFor, choicesFor, rosterFor, defaultChoice, resolve,
  stateFile, actionRow, hashEmoji, hueOf, mount, updateState,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
global.__avatars = api;
})(typeof window !== 'undefined' ? window : globalThis);
