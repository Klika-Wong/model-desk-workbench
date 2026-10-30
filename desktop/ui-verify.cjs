// 本地 UI 验证（不连面板）：验证页面不叠加、项目路径用绝对路径、小窗可渲染。
const { app, BrowserWindow, nativeTheme, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const PROJECT = 'E:\\model-desk-fixture';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const result = { ok: false, checks: [], error: '' };

async function main() {
  const consoleErrors = [];
  const win = new BrowserWindow({
    width: 1280, height: 820, show: false,
    webPreferences: { preload: path.join(__dirname, 'ui-verify-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.on('console-message', (_event, level, message, line, source) => {
    if (level >= 2) consoleErrors.push(`${source}:${line} ${message}`);
  });
  win.webContents.on('render-process-gone', (_e, details) => consoleErrors.push(`renderer gone: ${details.reason}`));
  await win.loadFile(path.join(__dirname, 'index.html'));
  await wait(700);
  const js = (code) => win.webContents.executeJavaScript(code);

  // 1) 页面互斥：对话页 → 记忆页（模拟命令面板跳转，不走导航点击）
  const pages = await js(`(async () => {
    document.querySelector('#nav-chat').click();
    await new Promise(r => setTimeout(r, 150));
    const chatShown = !document.querySelector('#chat-page').hidden;
    if (!window.__memoryUi || typeof window.__memoryUi.page !== 'function') return { missing: true, keys: Object.keys(window.__memoryUi || {}) };
    window.__memoryUi.page('memory');
    await new Promise(r => setTimeout(r, 150));
    return {
      chatShown,
      chatHiddenAfter: document.querySelector('#chat-page').hidden,
      memoryShown: !document.querySelector('#memory-page').hidden,
      navChatActive: document.querySelector('#nav-chat').classList.contains('active'),
      navMemoryActive: document.querySelector('#nav-memory').classList.contains('active'),
    };
  })()`);
  if (pages.missing) throw new Error(`记忆页接口不可用：${JSON.stringify(pages.keys)}`);
  if (!pages.chatShown) throw new Error('对话页没有显示');
  if (!pages.chatHiddenAfter) throw new Error('切到记忆页后对话页仍然可见（页面叠加）');
  if (!pages.memoryShown) throw new Error('记忆页没有显示');
  if (pages.navChatActive || !pages.navMemoryActive) throw new Error('导航高亮不正确');
  result.checks.push('pages-mutually-exclusive');

  // 2) 对话页：项目名显示 + 发送时用的是绝对路径（不是文件夹名）
  const chat = await js(`(async () => {
    document.querySelector('#nav-chat').click();
    await new Promise(r => setTimeout(r, 400));
    const name = document.querySelector('#chat-project-name').textContent.trim();
    const restored = document.querySelectorAll('#chat-log .chat-msg').length;
    const restoredText = (document.querySelector('#chat-log .chat-msg .chat-text') || {}).textContent || '';
    document.querySelector('#chat-models').click();
    await new Promise(r => setTimeout(r, 200));
    document.querySelector('#chat-model').value = 'm-local';
    document.querySelector('#chat-model').dispatchEvent(new Event('change'));
    document.querySelector('#chat-input').value = '验证用问题';
    document.querySelector('#chat-input').dispatchEvent(new Event('input'));
    document.querySelector('#chat-consent').checked = true;
    document.querySelector('#chat-consent').dispatchEvent(new Event('change'));
    const useMemory = document.querySelector('#chat-use-memory');
    useMemory.checked = true;
    useMemory.dispatchEvent(new Event('change'));
    const sendEnabled = !document.querySelector('#chat-send').disabled;
    window.__stubCalls.setSendOk(true);
    document.querySelector('#chat-send').click();
    await new Promise(r => setTimeout(r, 900));
    const liveText = (document.querySelector('#chat-log .chat-text.is-streaming') || {}).textContent || '';
    const cursorOn = Boolean(document.querySelector('#chat-log .chat-text.is-streaming'));
    const logCalls = window.__stubCalls.logCalls();
    await new Promise(r => setTimeout(r, 2400));
    const finalText = [...document.querySelectorAll('#chat-log .chat-msg.assistant .chat-text')].pop();
    const finalStreaming = Boolean(document.querySelector('#chat-log .chat-text.is-streaming'));
    const chips = [...document.querySelectorAll('.chat-chip')];
    if (chips.length) chips[0].click();
    await new Promise(r => setTimeout(r, 400));
    const dialog = document.querySelector('#chat-source-dialog');
    const calls = window.__stubCalls.all().filter(c => c.api === 'dispatchSend');
    await new Promise(r => setTimeout(r, 800));
    const saves = window.__stubCalls.all().filter(c => c.api === 'chatSave');
    return { name, restored, restoredText, sendEnabled, project: calls.length ? calls[calls.length - 1].input.project : null,
      saved: saves.length ? saves[saves.length - 1].input.length : 0, status: document.querySelector('#chat-status').textContent,
      chips: chips.length,
      dialogOpen: Boolean(dialog && dialog.open),
      dialogTitle: (document.querySelector('#chat-source-title') || {}).textContent,
      dialogBody: (document.querySelector('#chat-source-body') || {}).textContent,
      liveText, cursorOn, logCalls, finalText: finalText ? finalText.textContent : '', finalStreaming };
  })()`);
  if (chat.name !== 'model-desk-fixture') throw new Error(`对话页项目名不对：${chat.name}`);
  if (chat.restored !== 1 || chat.restoredText !== '上次的第一句') throw new Error(`上次对话没有恢复：${JSON.stringify({ n: chat.restored, t: chat.restoredText })}`);
  if (chat.saved < 1) throw new Error('发消息后没有触发本机保存');
  if (!chat.cursorOn || !chat.liveText.includes('正在输出')) throw new Error(`运行中没有增量显示：${JSON.stringify({ live: chat.liveText, cursor: chat.cursorOn })}`);
  if (chat.logCalls < 2) throw new Error(`增量刷新没有按 400ms 跑起来，900ms 内只拉了 ${chat.logCalls} 次`);
  if (!chat.finalText.includes('最终回答')) throw new Error(`终态没有显示最终回答：${chat.finalText}`);
  if (chat.finalStreaming) throw new Error('完成后光标没有移除');
  if (chat.chips < 1) throw new Error('打开记忆开关后没有出现注入条目');
  if (!chat.dialogOpen) throw new Error('点击注入条目没有打开原文弹窗');
  if (!String(chat.dialogBody).includes('记忆原文正文')) throw new Error(`原文弹窗内容不对：${chat.dialogBody}`);
  // 弹窗开着时留一张图，然后关掉，避免挡住后面的页面切换。
  fs.writeFileSync(path.join(__dirname, 'chat-source-dialog.png'), (await win.capturePage()).toPNG());
  await js("document.querySelector('#chat-source-dialog').close()");
  if (!chat.sendEnabled) throw new Error('填完模型/内容/确认后发送按钮仍是禁用');
  if (chat.project !== PROJECT) throw new Error(`对话发送用了错误项目：${chat.project}`);
  result.checks.push('chat-send-uses-absolute-project');
  result.checks.push('chat-history-restored-and-saved');
  result.checks.push('chat-injection-source-dialog');
  result.checks.push('chat-streaming-partial-then-final');

  // 3) 派发卡片：预览同样用绝对路径
  const dispatch = await js(`(async () => {
    document.querySelector('#nav-tasks').click();
    await new Promise(r => setTimeout(r, 300));
    document.querySelector('#dispatch-models').click();
    await new Promise(r => setTimeout(r, 200));
    document.querySelector('#dispatch-model').value = 'm-local';
    document.querySelector('#dispatch-model').dispatchEvent(new Event('change'));
    document.querySelector('#dispatch-prompt').value = '验证用任务';
    document.querySelector('#dispatch-prompt').dispatchEvent(new Event('input'));
    document.querySelector('#dispatch-consent').checked = true;
    document.querySelector('#dispatch-consent').dispatchEvent(new Event('change'));
    document.querySelector('#dispatch-preview').click();
    await new Promise(r => setTimeout(r, 400));
    const calls = window.__stubCalls.all().filter(c => c.api === 'dispatchPreview');
    const previewProject = calls.length ? calls[calls.length - 1].input.project : null;
    document.querySelector('#dispatch-send').click();
    await new Promise(r => setTimeout(r, 500));
    return { project: previewProject,
      status: document.querySelector('#dispatch-status').textContent,
      sendDisabledWhileRunning: document.querySelector('#dispatch-send').disabled,
      cancelVisible: !document.querySelector('#dispatch-cancel').hidden };
  })()`);
  if (dispatch.project !== PROJECT) throw new Error(`派发预览用了错误项目：${dispatch.project}`);
  if (!dispatch.sendDisabledWhileRunning) throw new Error('任务在跟跑时派发按钮仍可点：会覆盖前一个任务的跟踪');
  if (!dispatch.cancelVisible) throw new Error('派发后没有出现取消入口');
  result.checks.push('dispatch-preview-uses-absolute-project');
  result.checks.push('dispatch-no-double-send');

  // 4) 嵌入失败时不锁滚动（不能把外壳滚动条永久关掉）
  const embed = await js(`(async () => {
    document.querySelector('#nav-panel').click();
    await new Promise(r => setTimeout(r, 500));
    return { locked: document.documentElement.classList.contains('panel-embedded'), status: (document.querySelector('#conn-status')||{}).textContent, actives: [...document.querySelectorAll('.nav-button.active')].map(b => b.id) };
  })()`);
  if (embed.locked) throw new Error('嵌入失败后仍然锁住外壳滚动（panel-embedded 未清除）');
  if (embed.actives.length !== 1) throw new Error('嵌入失败后导航高亮丢了：' + JSON.stringify(embed.actives));
  result.checks.push('embed-failure-unlocks-scroll');
  const gone = await js(`(() => {
    const api = window.__workbenchShell;
    if (!api || typeof api.onPanelGone !== 'function') return { missing: true };
    api.onPanelGone('渲染进程已退出：crashed');
    const status = document.getElementById('conn-status');
    return { missing: false, text: status.textContent, isError: status.classList.contains('is-error'),
      shown: api.isPanelShown(), locked: document.documentElement.classList.contains('panel-embedded') };
  })()`);
  if (gone.missing) throw new Error('shell 没有暴露 onPanelGone');
  if (gone.shown || gone.locked) throw new Error('面板崩溃后状态没有改回未嵌入');
  if (!gone.isError || !/断开/.test(gone.text)) throw new Error(`面板崩溃后没有明确提示：${gone.text}`);
  result.checks.push('panel-gone-reported');

  // 5) 其余页面与弹窗走一遍：只看不炸（控制台错误在结尾统一断言）
  const walk = await js(`(async () => {
    const out = {};
    document.querySelector('#open-settings').click();
    await new Promise(r => setTimeout(r, 150));
    out.settingsOpen = Boolean(document.querySelector('#settings-dialog').open);
    const theme = document.querySelector('#theme-select');
    theme.value = 'dark';
    theme.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 120));
    out.theme = document.documentElement.getAttribute('data-theme');
    document.querySelector('#close-settings').click();
    await new Promise(r => setTimeout(r, 120));
    out.settingsClosed = !document.querySelector('#settings-dialog').open;

    document.querySelector('#open-performance').click();
    await new Promise(r => setTimeout(r, 250));
    out.performanceOpen = Boolean(document.querySelector('#performance-dialog').open);
    document.querySelector('#close-performance').click();
    await new Promise(r => setTimeout(r, 120));

    document.querySelector('#nav-designer').click();
    await new Promise(r => setTimeout(r, 250));
    out.designerVisible = !document.querySelector('#designer-page').hidden;
    document.querySelector('#designer-trial').click();
    await new Promise(r => setTimeout(r, 250));

    document.querySelector('#nav-memory').click();
    await new Promise(r => setTimeout(r, 250));
    out.memoryVisible = !document.querySelector('#memory-page').hidden;
    const search = document.querySelector('#memory-search');
    search.value = '示例';
    search.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 200));
    const density = document.querySelector('#density-select');
    density.value = 'compact';
    density.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 200));
    out.navActive = [...document.querySelectorAll('.nav-button.active')].map(b => b.id);

    // 命令面板：打开 → 输入 → Esc 关闭
    document.querySelector('#open-palette').click();
    await new Promise(r => setTimeout(r, 200));
    const palette = document.querySelector('#palette');
    out.paletteOpen = !palette.hidden;
    const pinput = document.querySelector('#palette-input');
    pinput.value = '记忆';
    pinput.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 250));
    out.paletteResults = document.querySelectorAll('#palette-list li').length;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    out.paletteClosed = palette.hidden;

    // 添加记忆弹窗：打开 → 取消
    document.querySelector('#add-memory').click();
    await new Promise(r => setTimeout(r, 200));
    out.entryDialogOpen = Boolean(document.querySelector('#entry-dialog').open);
    document.querySelector('#entry-dialog [data-close]').click();
    await new Promise(r => setTimeout(r, 150));
    out.entryDialogClosed = !document.querySelector('#entry-dialog').open;

    // 侧栏折叠：隐藏 → 恢复
    const sidebar = document.querySelector('.sidebar');
    document.querySelector('#toggle-sidebar').click();
    await new Promise(r => setTimeout(r, 200));
    out.sidebarHidden = sidebar.classList.contains('is-hidden') || document.documentElement.classList.contains('sidebar-hidden') || getComputedStyle(sidebar).display === 'none';
    document.querySelector('#toggle-sidebar').click();
    await new Promise(r => setTimeout(r, 200));
    return out;
  })()`);
  if (!walk.settingsOpen || !walk.settingsClosed) throw new Error('设置弹窗打不开或关不掉');
  if (walk.theme !== 'dark') throw new Error(`切换主题没生效：${walk.theme}`);
  if (!walk.performanceOpen) throw new Error('性能弹窗打不开');
  if (!walk.designerVisible) throw new Error('架构画布没有显示');
  if (!walk.memoryVisible) throw new Error('记忆页没有显示');
  if (walk.navActive.length !== 1) throw new Error(`导航高亮数量不对：${JSON.stringify(walk.navActive)}`);
  if (!walk.paletteOpen || !walk.paletteClosed) throw new Error('命令面板打不开或关不掉');
  if (walk.paletteResults < 1) throw new Error('命令面板搜不到结果');
  if (!walk.entryDialogOpen || !walk.entryDialogClosed) throw new Error('添加记忆弹窗打不开或关不掉');
  if (!walk.sidebarHidden) throw new Error('侧栏折叠没有生效');
  result.checks.push('pages-and-dialogs-walkthrough');

  // 6) 快捷键：清单上写了的，逐个按一遍
  const keys = await js(`(async () => {
    const out = {};
    const hit = (opts) => document.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ bubbles: true }, opts)));
    hit({ ctrlKey: true, key: '/', code: 'Slash' });
    await new Promise(r => setTimeout(r, 200));
    out.shortcutsOpen = Boolean(document.querySelector('#shortcuts-dialog').open);
    document.querySelector('#close-shortcuts').click();
    await new Promise(r => setTimeout(r, 150));
    out.shortcutsClosed = !document.querySelector('#shortcuts-dialog').open;

    hit({ ctrlKey: true, shiftKey: true, key: '2', code: 'Digit2' });
    await new Promise(r => setTimeout(r, 150));
    out.themeAfter2 = document.documentElement.getAttribute('data-theme');
    hit({ ctrlKey: true, shiftKey: true, key: '1', code: 'Digit1' });
    await new Promise(r => setTimeout(r, 150));
    out.themeAfter1 = document.documentElement.getAttribute('data-theme');

    const sidebar = document.querySelector('.sidebar');
    const hiddenNow = () => getComputedStyle(sidebar).display === 'none'
      || sidebar.classList.contains('is-hidden')
      || document.documentElement.classList.contains('sidebar-hidden');
    hit({ ctrlKey: true, key: 'b', code: 'KeyB' });
    await new Promise(r => setTimeout(r, 250));
    out.sidebarHiddenByKey = hiddenNow();
    hit({ ctrlKey: true, key: 'b', code: 'KeyB' });
    await new Promise(r => setTimeout(r, 250));
    out.sidebarRestored = !hiddenNow();

    hit({ ctrlKey: true, key: 'k', code: 'KeyK' });
    await new Promise(r => setTimeout(r, 250));
    out.paletteByKey = !document.querySelector('#palette').hidden;
    hit({ key: 'Escape', code: 'Escape' });
    await new Promise(r => setTimeout(r, 200));
    out.paletteClosedByEsc = document.querySelector('#palette').hidden;

    hit({ ctrlKey: true, shiftKey: true, key: 'W', code: 'KeyW' });
    await new Promise(r => setTimeout(r, 700));
    out.viewToggleStatus = (document.querySelector('#conn-status') || {}).textContent || '';
    return out;
  })()`);
  if (!keys.shortcutsOpen || !keys.shortcutsClosed) throw new Error('Ctrl+/ 打不开或关不掉快捷键总览');
  if (keys.themeAfter2 !== 'dark' || keys.themeAfter1 !== 'light') throw new Error(`Ctrl+Shift+1/2 主题没生效：${keys.themeAfter2} / ${keys.themeAfter1}`);
  if (!keys.sidebarHiddenByKey) throw new Error('Ctrl+B 没有隐藏侧栏');
  if (!keys.sidebarRestored) throw new Error('Ctrl+B 再按一次没有恢复侧栏');
  if (!keys.paletteByKey || !keys.paletteClosedByEsc) throw new Error('Ctrl+K / Esc 对命令面板无效');
  if (!/嵌入|工作台/.test(keys.viewToggleStatus)) throw new Error(`Ctrl+Shift+W 没有任何反馈：${keys.viewToggleStatus}`);
  result.checks.push('keyboard-shortcuts');

  // 7) 拖拽类交互：侧栏拖宽 / 左右停靠 / 画布拖节点 / Ctrl+滚轮缩放 / 中键平移
  const drag = await js(`(async () => {
    const out = {};
    // 合成指针事件不会真的捕获指针，这里把捕获 API 变成无害的空操作。
    Element.prototype.setPointerCapture = function () {};
    Element.prototype.releasePointerCapture = function () {};
    Element.prototype.hasPointerCapture = function () { return true; };
    const pointer = (el, type, x, y, extra = {}) => el.dispatchEvent(new PointerEvent(type, Object.assign({
      bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, buttons: 1,
    }, extra)));
    const widthNow = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width')) || 0;

    const before = widthNow();
    const grip = document.querySelector('#sidebar-resizer');
    pointer(grip, 'pointerdown', 230, 300);
    pointer(grip, 'pointermove', 290, 300);
    pointer(grip, 'pointerup', 290, 300, { buttons: 0 });
    await new Promise(r => setTimeout(r, 150));
    out.sidebarWidthBefore = Math.round(before);
    out.sidebarWidthAfter = Math.round(widthNow());
    out.sidebarAria = grip.getAttribute('aria-valuenow');

    document.querySelector('#dock-sidebar').click();
    await new Promise(r => setTimeout(r, 150));
    out.dockedRight = document.body.classList.contains('sidebar-right');
    document.querySelector('#dock-sidebar').click();
    await new Promise(r => setTimeout(r, 150));
    document.querySelector('#reset-layout').click();
    await new Promise(r => setTimeout(r, 150));
    out.sidebarReset = Math.round(widthNow());

    document.querySelector('#nav-designer').click();
    await new Promise(r => setTimeout(r, 300));
    document.querySelector('#designer-add').click();
    await new Promise(r => setTimeout(r, 300));
    const vp = document.querySelector('#designer-canvas');
    let card = document.querySelector('.diagram-node');
    if (!card) return Object.assign(out, { designerCard: false, designerMessage: document.querySelector('#designer-message').textContent });
    const left0 = parseFloat(card.style.left);
    const top0 = parseFloat(card.style.top);
    const r = card.getBoundingClientRect();
    pointer(card, 'pointerdown', r.left + 10, r.top + 10);
    pointer(vp, 'pointermove', r.left + 80, r.top + 50);
    pointer(vp, 'pointerup', r.left + 80, r.top + 50, { buttons: 0 });
    await new Promise(r => setTimeout(r, 200));
    card = document.querySelector('.diagram-node');
    out.designerCard = true;
    out.nodeMoved = Math.round(parseFloat(card.style.left) - left0) + ',' + Math.round(parseFloat(card.style.top) - top0);

    const stage = document.querySelector('.diagram-stage');
    // render() 会重建 stage 元素，每次都重新查，别拿旧节点读样式。
    const stageNow = () => document.querySelector('.diagram-stage');
    const scale = () => (stageNow().style.transform.match(/scale[(]([0-9.]+)[)]/) || [])[1];
    out.stageStyle = stageNow().getAttribute('style');
    const scale0 = scale();
    const vr = vp.getBoundingClientRect();
    vp.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, ctrlKey: true, clientX: vr.left + 200, clientY: vr.top + 150 }));
    await new Promise(r => setTimeout(r, 150));
    out.zoomFrom = scale0;
    out.zoomTo = scale();

    const beforePan = stageNow().style.transform;
    pointer(vp, 'pointerdown', vr.left + 300, vr.top + 200, { button: 1, buttons: 4 });
    pointer(vp, 'pointermove', vr.left + 360, vr.top + 240, { buttons: 4 });
    pointer(vp, 'pointerup', vr.left + 360, vr.top + 240, { button: 1, buttons: 0 });
    await new Promise(r => setTimeout(r, 150));
    out.panChanged = stageNow().style.transform !== beforePan;
    return out;
  })()`);
  if (!drag.designerCard) throw new Error('画布上没有可拖的节点（新增失败）：' + (drag.designerMessage || '无提示'));
  if (drag.sidebarWidthAfter <= drag.sidebarWidthBefore) throw new Error(`侧栏拖动没有加宽：${drag.sidebarWidthBefore} → ${drag.sidebarWidthAfter}`);
  if (!drag.dockedRight) throw new Error('“移到右侧”没有生效');
  if (Math.abs(drag.sidebarReset - 226) > 2) throw new Error(`重置布局没有回到 226：${drag.sidebarReset}`);
  if (drag.nodeMoved !== '70,40') throw new Error(`拖节点位移不对：${drag.nodeMoved}`);
  if (!(Number(drag.zoomTo) > Number(drag.zoomFrom))) throw new Error(`Ctrl+滚轮没有放大：${drag.zoomFrom} → ${drag.zoomTo} | style=${drag.stageStyle} count=${drag.stageCount}`);
  if (!drag.panChanged) throw new Error('中键拖动没有平移画布');
  result.checks.push('drag-interactions');

  // 8) 框选与右键菜单
  const canvas = await js(`(async () => {
    const out = {};
    const vp = document.querySelector('#designer-canvas');
    const vr = vp.getBoundingClientRect();
    const pointer = (el, type, x, y, extra = {}) => el.dispatchEvent(new PointerEvent(type, Object.assign({
      bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, buttons: 1,
    }, extra)));

    document.querySelector('#designer-add').click();
    await new Promise(r => setTimeout(r, 250));
    out.nodesBefore = document.querySelectorAll('.diagram-node').length;

    // 从右下往左上拖一个覆盖整块画布的框
    pointer(vp, 'pointerdown', vr.left + vr.width - 20, vr.top + vr.height - 20);
    pointer(vp, 'pointermove', vr.left + 20, vr.top + 20);
    pointer(vp, 'pointerup', vr.left + 20, vr.top + 20, { buttons: 0 });
    await new Promise(r => setTimeout(r, 250));
    out.marqueeSelected = document.querySelectorAll('.diagram-node.selected').length;
    out.marqueeMessage = document.querySelector('#designer-message').textContent;

    const card = document.querySelector('.diagram-node');
    const r = card.getBoundingClientRect();
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 10, clientY: r.top + 10 }));
    await new Promise(r => setTimeout(r, 200));
    const menu = document.querySelector('#designer-menu');
    out.menuOpen = !menu.hidden;
    out.menuItems = menu.querySelectorAll('button').length;
    out.menuText = menu.textContent.slice(0, 60);
    pointer(vp, 'pointerdown', vr.left + 5, vr.top + vr.height - 5);
    pointer(vp, 'pointerup', vr.left + 5, vr.top + vr.height - 5, { buttons: 0 });
    await new Promise(r => setTimeout(r, 200));
    out.menuClosed = menu.hidden;
    out.hasDblclickHandler = typeof vp.ondblclick === 'function';
    return out;
  })()`);
  if (canvas.nodesBefore < 2) throw new Error(`画布节点数不足，框选无从验证：${canvas.nodesBefore}`);
  if (!(canvas.marqueeSelected >= 1)) throw new Error(`框选没有选中节点：${canvas.marqueeMessage}`);
  if (!/框选/.test(canvas.marqueeMessage)) throw new Error(`框选后没有提示：${canvas.marqueeMessage}`);
  if (!canvas.menuOpen) throw new Error('右键节点没有弹出菜单');
  if (canvas.menuItems < 2) throw new Error(`右键菜单项太少：${canvas.menuItems}`);
  if (!canvas.menuClosed) throw new Error('点空白处没有关掉右键菜单');
  result.checks.push('marquee-and-context-menu');
  result.canvas = canvas;

  const feed = await js(`(() => {
    const box = document.createElement('div');
    const task = {id:'review-fixture',title:'验收状态验证',status:'completed',model:'测试模型'};
    window.renderTaskFeed(box, [task]);
    const pending = box.querySelector('.feed-status').textContent;
    box.querySelector('details').open = true;
    window.renderTaskFeed(box, [{...task,reviewState:'accepted',acceptanceValid:false}]);
    const invalid = box.querySelector('.feed-status').textContent;
    const expanded = box.querySelector('details').open;
    window.renderTaskFeed(box, [{...task,reviewState:'accepted'}]);
    const unverified = box.querySelector('.feed-status').textContent;
    window.renderTaskFeed(box, [{...task,status:'failed',reviewState:'final_accepted',acceptanceValid:true}]);
    return {pending,invalid,expanded,unverified,takeover:box.querySelector('.feed-status').textContent,rawFailure:box.querySelector('dl').textContent.includes('failed')};
  })()`);
  if (feed.pending !== '执行结束 · 待验收' || feed.invalid !== '验收失效 · 待复核' || feed.unverified !== '验收待核实' || !feed.expanded || feed.takeover !== '主脑接管 · 已验收' || !feed.rawFailure) throw new Error('任务动态误报验收或刷新折叠了详情');
  result.checks.push('feed-review-evidence-and-refresh');

  const routing = await js(`(() => {
    const graph = document.createElement('div');
    const executors = [{id:'dsh',model:'new-model',enabled:false},{id:'pi',model:'old-model'}];
    const task = {status:'running',engine:'dsh',modelId:'old-model',model:'旧模型'};
    const states = () => [...graph.querySelectorAll('.conn-execs .conn-node')].map(n => n.dataset.status);
    window.renderConnectionGraph(graph, '', executors, [task]);
    const actual = states();
    const name = graph.querySelector('.conn-execs .conn-name').textContent;
    const shared = executors.map(e => ({...e,model:'same'}));
    window.renderConnectionGraph(graph, '', shared, [{status:'running',modelId:'same'}]);
    const ambiguous = states();
    window.renderConnectionGraph(graph, '', executors, [{...task,engine:'unknown'}]);
    const unknown = states();
    return {actual,name,ambiguous,unknown};
  })()`);
  if (routing.actual.join(',') !== 'running,idle' || !routing.name.includes('旧模型') || routing.ambiguous.join(',') !== 'idle,idle' || routing.unknown.join(',') !== 'idle,idle') throw new Error('运行小球错误地跟随当前模型或猜测执行端');
  result.checks.push('connection-saved-engine-and-ambiguous-model');

  const switched = await js(`(async () => {
    window.__stubCalls.enablePanelFixture();
    document.querySelector('#nav-tasks').click();
    await new Promise(r => setTimeout(r, 120));
    window.__stubCalls.holdNextPanel();
    document.querySelector('#conn-refresh').click();
    for (let i=0;i<20 && !window.__stubCalls.hasHeldPanel();i++) await new Promise(r => setTimeout(r, 10));
    const held = window.__stubCalls.hasHeldPanel();
    window.__stubCalls.setProject('E:/ui-project-B');
    document.querySelector('#choose').click();
    await new Promise(r => setTimeout(r, 150));
    const before = document.querySelector('#real-tasks').textContent;
    window.__stubCalls.releasePanel();
    await new Promise(r => setTimeout(r, 150));
    return {held,before,after:document.querySelector('#real-tasks').textContent};
  })()`);
  if (!switched.held || !switched.before.includes('ui-project-B') || switched.after !== switched.before || switched.after.includes(PROJECT)) throw new Error('切换项目后旧请求覆盖了新项目动态');
  result.checks.push('project-switch-discards-delayed-response');

  // 9) 小窗单独渲染：深色 + 可滚动
  nativeTheme.themeSource = 'dark';
  ipcMain.handle('mini:tasks', () => ({ tasks: Array.from({ length: 12 }, (_, i) => ({ id: 't' + i, label: '示例任务 ' + (i + 1) + ' 一个比较长的标题用来检查换行', status: i % 3 === 0 ? 'running' : 'completed' })), source: 'demo' }));
  const mini = new BrowserWindow({ width: 420, height: 330, show: false, webPreferences: { preload: path.join(__dirname, 'mini-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  await mini.loadFile(path.join(__dirname, 'mini.html'));
  await wait(600);
  const miniState = await mini.webContents.executeJavaScript(`(() => {
    const box = document.getElementById('tasks');
    const bg = getComputedStyle(document.body).backgroundColor;
    return { rows: box.querySelectorAll('.task').length, scrollable: box.scrollHeight > box.clientHeight, bg, source: (document.getElementById('source')||{}).textContent };
  })()`);
  if (miniState.rows < 5) throw new Error(`小窗只渲染了 ${miniState.rows} 行`);
  if (!miniState.scrollable) throw new Error('小窗内容区没有形成独立滚动');
  result.checks.push('mini-window-renders-and-scrolls');
  result.mini = miniState;

  fs.writeFileSync(path.join(__dirname, 'ui-verify-chat.png'), (await win.capturePage()).toPNG());
  result.consoleErrors = consoleErrors;
  if (consoleErrors.length) throw new Error(`页面出现 ${consoleErrors.length} 条控制台错误：${consoleErrors.slice(0, 3).join(' | ')}`);
  result.ok = true;
  result.finishedAt = new Date().toISOString();
}

app.whenReady().then(async () => {
  try { await main(); }
  catch (error) { result.error = error.message; }
  process.stdout.write(JSON.stringify(result) + '\n');
  app.exit(result.ok ? 0 : 1);
});
