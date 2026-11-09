/* 桌宠动作状态机单测：可控时钟，不依赖 Electron / DOM。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { create, HOLD } = require('./pet-motion.js');

function rig(opts) {
  let t = 0;
  const motion = create(Object.assign({ now: () => t }, opts));
  return { motion, advance: (ms) => { t += ms; } };
}

test('初始是待机、面朝右', () => {
  const { motion } = rig();
  assert.deepEqual(motion.tick(), { row: 'idle', facing: 'right' });
});

test('光标移到左边只转身，不把走路动画当成转头', () => {
  const { motion } = rig();
  motion.poke('pointer', { x: 10, centerX: 100 });
  assert.deepEqual(motion.tick(), { row: 'idle', facing: 'left' });
  motion.poke('pointer', { x: 190, centerX: 100 });
  assert.equal(motion.tick().facing, 'right');
});

test('中心附近的小抖动不转身', () => {
  const { motion } = rig();
  motion.poke('pointer', { x: 104, centerX: 100 });
  assert.equal(motion.tick().facing, 'right');
});

test('快速划过触发追光，冷却后自动回待机', () => {
  const { motion, advance } = rig();
  motion.poke('pointer', { x: 10, centerX: 100 });
  advance(10);
  motion.poke('pointer', { x: 110, centerX: 100 }); // 10 px/ms
  assert.equal(motion.tick().row, 'jump');
  advance(HOLD.hunt + 1);
  assert.equal(motion.tick().row, 'idle');
});

test('打字切到工作动作，点击能盖掉打字，打字不能盖掉点击', () => {
  const { motion, advance } = rig();
  motion.poke('type');
  assert.equal(motion.tick().row, 'work');
  advance(10);
  motion.poke('tap');
  assert.equal(motion.tick().row, 'wave');
  advance(10);
  motion.poke('type');
  assert.equal(motion.tick().row, 'wave');
  advance(HOLD.tap + 1);
  assert.equal(motion.tick().row, 'idle');
});

test('表情包可指定动作行和时长，到期回落', () => {
  const { motion, advance } = rig();
  motion.poke('emote', { row: 'fail', ms: 2200 });
  assert.equal(motion.tick().row, 'fail');
  advance(2199);
  assert.equal(motion.tick().row, 'fail');
  advance(2);
  assert.equal(motion.tick().row, 'idle');
});

test('拖动期间恒为搬运动作，松开后回待机', () => {
  const { motion, advance } = rig();
  motion.poke('tap');
  motion.poke('drag-start');
  assert.equal(motion.tick().row, 'moveRight');
  advance(5000);
  assert.equal(motion.tick().row, 'moveRight');
  motion.poke('drag-end');
  assert.equal(motion.tick().row, 'idle');
});

test('长时间无输入会打盹，一有输入立刻醒', () => {
  const { motion, advance } = rig({ sleepAfter: 1000 });
  motion.poke('tap');
  advance(HOLD.tap + 1000);
  assert.equal(motion.tick().row, 'wait');
  motion.poke('type');
  assert.equal(motion.tick().row, 'work');
});

test('降低动效时完全静止，恢复后继续按输入切动作', () => {
  const { motion, advance } = rig();
  motion.poke('reduced', true);
  motion.poke('tap');
  advance(100);
  assert.deepEqual(motion.tick(), { row: 'idle', facing: 'right' });
  motion.poke('reduced', false);
  motion.poke('tap');
  assert.equal(motion.tick().row, 'wave');
});

test('快照能读到内部状态，供真机验证使用', () => {
  const { motion } = rig();
  motion.poke('drag-start');
  const s = motion.snapshot();
  assert.equal(s.row, 'moveRight');
  assert.equal(s.dragging, true);
  assert.equal(s.active, null);
});
