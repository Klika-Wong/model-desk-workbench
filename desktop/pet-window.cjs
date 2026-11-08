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
let state = { x: null, y: null, locked: false, alwaysOnTop: true, outfit: null, modelId: null };
// 拖拽基准：窗口跟着鼠标动时，渲染进程的 clientX/Y 会反向变化，必须用屏幕绝对坐标。
let dragOrigin = null;
let dragWinStart = null;
// 位置写盘必须去抖：拖动时 setPosition 每帧触发 moved，同步 writeFileSync 会堵住主进程，
// drag-move 排队延迟 → 窗口跳跃追赶光标，表现就是「自己乱跑」。
let saveTimer = null;
function scheduleSave(delay) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; save(); }, delay == null ? 500 : delay);
}

// 配置文件可能被手改坏或来自旧版本，读进来先收紧，别让怪值进窗口构造参数。
function sanitizeState(raw) {
  const clean = { x: null, y: null, locked: false, alwaysOnTop: true, outfit: null, modelId: null };
  if (!raw || typeof raw !== 'object') return clean;
  if (Number.isFinite(raw.x) && Number.isFinite(raw.y) && Math.abs(raw.x) < 100000 && Math.abs(raw.y) < 100000) {
    clean.x = Math.round(raw.x); clean.y = Math.round(raw.y);
  }
  clean.locked = raw.locked === true;
  clean.alwaysOnTop = raw.alwaysOnTop !== false;
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
    transparent: true, frame: false, alwaysOnTop: state.alwaysOnTop,
    skipTaskbar: true, resizable: false, hasShadow: false, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'pet-preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false,
    },
  });
  // 位置可能来自旧显示器配置，落在屏幕外就拉回主屏，否则用户「拖不到」。
  const area = screen.getPrimaryDisplay().workArea;
  const outside = pos.x + WIDTH < area.x || pos.x > area.x + area.width
    || pos.y + HEIGHT < area.y || pos.y > area.y + area.height;
  if (outside) petWindow.setPosition(defaultPosition().x, defaultPosition().y);
  petWindow.loadFile(path.join(__dirname, 'pet.html'));
  petWindow.once('ready-to-show', () => petWindow.showInactive());
  petWindow.on('moved', () => {
    if (!petWindow || petWindow.isDestroyed()) return;
    const [x, y] = petWindow.getPosition();
    state.x = x; state.y = y;
    if (!dragOrigin) scheduleSave(600);  // 拖动中只记内存，松手后统一落盘
  });
  petWindow.on('closed', () => {
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
    try { create(); return { ok: true, data: Object.assign({}, state) }; }
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
    if (action === 'top') {
      state.alwaysOnTop = Boolean(value);
      petWindow.setAlwaysOnTop(state.alwaysOnTop); save();
      return { ok: true, data: { alwaysOnTop: state.alwaysOnTop } };
    }
    if (action === 'drag-start') {
      if (state.locked) return { ok: true, data: { locked: true } };
      dragOrigin = screen.getCursorScreenPoint();
      dragWinStart = petWindow.getPosition();
      return { ok: true };
    }
    if (action === 'drag-move') {
      if (!dragOrigin || !dragWinStart || state.locked) return { ok: true };
      const p = screen.getCursorScreenPoint();
      // 用「起点窗口位置 + 累计屏幕位移」，不累加增量，避免抖动与方向反转。
      const nx = dragWinStart[0] + Math.round(p.x - dragOrigin.x);
      const ny = dragWinStart[1] + Math.round(p.y - dragOrigin.y);
      const [cx, cy] = petWindow.getPosition();
      if (nx !== cx || ny !== cy) petWindow.setPosition(nx, ny);
      return { ok: true };
    }
    if (action === 'drag-end') {
      dragOrigin = null; dragWinStart = null;
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
  return { close: () => { if (petWindow && !petWindow.isDestroyed()) petWindow.close(); } };
}

module.exports = { registerPetWindow, defaultPosition, sanitizeState, isTrustedPetUrl };
