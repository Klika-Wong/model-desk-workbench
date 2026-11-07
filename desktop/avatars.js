(function (global) {
'use strict';

// 形象系统：每个模型一个会动、能点、能拖的拟人角色。
// 默认一律给拟人形象；品牌币只作为可切换的一档保留。
// 纯映射放在这里，协作视图与对话页共用，避免各写一套。

const EMOJIS = ['🐳', '🦊', '🐱', '🐼', '🐸', '🦉', '🐙', '🐹', '🐰', '🐯'];
const BRAND_ID = 'brand';
const CHARACTER_ID = 'character';
const CRAB_ID = 'crab';
const GIF_ID = 'dafeiyu';
const C = 'assets/characters/';

// 每个角色都有「待机 / 思考 / 说话 / 完成 / 被戳 / 被拖」六种状态，
// 状态切换 = 换一张自带动效的图，不靠 CSS 假装它在动。
const CHARACTERS = {
  character: {
    label: '拟人少女',
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

// 品牌币：白币托底 + 品牌色标识，两种主题都读得清。
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
// 同一个模型永远同一个色相；几个拟人形象同屏时不撞脸。
function hueOf(model) { return hashOf(model) % 360; }

// 默认形象：DeepSeek 用大肥鱼（它的社区拟人形象），Claude 用像素螃蟹，
// 其余一律拟人少女（按模型 id 换发色）。不再默认发 emoji 或 logo。
function defaultChoice(model) {
  const key = keyOf(model);
  if (key === 'deepseek') return GIF_ID;
  if (key === 'claude') return CRAB_ID;
  return CHARACTER_ID;
}

function optionsFor(model) {
  const list = [CHARACTER_ID, CRAB_ID, GIF_ID];
  if (keyOf(model)) list.push(BRAND_ID);
  for (const e of EMOJIS) list.push('emoji:' + e);
  return list;
}

function resolve(model, choice) {
  if (choice === BRAND_ID) {
    const brand = brandOf(model);
    if (brand) return { kind: 'brand', brand };
  }
  if (CHARACTERS[choice]) return { kind: 'character', role: choice, def: CHARACTERS[choice] };
  if (typeof choice === 'string' && choice.indexOf('emoji:') === 0) {
    return { kind: 'emoji', emoji: choice.slice(6) };
  }
  // 存的旧值失效（例如改了模型名）：退回拟人少女，不渲染空白。
  return { kind: 'character', role: CHARACTER_ID, def: CHARACTERS[CHARACTER_ID] };
}

// 状态 → 图。认不得的状态一律回待机，不显示破图。
function stateFile(choice, state) {
  const def = CHARACTERS[choice];
  if (!def) return null;
  return def[state] || def.waiting;
}

function mount(el, model, choice, opts) {
  const options = opts || {};
  const state = options.state || 'waiting';
  const hit = resolve(model, choice);
  el.replaceChildren();
  el.classList.toggle('is-brand', hit.kind === 'brand');
  el.classList.toggle('is-character', hit.kind === 'character');
  el.classList.toggle('is-emoji', hit.kind === 'emoji');
  el.style.removeProperty('--brand');
  el.style.removeProperty('--brand-logo');
  el.style.removeProperty('--avatar-hue');
  el.style.removeProperty('--char-hue');
  el.dataset.avatarChoice = hit.kind === 'character' ? hit.role : hit.kind;
  el.dataset.avatarState = state;
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
    el.title = hit.def.label + ' · 双击有反应、可拖动';
    return hit.role;
  }
  el.textContent = hit.emoji;
  el.style.setProperty('--avatar-hue', String(hueOf(model)));
  el.title = '点击切换形象（当前：' + hit.emoji + '）';
  return 'emoji';
}

const api = {
  BRAND_ID, CHARACTER_ID, CRAB_ID, GIF_ID, EMOJIS, CHARACTERS, BRANDS,
  keyOf, brandOf, optionsFor, defaultChoice, resolve, stateFile,
  hashEmoji, hueOf, mount,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
global.__avatars = api;
})(typeof window !== 'undefined' ? window : globalThis);
