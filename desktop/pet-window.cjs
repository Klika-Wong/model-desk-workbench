/* 独立桌宠窗口：透明、无边框、置顶、可锁定、可拖动、位置记忆。
   参考成熟做法（dsh-pet / ArkPets / Electron 桌宠实践）：小窗只占角色包围盒，
   不做全屏透明层，避免 Windows DWM 合成问题；状态与位置留在本机。 */
// 纯 Node 单测环境里没有 electron 包，容错加载；真正创建窗口只在主进程发生。
let electronApi = null;
try { electronApi = require('electron'); } catch { electronApi = null; }
const { BrowserWindow, ipcMain, screen } = electronApi || {};
const path = require('node:path');
const fs = require('node:fs');

const WIDTH = 250;
const HEIGHT = 300;
let petWindow = null;
let configPath = null;
let state = { x: null, y: null, locked: false, alwaysOnTop: true, outfit: null, modelId: null, opaque: false, hidden: false };
// 拖拽基准：按下时光标在窗口内的位置。每次移动都用「光标屏幕坐标 − 该偏移」直接算窗口位置，
// 不累加增量、也不依赖起始窗口坐标，所以不会像「起点+累计位移」那样把开头的丢帧变成永久偏移。
let dragOffset = null;
// 可点击区域（相对窗口，DIP）：渲染层上报角色 / 工具栏 / 气泡的合并包围盒。
// 透明窗口默认整个矩形都吃鼠标，不开这个的话点桌宠旁边的窗口会点不到。
let hitbox = null;
let hitTimer = null;
let ignoring = false;
let lastProbe = null;

function applyIgnore(next) {
  if (!petWindow || petWindow.isDestroyed() || next === ignoring) return;
  ignoring = next;
  try { petWindow.setIgnoreMouseEvents(next, { forward: true }); } catch {}
}

function syncIgnoreFromCursor() {
  if (!petWindow || petWindow.isDestroyed() || !hitbox) return;
  if (dragOffset) return; // 拖动中保持可点，否则会把自己锁住
  const p = screen.getCursorScreenPoint();
  const [wx, wy] = petWindow.getPosition();
  const lx = p.x - wx;
  const ly = p.y - wy;
  const inside = lx >= hitbox.x && lx <= hitbox.x + hitbox.w
    && ly >= hitbox.y && ly <= hitbox.y + hitbox.h;
  lastProbe = { lx, ly, inside, at: Date.now() };
  applyIgnore(!inside);
}

function startHitPoll() {
  stopHitPoll();
  hitTimer = setInterval(syncIgnoreFromCursor, 80);
}

function stopHitPoll() {
  if (hitTimer) clearInterval(hitTimer);
  hitTimer = null;
}
// 位置写盘必须去抖：拖动时 setPosition 每帧触发 moved，同步 writeFileSync 会堵住主进程，
// drag-move 排队延迟 → 窗口跳跃追赶光标，表现就是「自己乱跑」。
let saveTimer = null;
function scheduleSave(delay) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; save(); }, delay == null ? 500 : delay);
}

// 配置文件可能被手改坏或来自旧版本，读进来先收紧，别让怪值进窗口构造参数。
function sanitizeState(raw) {
  const clean = { x: null, y: null, locked: false, alwaysOnTop: true, outfit: null, modelId: null, opaque: false };
  if (!raw || typeof raw !== 'object') return clean;
  if (Number.isFinite(raw.x) && Number.isFinite(raw.y) && Math.abs(raw.x) < 100000 && Math.abs(raw.y) < 100000) {
    clean.x = Math.round(raw.x); clean.y = Math.round(raw.y);
  }
  clean.locked = raw.locked === true;
  clean.alwaysOnTop = raw.alwaysOnTop !== false;
  clean.opaque = raw.opaque === true;
  if (typeof raw.outfit === 'string') clean.outfit = raw.outfit.slice(0, 80);
  if (typeof raw.modelId === 'string') clean.modelId = raw.modelId.slice(0, 80);
  return clean;
}

function load() {
  try {
    state = sanitizeState(JSON.parse(fs.readFileSync(configPath, 'utf8')));
  } catch {}
  return state;
}
function save() {
  try { fs.writeFileSync(configPath, JSON.stringify(state, null, 2)); } catch {}
}

function defaultPosition() {
  const area = screen.getPrimaryDisplay().workArea;
  return { x: Math.max(area.x, area.x + area.width - WIDTH - 40), y: Math.max(area.y, area.y + area.height - HEIGHT - 40) };
}

function create() {
  if (petWindow && !petWindow.isDestroyed()) { petWindow.showInactive(); return petWindow; }
  const pos = (typeof state.x === 'number' && typeof state.y === 'number') ? { x: state.x, y: state.y } : defaultPosition();
  petWindow = new BrowserWindow({
    width: WIDTH, height: HEIGHT, x: pos.x, y: pos.y,
    // 透明窗口在 Windows DWM 下需要持续重组表面，是已知的闪烁来源。
    // 允许切成不透明（牺牲圆角透明），软件渲染的机器上更稳。
    transparent: !state.opaque, frame: false, alwaysOnTop: state.alwaysOnTop,
    backgroundColor: state.opaque ? '#202227' : '#00000000',
    skipTaskbar: true, resizable: false, hasShadow: false, show: false,
    // 默认不抢焦点：点角色/工具栏只触发点击，不会把当前窗口的焦点抢过来。
    // 需要打字时才临时打开（聊天框）。
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'pet-preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      // 之前设为 false：被遮挡时也满速跑动画，软件渲染下会和其他窗口抢 CPU。
      backgroundThrottling: true,
    },
  });
  // 位置可能来自旧显示器配置，落在屏幕外就拉回主屏，否则用户「拖不到」。
  const area = screen.getPrimaryDisplay().workArea;
  const outside = pos.x + WIDTH < area.x || pos.x > area.x + area.width
    || pos.y + HEIGHT < area.y || pos.y > area.y + area.height;
  if (outside) petWindow.setPosition(defaultPosition().x, defaultPosition().y);
  petWindow.webContents?.once?.('did-finish-load', () => startHitPoll());
  petWindow.loadFile(path.join(__dirname, 'pet.html'));
  petWindow.once('ready-to-show', () => {
    // close 可能早于 ready-to-show 到达，此时不能再 show，否则用户会看到「关掉后又冒出来」。
    if (!petWindow || petWindow.isDestroyed()) return;
    if (!state.hidden) petWindow.showInactive();
  });
  petWindow.on('moved', () => {
    if (!petWindow || petWindow.isDestroyed()) return;
    const [x, y] = petWindow.getPosition();
    state.x = x; state.y = y;
    if (!dragOffset) scheduleSave(600);  // 拖动中只记内存，松手后统一落盘
  });
  petWindow.on('closed', () => {
    stopHitPoll();
    hitbox = null;
    dragOffset = null;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    save();
    petWindow = null;
  });
  return petWindow;
}

// 只接受本地打包的两个页面；`index.html` 后面拼接的假路径不能混进来。
function isTrustedPetUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('file:')) return false;
  return /\/(?:index|pet)\.html$/.test(url.split('?')[0]);
}

function trusted(event) {
  if (!petWindow || petWindow.isDestroyed()) return false;
  return event.sender === petWindow.webContents;
}

function registerPetWindow(userDataPath) {
  configPath = path.join(userDataPath, 'pet-window.json');
  load();
  ipcMain.handle('pet:open', (event) => {
    // 只允许主窗口或桌宠自己打开，避免任意渲染进程弹窗。
    if (event.senderFrame && !isTrustedPetUrl(event.senderFrame.url)) {
      return { ok: false, error: 'Untrusted desktop window.' };
    }
    try { state.hidden = false; create(); return { ok: true, data: Object.assign({}, state) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('pet:state', (event) => {
    if (!trusted(event)) return { ok: false, error: 'Untrusted desktop window.' };
    return { ok: true, data: Object.assign({}, state) };
  });
  ipcMain.handle('pet:control', (event, action, value) => {
    if (!trusted(event) || !petWindow || petWindow.isDestroyed()) return { ok: false, error: 'Untrusted desktop window.' };
    if (action === 'lock') {
      state.locked = Boolean(value); save();
      return { ok: true, data: { locked: state.locked } };
    }
    if (action === 'opaque') {
      state.opaque = value === true;
      save();
      // transparent 只能在建窗时指定，改它必须重建窗口。
      if (petWindow && !petWindow.isDestroyed()) {
        const [x, y] = petWindow.getPosition();
        state.x = x; state.y = y;
        petWindow.destroy();
        petWindow = null;
        create();
      }
      return { ok: true, data: { opaque: state.opaque } };
    }
    if (action === 'focusable') {
      // 只有要输入文字时才允许夺焦，其他时候保持「点了也不抢焦点」。
      const on = value === true;
      try {
        petWindow.setFocusable(on);
        if (on) petWindow.focus();
      } catch {}
      return { ok: true, data: { focusable: on } };
    }
    if (action === 'top') {
      state.alwaysOnTop = Boolean(value);
      petWindow.setAlwaysOnTop(state.alwaysOnTop); save();
      return { ok: true, data: { alwaysOnTop: state.alwaysOnTop } };
    }
    if (action === 'hitbox') {
      const r = value || {};
      const pad = 6;
      const num = (v, d) => (Number.isFinite(v) ? Math.max(-pad, Math.min(HEIGHT * 2, v)) : d);
      const x = num(r.x, 0) - pad;
      const y = Number.isFinite(r.y) ? Math.max(-pad, Math.min(HEIGHT * 2, r.y)) - pad : -pad;
      const w = (Number.isFinite(r.w) ? Math.max(1, Math.min(WIDTH * 2, r.w)) : WIDTH) + pad * 2;
      const h = (Number.isFinite(r.h) ? Math.max(1, Math.min(HEIGHT * 2, r.h)) : HEIGHT) + pad * 2;
      hitbox = { x, y, w, h };
      return { ok: true };
    }
    if (action === 'ignore') {
      applyIgnore(Boolean(value));
      return { ok: true, data: { ignore: ignoring } };
    }
    if (action === 'drag-start') {
      if (state.locked) return { ok: true, data: { locked: true } };
      const v = value || {};
      const cx = Number.isFinite(v.x) ? v.x : WIDTH / 2;
      const cy = Number.isFinite(v.y) ? v.y : HEIGHT / 2;
      dragOffset = { x: Math.max(0, Math.min(WIDTH, cx)), y: Math.max(0, Math.min(HEIGHT, cy)) };
      applyIgnore(false); // 拖动期间必须能被点
      return { ok: true };
    }
    if (action === 'drag-move') {
      if (!dragOffset || state.locked) return { ok: true };
      const p = screen.getCursorScreenPoint();
      // 绝对计算：窗口左上角 = 光标 − 按下时的窗口内偏移。鼠标相对窗口的位置因此恒定。
      const nx = Math.round(p.x - dragOffset.x);
      const ny = Math.round(p.y - dragOffset.y);
      const [cx, cy] = petWindow.getPosition();
      if (nx !== cx || ny !== cy) petWindow.setPosition(nx, ny);
      return { ok: true };
    }
    if (action === 'drag-end') {
      dragOffset = null;
      const [x, y] = petWindow.getPosition();
      state.x = x; state.y = y;
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      save();
      return { ok: true, data: { x, y } };
    }
    if (action === 'move') {
      // 兼容旧调用：按增量移动并钳制单步幅度，防止异常值把窗口甩飞。
      if (state.locked) return { ok: true, data: { locked: true } };
      const dx = Math.max(-200, Math.min(200, Number(value && value.dx) || 0));
      const dy = Math.max(-200, Math.min(200, Number(value && value.dy) || 0));
      const [x, y] = petWindow.getPosition();
      petWindow.setPosition(x + Math.round(dx), y + Math.round(dy));
      return { ok: true };
    }
    if (action === 'outfit' || action === 'model') {
      if (typeof value === 'string' && value.length <= 80) {
        state[action === 'outfit' ? 'outfit' : 'modelId'] = value; save();
      }
      return { ok: true, data: Object.assign({}, state) };
    }
    if (action === 'close') { petWindow.close(); return { ok: true }; }
    return { ok: false, error: 'Unknown pet action.' };
  });
  return {
    open: () => create(),
    // 主窗口收到托盘时把桌宠一起藏起来；从托盘回来再恢复。
    // 否则用户点了右上角关闭，桌面上还杵着一只，看起来像没关掉。
    hide: () => {
      // 没开过就什么都不做，别在「关窗」时顺手把它创建出来。
      if (!petWindow || petWindow.isDestroyed()) return;
      state.hidden = true;
      stopHitPoll();
      petWindow.hide();
    },
    show: () => {
      if (!state.hidden) return; // 从没被收起过，不需要恢复
      state.hidden = false;
      if (petWindow && !petWindow.isDestroyed()) { petWindow.showInactive(); startHitPoll(); }
      else create();
    },
    close: () => { if (petWindow && !petWindow.isDestroyed()) petWindow.close(); },
    // 只读快照，供诊断与测试确认内部状态
    snapshot: () => ({ hitbox: hitbox ? Object.assign({}, hitbox) : null, ignoring, dragOffset: dragOffset ? Object.assign({}, dragOffset) : null, lastProbe }),
  };
}

module.exports = { registerPetWindow, defaultPosition, sanitizeState, isTrustedPetUrl };
