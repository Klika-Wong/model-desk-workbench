'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openMemoryStores } = require('./memory-bootstrap.cjs');

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mem-bootstrap-'));
}

test('干净文件：两个存储都能正常打开且无错误', () => {
  const file = path.join(workspace(), 'memory.json');
  const { memoryStore, architectureStore, error } = openMemoryStores(file);
  assert.ok(memoryStore, 'memoryStore 应为实例');
  assert.ok(architectureStore, 'architectureStore 应为实例');
  assert.equal(error, '');
  assert.equal(memoryStore.snapshot().spaces.length, 3);
});

test('记忆文件损坏：降级为 null、报告错误、原文件字节不变', () => {
  const file = path.join(workspace(), 'memory.json');
  const corrupt = '{ "revision": 0, "spaces": [ 这一行不是合法 JSON';
  fs.writeFileSync(file, corrupt, 'utf8');

  const { memoryStore, error } = openMemoryStores(file);
  assert.equal(memoryStore, null, '损坏时绝不能返回半可用实例');
  assert.match(error, /记忆数据不可用/);
  assert.match(error, /只读降级/);
  assert.equal(fs.readFileSync(file, 'utf8'), corrupt, '损坏文件不能被覆盖或重置');
});

test('架构文件损坏：记忆仍可用，架构降级为 null 并报告错误', () => {
  const file = path.join(workspace(), 'memory.json');
  openMemoryStores(file); // 先写出一份有效记忆文件
  fs.writeFileSync(`${file}.architecture.json`, 'not json at all', 'utf8');

  const { memoryStore, architectureStore, error } = openMemoryStores(file);
  assert.ok(memoryStore, '记忆文件有效，应正常打开');
  assert.equal(architectureStore, null, '架构文件损坏应降级');
  assert.match(error, /架构数据不可用/);
  assert.equal(fs.readFileSync(`${file}.architecture.json`, 'utf8'), 'not json at all');
});

test('记忆文件结构无效（非损坏 JSON）：同样降级且不覆盖', () => {
  const file = path.join(workspace(), 'memory.json');
  const wrongShape = JSON.stringify({ revision: 0, spaces: [] }); // spaces 不能为空
  fs.writeFileSync(file, wrongShape, 'utf8');

  const { memoryStore, error } = openMemoryStores(file);
  assert.equal(memoryStore, null);
  assert.match(error, /记忆数据不可用/);
  assert.equal(fs.readFileSync(file, 'utf8'), wrongShape);
});
