'use strict';

/* 用假的 electron 跑真实的 pet:control handler，验证命中链路的三处行为：
 *   1. 重复包围盒不覆盖内部状态（无谓的窗口样式切换是透明窗重组的来源之一）
 *   2. 包围盒真的变了要立刻按上次光标重判，不能等 200ms 兜底轮询
 *   3. 拖动松手当帧还原穿透状态，不留一段「整个矩形都吃鼠标」的窗口期
 * 这里不 mock pet-window.cjs 的任何函数，走的是真实的 handler 与 snapshot()。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const originalLoad = Module._load;
let handlers = new Map();
let fakeWindow = null;
let cursor = { x: 0, y: 0 };
let ignoreCalls = [];

class FakeBrowserWindow {
  constructor(options) {
    fakeWindow = this;
    this.options = options || {};
    this.pos = [options && Number.isFinite(options.x) ? options.x : 100,
      options && Number.isFinite(options.y) ? options.y : 100];
    this.webContents = { id: 1, once() {} };
    this.destroyed = false;
    this.shown = false;
  }
  isDestroyed() { return this.destroyed; }
  getPosition() { return this.pos.slice(); }
  setPosition(x, y) { this.pos = [x, y]; }
  setIgnoreMouseEvents(v) { ignoreCalls.push(v); }
  setAlwaysOnTop() {}
  setFocusable() {}
  focus() {}
  loadFile() {}
  once() {}
  on() {}
  showInactive() { this.shown = true; }
  hide() { this.shown = false; }
  destroy() { this.destroyed = true; }
  close() { this.destroyed = true; }
}

const PRIMARY = { workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
const electronMock = {
  BrowserWindow: FakeBrowserWindow,
  ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
  screen: {
    getCursorScreenPoint: () => cursor,
    getPrimaryDisplay: () => PRIMARY,
    getAllDisplays: () => [PRIMARY],
    on() {},
  },
};

function fresh() {
  handlers = new Map();
  fakeWindow = null;
  cursor = { x: 0, y: 0 };
  ignoreCalls = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-hitbox-'));
  // 固定窗口在 [100,100]：否则 create() 会用 defaultPosition() 落到屏幕右下角，
  // 后面所有「屏幕坐标 → 窗口内坐标」的换算都差着上千像素。
  fs.writeFileSync(path.join(dir, 'pet-window.json'), JSON.stringify({ x: 100, y: 100 }));
  delete require.cache[require.resolve('./pet-window.cjs')];
  Module._load = function (request) {
    if (request === 'electron') return electronMock;
    return originalLoad.apply(this, arguments);
  };
  const pet = require('./pet-window.cjs');
  Module._load = originalLoad;
  const ctl = pet.registerPetWindow(dir);
  const opened = handlers.get('pet:open')({ senderFrame: { url: 'file:///app/index.html' } });
  assert.equal(opened.ok, true);
  return {
    pet, ctl,
    control: (action, value) => handlers.get('pet:control')({ sender: fakeWindow.webContents }, action, value),
    snap: () => ctl.snapshot(),
    setCursor: (x, y) => { cursor = { x, y }; },
    ignoreCalls: () => ignoreCalls.slice(),
  };
}

test('重复包围盒：主进程不覆盖、不重判、不切窗口样式', () => {
  const h = fresh();
  const box = { x: 20, y: 30, w: 120, h: 140 };
  const first = h.control('hitbox', box);
  assert.equal(first.data.unchanged, false, '第一次要建立包围盒');
  const afterFirst = h.snap();
  assert.equal(afterFirst.diag.hitboxUpdates, 1);

  for (let i = 0; i < 5; i += 1) h.control('hitbox', box);
  // 亚像素抖动也不算变化：去重要能挡住 getBoundingClientRect 的浮点尾数。
  h.control('hitbox', { x: 20.4, y: 30.2, w: 119.7, h: 140.3 });
  const snap = h.snap();
  assert.equal(snap.diag.hitboxUpdates, 1, '重复值不该再算一次边界更新');
  assert.equal(snap.diag.hitboxNoops, 6, '六次重复都要被挡掉并计数');
  assert.equal(snap.diag.ignoreSwitches, afterFirst.diag.ignoreSwitches,
    '重复包围盒绝不能触发 setIgnoreMouseEvents');
  assert.equal(h.ignoreCalls().length, afterFirst.diag.ignoreSwitches);
});

test('包围盒真的变了：用上一次窗口内坐标立刻重判，不等轮询', () => {
  const h = fresh();
  h.control('hitbox', { x: 0, y: 0, w: 200, h: 200 });   // 外扩 6 → 局部 [-6, 206]
  h.setCursor(150, 150);
  h.control('hover', { sx: 150, sy: 150 });              // 窗口 [100,100] → 局部 (50,50)
  assert.equal(h.snap().lastProbe.source, 'renderer');
  assert.equal(h.snap().ignoring, false, '光标在角色区域内应可点');
  const switches = h.snap().diag.ignoreSwitches;

  // 面板收起后包围盒缩到右下角一小块，光标 (50,50) 已不在其中。
  const changed = h.control('hitbox', { x: 180, y: 180, w: 10, h: 10 });
  assert.equal(changed.data.unchanged, false);
  const snap = h.snap();
  assert.equal(snap.diag.hitboxReevaluated, 1, '边界变化要立刻重判一次');
  assert.equal(snap.lastProbe.source, 'hitbox', '重判要留下来历，别伪装成轮询结果');
  assert.equal(snap.ignoring, true, '光标落在新包围盒外，应立刻还原穿透');
  assert.equal(snap.diag.ignoreSwitches, switches + 1, '只允许真实需要的一次窗口样式切换');
});

test('拖动松手：带最终坐标时当帧还原穿透，不留 200ms 全拦截窗口期', () => {
  const h = fresh();
  h.control('hitbox', { x: 180, y: 180, w: 10, h: 10 });  // 局部 [174,196]，左上角远在其外
  h.control('ignore', true);
  const beforeStart = h.snap().diag.ignoreSwitches;

  h.control('drag-start', { x: 2, y: 2 });
  assert.equal(h.snap().ignoring, false, '拖动中必须整窗可点，否则接不住 pointermove');
  assert.equal(h.snap().diag.ignoreSwitches, beforeStart + 1);

  const ended = h.control('drag-end', { sx: 102, sy: 102 }); // 窗口被定位到 [100,100]
  assert.equal(ended.ok, true);
  const snap = h.snap();
  assert.equal(snap.dragOffset, null);
  assert.equal(snap.lastProbe.source, 'drag-end', '松手当帧就要判定，不是留给兜底轮询');
  assert.equal(snap.ignoring, true, '光标在角色外，松手后立刻穿透到下层窗口');
  assert.equal(snap.diag.ignoreSwitches, beforeStart + 2, '只多一次真实的还原切换');
  assert.ok(snap.diag.ignoreReasons.includes('drag-start') && snap.diag.ignoreReasons.includes('drag-end'),
    '切换原因要留下历史，真机断言不能被 200ms 轮询覆盖掉');
});

test('拖动松手：没带坐标时退回全局光标采样，仍然当帧判定', () => {
  const h = fresh();
  h.control('hitbox', { x: 180, y: 180, w: 10, h: 10 });
  h.control('ignore', true);
  h.control('drag-start', { x: 2, y: 2 });
  h.setCursor(102, 102);
  h.control('drag-end');
  const snap = h.snap();
  assert.equal(snap.lastProbe.source, 'drag-end');
  assert.equal(snap.ignoring, true);
  assert.equal(snap.diag.hitboxReevaluated, 0, '没有改包围盒就不该走边界重判分支');
});

test('边缘抖动：滞回内不增加窗口样式切换次数', () => {
  const h = fresh();
  h.control('hitbox', { x: 10, y: 10, w: 100, h: 100 });  // 外扩 6 → 局部 [4, 116]
  h.control('ignore', true);
  const base = h.snap().diag.ignoreSwitches;
  // 穿透态用内缩 8px：屏幕上 [112, 208] 之内都不算真正进来了。
  for (const x of [106, 108, 110, 109, 107]) h.control('hover', { sx: x, sy: 150 });
  assert.equal(h.snap().diag.ignoreSwitches, base, '擦边抖动一次都不该切窗口样式');
  h.control('hover', { sx: 150, sy: 150 });
  assert.equal(h.snap().diag.ignoreSwitches, base + 1, '真正进入只切一次');
  // 可点态用外扩 8px：屏幕上 [96, 224] 内仍算在里面。
  for (const x of [220, 222, 218, 224]) h.control('hover', { sx: x, sy: 150 });
  assert.equal(h.snap().diag.ignoreSwitches, base + 1, '轻微移出也不该反复切');
  h.control('hover', { sx: 230, sy: 150 });
  assert.equal(h.snap().diag.ignoreSwitches, base + 2, '确实离开才允许穿透');
});

test('接线：渲染层差分上报与主进程去重都还在', () => {
  const ui = fs.readFileSync(path.join(__dirname, 'pet-ui.js'), 'utf8');
  const win = fs.readFileSync(path.join(__dirname, 'pet-window.cjs'), 'utf8');
  for (const needle of ['function sameBox(', 'hitboxStats.skipped', 'window.__petHitboxStats', 'lastHitbox = null']) {
    assert.ok(ui.includes(needle), `渲染层缺少 ${needle}`);
  }
  for (const needle of ['function sameHitbox(', 'function refreshIgnoreAfterHitboxChange(',
    "'drag-end'", 'ignoreReasons', 'diag: Object.assign({}, diag)', 'HITBOX_EPSILON']) {
    assert.ok(win.includes(needle), `主进程缺少 ${needle}`);
  }
  // 差分不能把真实几何变化也吃掉：包围盒不同就要发出去。
  assert.ok(/if \(sameBox\(lastHitbox, box\)\)/.test(ui));
  assert.ok(/hitboxStats\.sent \+= 1/.test(ui));
});
