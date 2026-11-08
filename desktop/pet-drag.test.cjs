'use strict';

// 用假的 electron 模块跑真实的 pet:control handler，验证拖窗口的方向与手感。
// 这是用户实测发现的 bug：渲染层用 clientX/Y 算增量时，窗口跟着鼠标动会导致反向跑。
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const originalLoad = Module._load;
const handlers = new Map();
const positions = [];
let cursor = { x: 0, y: 0 };
let fakeWindow = null;

class FakeBrowserWindow {
  constructor() { fakeWindow = this; this.destroyed = false; this.webContents = { id: 1 }; }
  isDestroyed() { return this.destroyed; }
  getPosition() { return [500, 500]; }
  setPosition(x, y) { positions.push([x, y]); }
  setAlwaysOnTop() {}
  loadFile() {}
  once() {}
  on() {}
  showInactive() {}
  close() { this.destroyed = true; }
}
const electronMock = {
  BrowserWindow: FakeBrowserWindow,
  ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
  screen: {
    getCursorScreenPoint: () => cursor,
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
  },
};
Module._load = function (request) {
  if (request === 'electron') return electronMock;
  return originalLoad.apply(this, arguments);
};
const pet = require('./pet-window.cjs');
Module._load = originalLoad;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-drag-test-'));
pet.registerPetWindow(dir);
const openReply = handlers.get('pet:open')({ senderFrame: { url: 'file:///app/index.html' } });
const control = (action, value) => handlers.get('pet:control')({ sender: fakeWindow.webContents }, action, value);
const last = () => positions[positions.length - 1];

test('桌宠拖拽：按屏幕绝对坐标移动，方向正确且不累加增量', () => {
  assert.equal(openReply.ok, true);
  cursor = { x: 100, y: 100 };
  control('drag-start');
  cursor = { x: 180, y: 140 };
  control('drag-move');
  assert.deepEqual(last(), [580, 540], '向右下拖，窗口应向右下走（不是反向）');
  cursor = { x: 80, y: 60 };
  control('drag-move');
  assert.deepEqual(last(), [480, 460], '往回拖时按「起点+累计位移」，不应累加旧增量');
  cursor = { x: 180, y: 140 };
  control('drag-move');
  assert.deepEqual(last(), [580, 540], '再来一次仍回到同一位置，不漂移');
  const ended = control('drag-end');
  assert.equal(ended.ok, true);
});

test('桌宠拖拽：锁定后完全不动', () => {
  cursor = { x: 100, y: 100 };
  control('drag-start');
  control('lock', true);
  cursor = { x: 900, y: 700 };
  control('drag-move');
  assert.deepEqual(last(), [580, 540], '锁定后 drag-move 不得移动窗口');
  control('drag-end');
  control('lock', false);
});

test('桌宠窗口：来源校验挡住远程页面与路径拼接', () => {
  const bad = handlers.get('pet:open')({ senderFrame: { url: 'https://evil.example/index.html' } });
  assert.equal(bad.ok, false);
  assert.equal(pet.isTrustedPetUrl('file:///app/index.html.evil'), false);
});
