'use strict';

// 用假的 electron.screen 真跑 pet:open 与显示器事件，验证多屏位置记忆链路。
// 这里不 mock 几何函数：走的是 pet-window.cjs 里真实的 create()/rescueIfOffscreen()。
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const originalLoad = Module._load;
const handlers = new Map();
const listeners = new Map();
const positions = [];
const PRIMARY = { workArea: { x: 0, y: 0, width: 1920, height: 1032 } };
const RIGHT = { workArea: { x: 1920, y: 0, width: 1600, height: 900 } };
let displays = [PRIMARY, RIGHT];
let fakeWindow = null;

class FakeBrowserWindow {
  constructor(options) {
    fakeWindow = this;
    this.options = options;
    this.pos = [options.x, options.y];
    this.webContents = { id: 1 };
    this.destroyed = false;
    this.shown = false;
  }
  isDestroyed() { return this.destroyed; }
  getPosition() { return this.pos.slice(); }
  setPosition(x, y) { this.pos = [x, y]; positions.push([x, y]); }
  setAlwaysOnTop() {}
  setIgnoreMouseEvents() {}
  setFocusable() {}
  focus() {}
  loadFile() {}
  once() {}
  on() {}
  showInactive() { this.shown = true; }
  hide() { this.shown = false; }
  close() { this.destroyed = true; }
}
const electronMock = {
  BrowserWindow: FakeBrowserWindow,
  ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
  screen: {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getPrimaryDisplay: () => PRIMARY,
    getAllDisplays: () => displays,
    on: (name, fn) => {
      const list = listeners.get(name) || [];
      list.push(fn);
      listeners.set(name, list);
    },
  },
};

// 每个场景重新加载模块，避免上层配置 / 窗口状态互相污染。
function freshPet(config, initialDisplays) {
  displays = initialDisplays;
  listeners.clear();
  handlers.clear();
  positions.length = 0;
  fakeWindow = null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-display-'));
  fs.writeFileSync(path.join(dir, 'pet-window.json'), JSON.stringify(config));
  delete require.cache[require.resolve('./pet-window.cjs')];
  Module._load = function (request) {
    if (request === 'electron') return electronMock;
    return originalLoad.apply(this, arguments);
  };
  const pet = require('./pet-window.cjs');
  Module._load = originalLoad;
  const ctl = pet.registerPetWindow(dir);
  handlers.get('pet:open')({ senderFrame: { url: 'file:///app/index.html' } });
  return {
    pet, ctl,
    saved: () => JSON.parse(fs.readFileSync(path.join(dir, 'pet-window.json'), 'utf8')),
  };
}

const emit = (name) => { for (const fn of listeners.get(name) || []) fn(); };

test('拖到副屏后重启：位置原样保留，不再被拉回主屏', () => {
  const { ctl } = freshPet({ x: 2100, y: 300 }, [PRIMARY, RIGHT]);
  assert.deepEqual(fakeWindow.pos, [2100, 300], 'create() 不该改动副屏上的合法位置');
  assert.equal(positions.length, 0, '一次都不该 setPosition');
  assert.equal(ctl.snapshot().displays, 2, '诊断快照要能看到几块屏');
});

test('启动时副屏已经不在：按最小平移夹回主屏并落盘', () => {
  const { saved } = freshPet({ x: 2100, y: 300 }, [PRIMARY]);
  assert.deepEqual(fakeWindow.pos, [1670, 300], '只横向拉回主屏右缘，纵向保持');
  assert.equal(saved().x, 1670, '救援结果要落盘，否则每次启动都要再救一次');
  assert.equal(saved().y, 300);
});

test('运行中拔掉显示器：事件把桌宠拉回可见位置，重复事件不来回搬', () => {
  const { saved } = freshPet({ x: 2100, y: 300 }, [PRIMARY, RIGHT]);
  displays = [PRIMARY];
  emit('display-removed');
  assert.deepEqual(fakeWindow.pos, [1670, 300]);
  assert.equal(saved().x, 1670);
  const count = positions.length;
  emit('display-metrics-changed');
  assert.equal(positions.length, count, '已经可见时不做无谓的窗口移动');
});

test('托盘隐藏期间的救援不会把桌宠弹出来', () => {
  const { ctl } = freshPet({ x: 2100, y: 300 }, [PRIMARY, RIGHT]);
  ctl.hide();
  assert.equal(fakeWindow.shown, false);
  fakeWindow.setPosition(3000, 300);
  displays = [PRIMARY];
  emit('display-added');
  assert.deepEqual(fakeWindow.pos, [1670, 300]);
  assert.equal(fakeWindow.shown, false, '救援只挪位置，不能顺手 show');
});

test('三种显示器变化都要挂上监听，且只挂一次', () => {
  const { pet } = freshPet({ x: 100, y: 100 }, [PRIMARY]);
  assert.deepEqual([...listeners.keys()].sort(), [...pet.DISPLAY_EVENTS].sort());
  for (const name of pet.DISPLAY_EVENTS) {
    assert.equal(listeners.get(name).length, 1, `${name} 重复绑定会累积救援调用`);
  }
});
