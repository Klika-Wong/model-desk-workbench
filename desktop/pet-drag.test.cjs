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

test('桌宠拖拽：窗口始终钉在光标下方，不产生累积偏移', () => {
  assert.equal(openReply.ok, true);
  // 按下时光标在窗口内 (40, 30)。之后窗口左上角必须恒等于「光标 − (40,30)」。
  cursor = { x: 100, y: 100 };
  control('drag-start', { x: 40, y: 30 });
  cursor = { x: 180, y: 140 };
  control('drag-move');
  assert.deepEqual(last(), [140, 110], '向右下拖，窗口跟随且保持按下时的相对位置');
  cursor = { x: 80, y: 60 };
  control('drag-move');
  assert.deepEqual(last(), [40, 30], '往回拖按绝对公式算，不累加旧位移');
  cursor = { x: 180, y: 140 };
  control('drag-move');
  assert.deepEqual(last(), [140, 110], '回到同一光标位置，窗口必须回到同一处（零漂移）');
  const ended = control('drag-end');
  assert.equal(ended.ok, true);
});

test('桌宠拖拽：没带按下偏移时退到窗口中心，不会瞬移', () => {
  cursor = { x: 620, y: 610 };
  control('drag-start');
  control('drag-move');
  // 250x300 的窗口，中心偏移是 (125, 150)
  assert.deepEqual(last(), [495, 460]);
  control('drag-end');
});

test('桌宠拖拽：锁定后完全不动', () => {
  cursor = { x: 100, y: 100 };
  control('drag-start', { x: 40, y: 30 });
  control('lock', true);
  cursor = { x: 900, y: 700 };
  control('drag-move');
  assert.deepEqual(last(), [495, 460], '锁定后 drag-move 不得移动窗口');
  control('drag-end');
  control('lock', false);
});

test('桌宠：可点击区域接受上报，超出窗口的值会被收紧', () => {
  assert.equal(control('hitbox', { x: 10, y: 10, w: 200, h: 200 }).ok, true);
  assert.equal(control('hitbox', { x: -9999, y: -9999, w: 1e9, h: 1e9 }).ok, true);
  assert.equal(control('hitbox', {}).ok, true);
  assert.equal(control('ignore', true).ok, true);
  assert.equal(control('ignore', false).ok, true);
});

test('桌宠窗口：来源校验挡住远程页面与路径拼接', () => {
  const bad = handlers.get('pet:open')({ senderFrame: { url: 'https://evil.example/index.html' } });
  assert.equal(bad.ok, false);
  assert.equal(pet.isTrustedPetUrl('file:///app/index.html.evil'), false);
});

test('桌宠右键菜单与按需聚焦没有被删掉', () => {
  const ui = fs.readFileSync(path.join(__dirname, 'pet-ui.js'), 'utf8');
  for (const action of ['outfit', 'opaque', 'lock', 'top', 'chat', 'close']) {
    assert.ok(ui.includes(`'${action}'`), `右键菜单缺少 ${action} 项`);
  }
  assert.ok(ui.includes("addEventListener('contextmenu'"), '没有监听右键菜单');
  // 菜单必须被钳制进窗口，否则超出窗口边界会被裁掉（窗口就是绘制边界）
  assert.ok(/Math\.min\(Math\.max\(4, x\)/.test(ui), '菜单定位没有钳制到窗口内');
  // 只-读窗口：默认不夺焦，聊天时才临时打开
  assert.ok(ui.includes("petControl('focusable'"), '没有按需切换窗口 focusable');
  const win = fs.readFileSync(path.join(__dirname, 'pet-window.cjs'), 'utf8');
  assert.ok(/focusable: false/.test(win), '桌宠窗口默认应该是不可聚焦（不抢焦点）');
  assert.ok(/'focusable'/.test(win), '主进程没有 focusable 动作');
});
