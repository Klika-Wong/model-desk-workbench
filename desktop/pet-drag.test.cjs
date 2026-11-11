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
  constructor() { fakeWindow = this; this.destroyed = false; this.pos = [500, 500]; this.webContents = { id: 1 }; }
  isDestroyed() { return this.destroyed; }
  // getPosition 必须反映 setPosition：drag-end 会读它落盘，恒定返回 [500,500] 验不出补定位。
  getPosition() { return this.pos.slice(); }
  setPosition(x, y) { this.pos = [x, y]; positions.push([x, y]); }
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
const petCtl = pet.registerPetWindow(dir);
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
  assert.ok(/Math\.max\(4, left\)/.test(ui) && /Math\.max\(4, top\)/.test(ui), '菜单定位没有钳制到窗口内');
  // 只-读窗口：默认不夺焦，聊天时才临时打开
  assert.ok(ui.includes("petControl('focusable'"), '没有按需切换窗口 focusable');
  const win = fs.readFileSync(path.join(__dirname, 'pet-window.cjs'), 'utf8');
  assert.ok(/focusable: false/.test(win), '桌宠窗口默认应该是不可聚焦（不抢焦点）');
  assert.ok(/'focusable'/.test(win), '主进程没有 focusable 动作');
});

test('桌宠形象面板：列全部开源形象，不再是 5 个循环', () => {
  const ui = fs.readFileSync(path.join(__dirname, 'pet-ui.js'), 'utf8');
  // 必须从 ROSTER 生成，而不是硬编码 5 个 id
  assert.ok(/AVATARS\.ROSTER/.test(ui), '形象列表没有从 ROSTER 读取');
  assert.ok(/flatMap/.test(ui), '形象列表没有展开成扁平数组');
  assert.ok(!/OUTFITS = \['roster:/.test(ui), '还在硬编码 5 个形象');
  assert.ok(ui.includes("id=\"pet-outfits\"") || ui.includes("'pet-outfits'"), '缺少形象面板');
  assert.ok(/data-outfit/.test(ui), '缺少形象项标识');
  assert.ok(/petControl\('outfit'/.test(ui), '选中后没有落盘');
});

test('桌宠拖拽：松手补发最终坐标，窗口不停在倒数第二帧', () => {
  // 模拟「最后一帧 pointermove 被 rAF 合并掉，只来了松手事件」这一真实场景。
  control('drag-start', { x: 40, y: 30 });
  const ended = control('drag-end', { sx: 420, sy: 380 });
  assert.deepEqual(last(), [380, 350], 'drag-end 必须按最终光标补一次定位');
  assert.deepEqual([ended.data.x, ended.data.y], [380, 350], '落盘的也要是最终位置');
});

test('桌宠穿透：进出有滞回，边缘抖动不反复切窗口样式', () => {
  // 把窗口挪到已知位置 [100,100]，再上报一个已知的 hitbox。
  control('drag-start', { x: 0, y: 0 });
  control('drag-end', { sx: 100, sy: 100 });
  control('hitbox', { x: 10, y: 10, w: 100, h: 100 }); // 主进程外扩 6 → 局部 [4,116]
  control('ignore', true);                              // 从「穿透」开始
  const snap = () => petCtl.snapshot();
  // 穿透时用内缩 8px 的边界：屏幕上 [112,208] 才算进来；擦边不算。
  control('hover', { sx: 106, sy: 150 });
  assert.equal(snap().ignoring, true, '刚擦到边不该立刻切回可点');
  control('hover', { sx: 150, sy: 150 });
  assert.equal(snap().ignoring, false, '真正进入角色要立刻解除穿透');
  assert.equal(snap().lastProbe.source, 'renderer', '必须走渲染层即时上报，不是等轮询');
  // 可点时用外扩 8px 的边界：屏幕上 [96,224] 内都还算在里面；轻微出去不切。
  control('hover', { sx: 220, sy: 150 });
  assert.equal(snap().ignoring, false, '边缘外一点点不该立刻变穿透');
  control('hover', { sx: 230, sy: 150 });
  assert.equal(snap().ignoring, true, '确实离开后才允许穿透到下层窗口');
  control('ignore', false);
});

test('桌宠输入：按帧合并上报最新坐标、菜单键盘可达', () => {
  const ui = fs.readFileSync(path.join(__dirname, 'pet-ui.js'), 'utf8');
  const win = fs.readFileSync(path.join(__dirname, 'pet-window.cjs'), 'utf8');
  // rAF 回调读的是共享的最新坐标，不是触发节流的那个旧 event。
  assert.ok(ui.includes('function flushDrag()') && ui.includes('const { sx, sy } = lastPointer;'),
    '拖动节流没有读最新屏幕坐标');
  assert.ok(ui.includes("petControl('drag-end', lastPointer || undefined)"), '松手没有补发最终坐标');
  assert.ok(ui.includes("petControl('hover'"), '渲染层没有即时上报光标');
  assert.ok(ui.includes("addEventListener('mousemove'"), '穿透转发路径没有 hover 监听');
  // 右键菜单：方向键轮转、Esc 归还焦点、focusable 按需求登记。
  assert.ok(ui.includes("'ArrowDown', 'ArrowUp', 'Home', 'End'"), '菜单没有方向键导航');
  assert.ok(ui.includes('closeMenu(true)'), 'Esc 没把焦点还给角色');
  assert.ok(ui.includes('actor.tabIndex = -1'), '角色不可被脚本重新聚焦');
  assert.ok(ui.includes('requestFocus('), '菜单/聊天没有各自登记夺焦需求');
  // 主进程：滞回、即时入口、兜底轮询降频、drag-end 补定位。
  assert.ok(win.includes('HIT_HYSTERESIS'), '主进程没有穿透滞回');
  assert.ok(win.includes("action === 'hover'"), '主进程没有 hover 入口');
  assert.ok(/setInterval\(syncIgnoreFromCursor, 200\)/.test(win), '兜底轮询没有降频');
  assert.ok(win.includes('Number.isFinite(v.sx)'), '主进程没有处理松手最终坐标');
});
