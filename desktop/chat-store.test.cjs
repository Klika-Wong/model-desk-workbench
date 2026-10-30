'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const store = require('./chat-store.cjs');

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-store-'));
  return path.join(dir, 'chat.json');
}

test('保存后能原样读回来', () => {
  const file = tempFile();
  const messages = [
    { role: 'user', text: '第一句' },
    { role: 'assistant', text: '第二句', meta: '1.2k tokens' },
  ];
  const saved = store.save(file, messages);
  assert.equal(saved.saved, 2);
  const loaded = store.load(file);
  assert.deepEqual(loaded.messages, messages);
  assert.equal(loaded.corrupted, false);
});

test('超长对话从最早丢弃，并报告丢了几条', () => {
  const file = tempFile();
  const many = Array.from({ length: 80 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `第 ${i} 条` }));
  const saved = store.save(file, many);
  assert.equal(saved.saved, store.MAX_MESSAGES);
  assert.equal(saved.dropped, 80 - store.MAX_MESSAGES);
  const loaded = store.load(file);
  assert.equal(loaded.messages.length, store.MAX_MESSAGES);
  assert.match(loaded.messages[loaded.messages.length - 1].text, /第 79 条/, '最新一条必须保留');
});

test('非法条目被丢掉，不会写进文件', () => {
  const file = tempFile();
  store.save(file, [
    { role: 'system', text: '不该保存' },
    { role: 'user', text: '   ' },
    { role: 'user', text: '正常一句' },
    null,
  ]);
  const loaded = store.load(file);
  assert.deepEqual(loaded.messages, [{ role: 'user', text: '正常一句' }]);
});

test('文件不存在返回空对话且不报损坏；内容损坏要标出来', () => {
  const missing = tempFile();
  const none = store.load(missing);
  assert.deepEqual(none.messages, []);
  assert.equal(none.corrupted, false);

  const broken = tempFile();
  fs.mkdirSync(path.dirname(broken), { recursive: true });
  fs.writeFileSync(broken, '{ not json', 'utf8');
  const bad = store.load(broken);
  assert.deepEqual(bad.messages, []);
  assert.equal(bad.corrupted, true, '损坏必须明确标记，不能伪装成空对话');
});

test('清空后文件消失，再读是空对话', () => {
  const file = tempFile();
  store.save(file, [{ role: 'user', text: 'x' }]);
  store.clear(file);
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(store.load(file).messages, []);
});
