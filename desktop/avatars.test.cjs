'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const avatars = require('./avatars.js');
const model = (over) => Object.assign({ id: 'x1', name: '', provider: 'custom' }, over);
const exists = (file) => fs.existsSync(path.join(__dirname, file));

test('认品牌：名字或 provider 里出现品牌就认得出', () => {
  assert.equal(avatars.keyOf(model({ name: 'DeepSeek-V3' })), 'deepseek');
  assert.equal(avatars.keyOf(model({ name: '本地 DeepSeek-R1 7B' })), 'deepseek');
  assert.equal(avatars.keyOf(model({ name: 'gpt-4o' })), 'openai');
  assert.equal(avatars.keyOf(model({ name: 'Codex CLI' })), 'openai');
  assert.equal(avatars.keyOf(model({ name: 'Claude Sonnet 4.5' })), 'claude');
  assert.equal(avatars.keyOf(model({ name: 'o3-mini' })), 'openai');
  assert.equal(avatars.keyOf(model({ name: '通义千问 Max' })), 'qwen');
  assert.equal(avatars.keyOf(model({ name: '腾讯混元 (hy3)' })), 'hunyuan');
  assert.equal(avatars.keyOf(model({ provider: 'deepseek' })), 'deepseek');
});

test('先特指再泛指，ollama 不能被 llama 抢走', () => {
  assert.equal(avatars.keyOf(model({ name: 'ollama qwen2.5' })), 'qwen');
  assert.equal(avatars.keyOf(model({ name: 'Ollama 本地推理' })), 'ollama');
  assert.equal(avatars.keyOf(model({ name: 'Llama 3.1 405B' })), 'meta');
  assert.equal(avatars.keyOf(null), '');
});

test('每个模型至少两个专属形象，认不出品牌也有', () => {
  const samples = [
    model({ name: 'DeepSeek-V3' }), model({ name: 'WorkBuddy · Step-5-Preview' }),
    model({ name: 'Claude Sonnet' }), model({ name: 'gpt-4o' }),
    model({ name: '本地示例模型' }), model({ id: '5b0f8b9318c0' }),
  ];
  for (const m of samples) {
    const own = avatars.choicesFor(m).filter((c) => c.own);
    assert.ok(own.length >= 2, `${m.name || m.id} 只有 ${own.length} 个专属形象`);
    assert.ok(own.every((c) => c.thumb && exists(c.thumb)), `${m.name} 的缩略图缺失`);
    assert.equal(new Set(own.map((c) => c.value)).size, own.length, '专属形象不能重复');
  }
});

test('默认形象是该品牌的第一版，且素材真实存在', () => {
  for (const [key, group] of Object.entries(avatars.ROSTER)) {
    const m = model({ name: group.label });
    const choice = avatars.defaultChoice(m);
    const hit = avatars.resolve(m, choice);
    assert.equal(hit.kind, 'roster', `${key} 默认不是角色`);
    assert.ok(exists(hit.sheet), `${key} 的序列帧缺失：${hit.sheet}`);
    assert.ok(exists(hit.thumb), `${key} 的缩略图缺失：${hit.thumb}`);
  }
  assert.equal(avatars.defaultChoice(model({ name: 'DeepSeek-V3' })), 'roster:deepseek-chibi');
});

test('30 个角色的序列帧与缩略图都在', () => {
  let count = 0;
  for (const group of Object.values(avatars.ROSTER)) {
    for (const id of group.ids) {
      assert.ok(exists(avatars.R + id + '.webp'), `${id}.webp 缺失`);
      assert.ok(exists(avatars.R + id + '.gif'), `${id}.gif 缺失`);
      count += 1;
    }
  }
  assert.equal(count, 30);
});

test('解析形象：脏数据退回默认，roster id 不接受路径穿越', () => {
  const m = model({ name: 'DeepSeek-V3' });
  assert.equal(avatars.resolve(m, 'roster:deepseek-chibi').kind, 'roster');
  assert.equal(avatars.resolve(m, 'roster:../../etc/passwd').kind, 'roster', '非法 id 要退回默认');
  assert.equal(avatars.resolve(m, '乱写的值').kind, 'roster');
  assert.equal(avatars.resolve(m, avatars.CHARACTER_ID).kind, 'character');
  assert.equal(avatars.resolve(m, 'emoji:🦊').emoji, '🦊');
  assert.equal(avatars.resolve(model({ name: '本地示例模型' }), 'brand').kind, 'roster', '认不出品牌不给品牌币');
});

test('状态到动作行：九种动作映射正确，场景只覆盖视觉', () => {
  assert.equal(avatars.actionRow('roster:deepseek-chibi', 'waiting', 'discuss'), avatars.ACTIONS.idle);
  assert.equal(avatars.actionRow('roster:deepseek-chibi', 'thinking', 'discuss'), avatars.ACTIONS.work);
  assert.equal(avatars.actionRow('roster:deepseek-chibi', 'speaking', 'discuss'), avatars.ACTIONS.work);
  assert.equal(avatars.actionRow('roster:deepseek-chibi', 'done', 'discuss'), avatars.ACTIONS.wave);
  assert.equal(avatars.actionRow('roster:deepseek-chibi', 'poke', 'discuss'), avatars.ACTIONS.jump);
  assert.equal(avatars.actionRow('roster:deepseek-chibi', 'failed', 'discuss'), avatars.ACTIONS.fail);
  assert.equal(avatars.actionRow('roster:deepseek-chibi', 'speaking', 'work'), avatars.ACTIONS.work, '工作场景');
  assert.equal(avatars.actionRow('roster:deepseek-chibi', 'speaking', 'slack'), avatars.ACTIONS.idle, '摸鱼场景');
  assert.equal(avatars.actionRow('roster:deepseek-chibi', '不存在的状态', 'discuss'), avatars.ACTIONS.idle);
});

test('旧形象与品牌币仍有对应素材', () => {
  for (const [role, def] of Object.entries(avatars.CHARACTERS)) {
    for (const state of ['waiting', 'thinking', 'speaking', 'done', 'failed', 'stalled', 'poke', 'drag']) {
      assert.ok(exists(def[state]), `${role}.${state} 素材缺失：${def[state]}`);
    }
  }
  for (const [key, brand] of Object.entries(avatars.BRANDS)) {
    assert.ok(exists(brand.file), `${key} 素材缺失：${brand.file}`);
    assert.match(brand.color, /^#[0-9A-Fa-f]{6}$/);
  }
});

test('同一个模型形象与色相稳定，不同模型不撞色', () => {
  const a = model({ id: 'm-local' }), b = model({ id: 'm-cloud' });
  assert.equal(avatars.defaultChoice(a), avatars.defaultChoice(a));
  assert.notEqual(avatars.hueOf(a), avatars.hueOf(b));
});
