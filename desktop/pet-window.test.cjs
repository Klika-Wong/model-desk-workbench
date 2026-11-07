'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const pet = require('./pet-window.cjs');

test('桌宠配置：坏数据不会进窗口构造参数', () => {
  assert.deepEqual(pet.sanitizeState(null), { x: null, y: null, locked: false, alwaysOnTop: true, outfit: null, modelId: null });
  assert.deepEqual(pet.sanitizeState('坏数据'), { x: null, y: null, locked: false, alwaysOnTop: true, outfit: null, modelId: null });
  const weird = pet.sanitizeState({ x: 'NaN', y: Infinity, locked: 'yes', alwaysOnTop: 0 });
  assert.equal(weird.x, null);
  assert.equal(weird.y, null);
  assert.equal(weird.locked, false, '字符串 true 不算锁定');
  assert.equal(weird.alwaysOnTop, true, '只有显式 false 才取消置顶');
});

test('桌宠配置：合法位置、形象与模型要保留并收紧长度', () => {
  const s = pet.sanitizeState({ x: 1200.6, y: 640.2, locked: true, alwaysOnTop: false,
    outfit: 'roster:deepseek-chibi', modelId: 'm-local' });
  assert.equal(s.x, 1201);
  assert.equal(s.y, 640);
  assert.equal(s.locked, true);
  assert.equal(s.alwaysOnTop, false);
  assert.equal(s.outfit, 'roster:deepseek-chibi');
  assert.equal(s.modelId, 'm-local');
  const long = pet.sanitizeState({ outfit: 'x'.repeat(300) });
  assert.equal(long.outfit.length, 80);
});
