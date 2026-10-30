'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildHistory, buildChatPrompt } = require('./chat-prompt.js');

test('历史按最近优先裁剪，并如实报告丢弃条数', () => {
  const messages = [
    { role: 'user', text: '第一问：项目叫什么？' },
    { role: 'assistant', text: '叫示例项目 A。' },
    { role: 'user', text: '第二问：下一步是什么？' },
  ];
  const all = buildHistory(messages, 1000);
  assert.equal(all.included, 3);
  assert.equal(all.omitted, 0);
  assert.match(all.text, /^用户：第一问/);

  const tight = buildHistory(messages, 40);
  assert.ok(tight.included < 3, '预算小必须裁掉一些');
  assert.ok(tight.omitted > 0);
  assert.match(tight.text, /第二问/, '最近的一条必须保留');
});

test('空消息与非法角色被跳过，不产生空行', () => {
  const result = buildHistory([
    { role: 'user', text: '   ' },
    { role: 'system', text: '不该出现' },
    { role: 'user', text: '正常一句' },
  ], 1000);
  assert.equal(result.included, 1);
  assert.equal(result.text, '用户：正常一句\n');
});

test('组装顺序：角色 → 记忆 → 此前对话 → 当前问题', () => {
  const built = buildChatPrompt({ history: '用户：上一问\n助手：上一答\n', memory: '【记忆上下文包】标题：目标', question: '现在呢？' });
  assert.equal(built.hasMemory, true);
  assert.equal(built.hasHistory, true);
  const text = built.text;
  assert.ok(text.indexOf('项目助手') < text.indexOf('项目记忆'));
  assert.ok(text.indexOf('项目记忆') < text.indexOf('此前对话'));
  assert.ok(text.indexOf('此前对话') < text.indexOf('当前问题'));
  assert.ok(text.trim().endsWith('现在呢？'));
});

test('没有记忆与历史时不拼空段', () => {
  const built = buildChatPrompt({ question: '只问一句' });
  assert.equal(built.hasMemory, false);
  assert.equal(built.hasHistory, false);
  assert.equal(built.text.includes('项目记忆'), false);
  assert.equal(built.text.includes('此前对话'), false);
  assert.ok(built.text.endsWith('只问一句'));
});

test('空问题直接拒绝，不发半成品', () => {
  assert.throws(() => buildChatPrompt({ question: '   ' }), /不能为空/);
  assert.throws(() => buildChatPrompt({}), /不能为空/);
});
