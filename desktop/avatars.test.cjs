'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const avatars = require('./avatars.js');

const model = (over) => Object.assign({ id: 'x1', name: '', provider: 'custom' }, over);

test('认品牌：名字或 provider 里出现品牌就认得出', () => {
  assert.equal(avatars.keyOf(model({ name: 'DeepSeek-V3' })), 'deepseek');
  assert.equal(avatars.keyOf(model({ name: '本地 DeepSeek-R1 7B' })), 'deepseek', '本地部署的 DeepSeek 仍然是 DeepSeek');
  assert.equal(avatars.keyOf(model({ name: 'gpt-4o' })), 'openai');
  assert.equal(avatars.keyOf(model({ name: 'Codex CLI' })), 'openai');
  assert.equal(avatars.keyOf(model({ name: 'Claude Sonnet 4.5' })), 'claude');
  assert.equal(avatars.keyOf(model({ name: 'o3-mini' })), 'openai');
  assert.equal(avatars.keyOf(model({ name: '通义千问 Max' })), 'qwen');
  assert.equal(avatars.keyOf(model({ name: 'Kimi K2' })), 'kimi');
  assert.equal(avatars.keyOf(model({ name: 'GLM-4.6' })), 'zhipu');
  assert.equal(avatars.keyOf(model({ name: '混元 Turbo' })), 'hunyuan');
  assert.equal(avatars.keyOf(model({ provider: 'deepseek' })), 'deepseek', 'provider 也算线索');
});

test('认品牌：先特指再泛指，ollama 不能被 llama 抢走', () => {
  assert.equal(avatars.keyOf(model({ name: 'ollama qwen2.5' })), 'qwen', '名字里点名了具体模型，优先给具体品牌');
  assert.equal(avatars.keyOf(model({ name: 'Ollama 本地推理' })), 'ollama');
  assert.equal(avatars.keyOf(model({ name: 'Llama 3.1 405B' })), 'meta');
});

test('认不出品牌的模型不硬套品牌，但仍然给拟人形象', () => {
  assert.equal(avatars.keyOf(model({ name: '本地示例模型' })), '');
  assert.equal(avatars.keyOf(model({ name: '', id: '5b0f8b9318c0' })), '');
  assert.equal(avatars.keyOf(null), '');
  assert.equal(avatars.brandOf(model({ name: '本地示例模型' })), null);
  assert.equal(avatars.defaultChoice(model({ name: '本地示例模型' })), avatars.CHARACTER_ID);
});

test('默认形象：DeepSeek 用大肥鱼、Claude 用螃蟹、其余一律拟人少女', () => {
  assert.equal(avatars.defaultChoice(model({ name: 'DeepSeek-V3' })), avatars.GIF_ID);
  assert.equal(avatars.defaultChoice(model({ name: 'Claude Opus' })), avatars.CRAB_ID);
  assert.equal(avatars.defaultChoice(model({ name: 'gpt-4o' })), avatars.CHARACTER_ID);
  assert.equal(avatars.defaultChoice(model({ name: '本地示例模型' })), avatars.CHARACTER_ID);
});

test('形象链：拟人角色排在最前，品牌币只给认得出品牌的模型', () => {
  const withBrand = avatars.optionsFor(model({ name: 'DeepSeek-V3' }));
  assert.equal(withBrand[0], avatars.CHARACTER_ID);
  assert.equal(withBrand[1], avatars.CRAB_ID);
  assert.equal(withBrand[2], avatars.GIF_ID);
  assert.ok(withBrand.includes(avatars.BRAND_ID));
  const noBrand = avatars.optionsFor(model({ name: '本地示例模型' }));
  assert.ok(!noBrand.includes(avatars.BRAND_ID), '认不出品牌就不给品牌位');
});

test('解析形象：旧值或脏数据一律退回拟人少女，不渲染空白', () => {
  const brandModel = model({ name: 'Claude Opus' });
  assert.equal(avatars.resolve(brandModel, avatars.CHARACTER_ID).kind, 'character');
  assert.equal(avatars.resolve(brandModel, avatars.GIF_ID).role, 'dafeiyu');
  assert.equal(avatars.resolve(brandModel, avatars.BRAND_ID).kind, 'brand');
  assert.deepEqual(avatars.resolve(brandModel, 'emoji:🦊'), { kind: 'emoji', emoji: '🦊' });
  assert.equal(avatars.resolve(model({ name: '本地示例模型' }), avatars.BRAND_ID).kind, 'character');
  assert.equal(avatars.resolve(brandModel, '乱写的值').kind, 'character');
});

test('状态到图：每个角色六种状态都有真实素材，未知状态退回待机', () => {
  const states = ['waiting', 'thinking', 'speaking', 'done', 'failed', 'stalled', 'poke', 'drag'];
  for (const [role, def] of Object.entries(avatars.CHARACTERS)) {
    for (const state of states) {
      const file = avatars.stateFile(role, state);
      assert.ok(file, `${role}.${state} 没有映射`);
      assert.ok(fs.existsSync(path.join(__dirname, file)), `${role}.${state} 的素材缺失：${file}`);
    }
    assert.equal(avatars.stateFile(role, '不存在的状态'), def.waiting);
  }
  assert.equal(avatars.stateFile('emoji:🐳', 'thinking'), null, 'emoji 不是角色，没有状态图');
});

test('每个品牌都指向真实存在的素材文件', () => {
  for (const [key, brand] of Object.entries(avatars.BRANDS)) {
    assert.ok(fs.existsSync(path.join(__dirname, brand.file)), `${key} 的素材缺失：${brand.file}`);
    assert.match(brand.color, /^#[0-9A-Fa-f]{6}$/, `${key} 的颜色值不合法`);
  }
});

test('同一个模型色相稳定，不同模型尽量不撞色', () => {
  const a = model({ id: 'm-local' });
  const b = model({ id: 'm-cloud' });
  assert.equal(avatars.hueOf(a), avatars.hueOf(a));
  assert.notEqual(avatars.hueOf(a), avatars.hueOf(b));
});
