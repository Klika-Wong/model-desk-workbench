// 本地 UI 验证（不连面板）：验证页面不叠加、项目路径用绝对路径、小窗可渲染。
const { app, BrowserWindow, nativeTheme, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const PROJECT = 'E:\\fixture-workspace';
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
  let jsSeq = 0, jsLast = '';
  const js = async (code) => {
    jsSeq += 1; jsLast = String(code).replace(/\s+/g, ' ').slice(0, 400);
    try { return await win.webContents.executeJavaScript(code); }
    catch (e) { throw new Error(`[js#${jsSeq}] ${e.message} :: ${jsLast}`); }
  };

  // The native overview is the default entry; selecting a model must never send.
  const models = await js(`(async () => {
    window.__stubCalls.enablePanelFixture();
    document.getElementById('nav-panel').click();
    await new Promise(r => setTimeout(r, 200));
    const visible = !document.getElementById('models-page').hidden;
    const rows = document.querySelectorAll('.model-row').length;
    const bars = [...document.querySelectorAll('#models-accounts progress')].map(p => p.value);
    const disabled = document.querySelector('.model-row:nth-child(2) button')?.disabled;
    window.__stubCalls.disablePanelFixture();
    await window.__modelsUi.refresh();
    const stale = document.getElementById('models-count').textContent.includes('上次数据') && [...document.querySelectorAll('.model-row button')].every(b=>b.disabled);
    window.__stubCalls.enablePanelFixture();
    await window.__modelsUi.refresh();
    window.__stubCalls.holdNextPanel();
    const delayed = window.__modelsUi.refresh();
    document.getElementById('nav-chat').click();
    document.getElementById('nav-panel').click();
    const waiting = document.getElementById('models-status').textContent.includes('等待上一轮');
    window.__stubCalls.releasePanel();
    await delayed;
    await new Promise(r=>setTimeout(r,100));
    const recovered = !document.querySelector('.model-row button').disabled;
    const input = document.getElementById('models-search'); input.value = '云端'; input.dispatchEvent(new Event('input'));
    const filtered = document.querySelectorAll('.model-row').length;
    input.value = ''; input.dispatchEvent(new Event('input'));
    document.getElementById('chat-consent').checked = true;
    document.querySelector('.model-row button').click();
    await new Promise(r => setTimeout(r, 100));
    const selected = document.getElementById('chat-model').value;
    const consent = document.getElementById('chat-consent').checked;
    const sent = window.__stubCalls.all().filter(c => c.api === 'dispatchSend').length;
    const chatVisible = !document.getElementById('chat-page').hidden && document.getElementById('models-page').hidden;
    const missing = await window.__chatUi.selectModel('removed-model');
    const missingSelection = document.getElementById('chat-model').value;
    document.getElementById('nav-panel').click();
    window.__memoryUi.page('memory');
    const hidden = document.getElementById('models-page').hidden;
    window.__stubCalls.disablePanelFixture();
    return {visible, rows, bars, disabled, stale, waiting, recovered, filtered, selected, consent, sent, chatVisible, missing, missingSelection, hidden};
  })()`);
  if (!models.visible || models.rows !== 2 || !models.disabled || models.filtered !== 1) throw new Error('模型总览或筛选异常：' + JSON.stringify(models));
  if (JSON.stringify(models.bars) !== '[0]') throw new Error('未知额度被错误画成数值');
  if (!models.stale || !models.waiting || !models.recovered) throw new Error('模型页断线或延迟响应处理异常：' + JSON.stringify(models));
  if (models.selected !== 'm-local' || models.consent || models.sent || !models.chatVisible || !models.hidden || models.missing !== false || models.missingSelection) throw new Error('模型选择/导航/同意状态异常：' + JSON.stringify(models));
  result.checks.push('models-native-overview-search-quota-zero');
  result.checks.push('models-selection-no-send-consent-reset');
  result.checks.push('models-offline-readonly-and-delayed-refresh');

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
    const optionsCollapsedInitially = !document.querySelector('#chat-options').open;
    const summaryInitially = (document.querySelector('#chat-options-summary') || {}).textContent || '';
    // 网页 AI：默认不打开，点按钮只出风险确认
    document.querySelector('#chat-webai').click();
    await new Promise(r => setTimeout(r, 200));
    const webaiDialog = document.querySelector('#webai-dialog');
    const webaiOpened = Boolean(webaiDialog && webaiDialog.open);
    const webaiRisks = document.querySelectorAll('#webai-dialog .webai-risks li').length;
    webaiDialog.querySelector('[data-close]').click();
    await new Promise(r => setTimeout(r, 150));
    const webaiClosed = !webaiDialog.open;
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
    if (document.querySelector('#chat-consent').checked) throw new Error('改变记忆发送范围后未撤销旧确认');
    document.querySelector('#chat-consent').checked = true;
    document.querySelector('#chat-consent').dispatchEvent(new Event('change'));
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
    // 多视角对比：两个模型 → 两张分支卡 → 可采纳其一
    document.querySelector('#chat-multi').checked = true;
    document.querySelector('#chat-multi').dispatchEvent(new Event('change'));
    const multiSel = document.querySelector('#chat-multi-models');
    const multiVisible = !multiSel.hidden;
    [...multiSel.options].forEach((option, index) => { option.selected = index < 2; });
    multiSel.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 150));
    document.querySelector('#chat-input').value = '多视角测试问题';
    document.querySelector('#chat-input').dispatchEvent(new Event('input'));
    const multiSendEnabled = !document.querySelector('#chat-send').disabled;
    document.querySelector('#chat-send').click();
    // 一组多模型在跑时要有停止入口；原来只在单聊 pendingTask 时显示。
    await new Promise(r => setTimeout(r, 250));
    const groupCancelVisible = !document.querySelector('#chat-cancel').hidden;
    const groupCancelLabel = document.querySelector('#chat-cancel').textContent;
    await new Promise(r => setTimeout(r, 3150));
    const multiBranches = document.querySelectorAll('.chat-branch').length;
    const adoptable = [...document.querySelectorAll('.chat-branch-foot button')].filter((b) => !b.disabled);
    if (adoptable.length) adoptable[0].click();
    await new Promise(r => setTimeout(r, 500));
    const lastSave = window.__stubCalls.all().filter(c => c.api === 'chatSave').pop();
    const multiAdopted = Boolean(lastSave && JSON.stringify(lastSave.input).includes('来自'));
    // 讨论模式：两个模型串行发言，每位能看到前面发言
    // 等上一轮多视角的并行分支完全结束，否则 multiGroupRunning 门控会拦住讨论（产品行为正确）。
    await new Promise(r => setTimeout(r, 2500));
    // 停止一组任务：要等任务真的派发出去再点，否则只测到「还没有派发」的空路径。
    const cancelCallsBefore = window.__stubCalls.all().filter(c => c.api === 'dispatchCancel').length;
    const groupSendBefore = window.__stubCalls.all().filter(c => c.api === 'dispatchSend').length;
    document.querySelector('#chat-consent').checked = true;
    document.querySelector('#chat-consent').dispatchEvent(new Event('change'));
    document.querySelector('#chat-input').value = '停止测试问题';
    document.querySelector('#chat-input').dispatchEvent(new Event('input'));
    document.querySelector('#chat-send').click();
    for (let i = 0; i < 40; i += 1) {
      await new Promise(r => setTimeout(r, 100));
      if (window.__stubCalls.all().filter(c => c.api === 'dispatchSend').length >= groupSendBefore + 2) break;
    }
    const cancelVisibleWhileRunning = !document.querySelector('#chat-cancel').hidden;
    document.querySelector('#chat-cancel').click();
    await new Promise(r => setTimeout(r, 500));
    const groupCancelCalls = window.__stubCalls.all().filter(c => c.api === 'dispatchCancel').length - cancelCallsBefore;
    const statusAfterCancel = document.querySelector('#chat-status').textContent;
    const cancelHiddenAfter = document.querySelector('#chat-cancel').hidden;
    document.querySelector('#chat-multi').checked = false;
    document.querySelector('#chat-multi').dispatchEvent(new Event('change'));
    document.querySelector('#chat-discussion').checked = true;
    document.querySelector('#chat-discussion').dispatchEvent(new Event('change'));
    [...multiSel.options].forEach((option, index) => { option.selected = index < 2; });
    multiSel.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 150));
    document.querySelector('#chat-consent').checked = true;
    document.querySelector('#chat-consent').dispatchEvent(new Event('change'));
    document.querySelector('#chat-input').value = '讨论测试问题';
    document.querySelector('#chat-input').dispatchEvent(new Event('input'));
    const discussionSendEnabled = !document.querySelector('#chat-send').disabled;
    document.querySelector('#chat-send').click();
    await new Promise(r => setTimeout(r, 9000));
    const discussionWho = [...document.querySelectorAll('#chat-log .chat-who')].filter((w) => w.textContent.includes('讨论 ·'));
    const discussionStageVisible = !document.querySelector('#chat-stage').hidden;
    const discussionAgents = document.querySelectorAll('.agent-node').length;
    const discussionDoneAgents = document.querySelectorAll('.agent-node[data-state="done"]').length;
    const adoptButtons = [...document.querySelectorAll('.chat-adopt')];
    const adoptCount = adoptButtons.length;
    if (adoptButtons.length) adoptButtons[0].click();
    await new Promise(r => setTimeout(r, 500));
    const lastSaveAfterAdopt = window.__stubCalls.all().filter(c => c.api === 'chatSave').pop();
    const adoptedDiscussion = Boolean(lastSaveAfterAdopt && JSON.stringify(lastSaveAfterAdopt.input).includes('讨论 ·'));
    const firstNode = document.querySelector('.agent-node');
    const firstModelId = firstNode ? firstNode.dataset.modelId : '';
    const petBefore = firstModelId ? localStorage.getItem('pet-avatar:' + firstModelId) : null;
    if (firstNode) firstNode.querySelector('.agent-avatar').click();
    const petAfter = firstModelId ? localStorage.getItem('pet-avatar:' + firstModelId) : null;
    const petSwitched = petAfter !== petBefore;
    // 桌宠陪聊：单模型对话也显示一个桌宠节点，状态跟随"思考→说话→已回复"
    document.querySelector('#chat-discussion').checked = false;
    document.querySelector('#chat-discussion').dispatchEvent(new Event('change'));
    document.querySelector('#chat-use-memory').checked = false;
    document.querySelector('#chat-use-memory').dispatchEvent(new Event('change'));
    document.querySelector('#chat-pet').checked = true;
    document.querySelector('#chat-pet').dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 150));
    document.querySelector('#chat-input').value = '桌宠陪聊测试';
    document.querySelector('#chat-input').dispatchEvent(new Event('input'));
    document.querySelector('#chat-consent').checked = true;
    document.querySelector('#chat-consent').dispatchEvent(new Event('change'));
    const petSendEnabled = !document.querySelector('#chat-send').disabled;
    window.__stubCalls.setSendOk(true);
    document.querySelector('#chat-send').click();
    await new Promise(r => setTimeout(r, 4500));
    const petStageVisible = !document.querySelector('#chat-stage').hidden;
    const petAgents = document.querySelectorAll('.agent-node').length;
    const petDoneAgents = document.querySelectorAll('.agent-node[data-state="done"]').length;
    const petStateText = (document.querySelector('.agent-node .agent-state') || {}).textContent || '';
    const petSummary = (document.querySelector('#chat-options-summary') || {}).textContent || '';
    const calls = window.__stubCalls.all().filter(c => c.api === 'dispatchSend');
    await new Promise(r => setTimeout(r, 800));
    const saves = window.__stubCalls.all().filter(c => c.api === 'chatSave');
    return { name, restored, restoredText, webaiOpened, webaiRisks, webaiClosed, sendEnabled, project: calls.length ? calls[calls.length - 1].input.project : null,
      saved: saves.length ? saves[saves.length - 1].input.length : 0, status: document.querySelector('#chat-status').textContent,
      optionsCollapsedInitially, summaryInitially, petSummary,
      chips: chips.length,
      dialogOpen: Boolean(dialog && dialog.open),
      dialogTitle: (document.querySelector('#chat-source-title') || {}).textContent,
      dialogBody: (document.querySelector('#chat-source-body') || {}).textContent,
      multiVisible, multiSendEnabled, multiBranches, multiAdopted,
      groupCancelVisible, groupCancelLabel, cancelVisibleWhileRunning, groupCancelCalls, statusAfterCancel, cancelHiddenAfter,
      discussionSendEnabled, discussionWho: discussionWho.length, discussionStageVisible, discussionAgents, discussionDoneAgents, adoptCount, adoptedDiscussion, petSwitched,
      petSendEnabled, petStageVisible, petAgents, petDoneAgents, petStateText,
      liveText, cursorOn, logCalls, finalText: finalText ? finalText.textContent : '', finalStreaming };
  })()`);
  if (chat.name !== 'fixture-workspace') throw new Error(`对话页项目名不对：${chat.name}`);
  if (chat.restored !== 1 || chat.restoredText !== '上次的第一句') throw new Error(`上次对话没有恢复：${JSON.stringify({ n: chat.restored, t: chat.restoredText })}`);
  if (chat.saved < 1) throw new Error('发消息后没有触发本机保存');
  if (!chat.webaiOpened) throw new Error('网页 AI 按钮没有弹出风险确认');
  if (chat.webaiRisks < 3) throw new Error(`风险条款太少：${chat.webaiRisks} 条`);
  if (!chat.webaiClosed) throw new Error('网页 AI 确认框关不掉');
  if (!chat.multiVisible) throw new Error('打开多视角后没有显示模型多选');
  if (!chat.multiSendEnabled) throw new Error('选了两个月模型后仍不能发送');
  if (chat.multiBranches !== 2) throw new Error(`分支数量不对：${chat.multiBranches}`);
  if (!chat.multiAdopted) throw new Error('采纳视角后没有写入历史');
  if (!chat.groupCancelVisible || chat.groupCancelLabel !== '停止这一组任务') {
    throw new Error(`多模型组运行时没有停止入口：visible=${chat.groupCancelVisible} label=${chat.groupCancelLabel}`);
  }
  if (!chat.cancelVisibleWhileRunning) throw new Error('任务派发出去后停止按钮反而消失了');
  if (chat.groupCancelCalls < 1) throw new Error('点了停止却没有发出任何取消请求');
  if (!/停止/.test(chat.statusAfterCancel)) throw new Error(`停止后没有如实反馈：${chat.statusAfterCancel}`);
  if (!chat.cancelHiddenAfter) throw new Error('停止后按钮没有复位');
  if (!chat.discussionSendEnabled) throw new Error('讨论模式选两个模型后仍不能发送');
  if (chat.discussionWho < 2) throw new Error(`讨论发言气泡不足：${chat.discussionWho}`);
  if (!chat.discussionStageVisible) throw new Error('讨论场景没有显示');
  if (chat.discussionAgents !== 2) throw new Error(`场景节点数不对：${chat.discussionAgents}`);
  if (chat.discussionDoneAgents !== 2) throw new Error(`发言完成节点数不对：${chat.discussionDoneAgents}`);
  if (chat.adoptCount < 1) throw new Error('讨论发言后没有出现「采纳这条继续」按钮');
  if (!chat.adoptedDiscussion) throw new Error('点击采纳后没有把发言写进历史');
  if (!chat.petSwitched) throw new Error('点击头像没有切换桌宠形象');
  if (!chat.petSendEnabled) throw new Error('桌宠陪聊勾选后仍不能发送');
  if (!chat.petStageVisible) throw new Error('桌宠陪聊没有显示场景');
  if (chat.petAgents !== 1) throw new Error(`桌宠陪聊节点数不对：${chat.petAgents}`);
  if (chat.petDoneAgents !== 1) throw new Error(`桌宠陪聊没有到已回复状态：${chat.petDoneAgents}`);
  if (!chat.petStateText.includes('已回复')) throw new Error(`桌宠陪聊完成文案不对：${chat.petStateText}`);
  if (!chat.optionsCollapsedInitially) throw new Error('发送选项折叠没有默认收起（工具栏仍过载）');
  if (chat.summaryInitially !== '普通对话') throw new Error(`初始摘要不对：${chat.summaryInitially}`);
  if (chat.petSummary !== '桌宠陪聊') throw new Error(`勾选桌宠后摘要没有更新：${chat.petSummary}`);
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
  await js("document.querySelector('#chat-multi').scrollIntoView({block:'center'}); true;");
  await new Promise((resolve) => setTimeout(resolve, 250));
  fs.writeFileSync(path.join(__dirname, 'chat-multi.png'), (await win.capturePage()).toPNG());
  await js("const s=document.querySelector('#chat-stage'); if(s)s.scrollIntoView({block:'center'}); true;");
  await new Promise((resolve) => setTimeout(resolve, 250));
  fs.writeFileSync(path.join(__dirname, 'chat-discussion.png'), (await win.capturePage()).toPNG());
  await new Promise((resolve) => setTimeout(resolve, 250));
  fs.writeFileSync(path.join(__dirname, 'chat-pet.png'), (await win.capturePage()).toPNG());
  if (!chat.sendEnabled) throw new Error('填完模型/内容/确认后发送按钮仍是禁用');
  if (chat.project !== PROJECT) throw new Error(`对话发送用了错误项目：${chat.project}`);
  result.checks.push('chat-send-uses-absolute-project');
  result.checks.push('chat-history-restored-and-saved');
  result.checks.push('webai-risk-gate-default-off');
  result.checks.push('chat-multi-perspective-branches');
  result.checks.push('chat-group-cancel-visible');
  result.checks.push('chat-group-cancel-dispatches');
  result.checks.push('chat-discussion-serial-turns');
  result.checks.push('chat-pet-single-companion');
  result.checks.push('chat-injection-source-dialog');
  result.checks.push('chat-streaming-partial-then-final');

  // 协作视图：在线模型、生态分区、右键菜单、交流对话流
  const stage = await js(`(async () => {
   try {
    ['m-local', 'm-cloud', 'm-deepseek'].forEach((id) => {
      localStorage.removeItem('pet-avatar:' + id);
      localStorage.removeItem('collab-pos:' + id);
    });
    localStorage.removeItem('collab-messages');
    document.querySelector('#nav-stage').click();
    await new Promise(r => setTimeout(r, 500));
    const visible = !document.querySelector('#stage-page').hidden;
    const othersHidden = ['chat-page', 'tasks-page', 'memory-page', 'models-page'].every((id) => document.getElementById(id).hidden);
    document.querySelector('#stage-refresh').click();
    await new Promise(r => setTimeout(r, 500));
    const boxes = [...document.querySelectorAll('#stage-models input[type="checkbox"]')];
    boxes.forEach((b) => { if (!b.checked) { b.checked = true; b.dispatchEvent(new Event('change', { bubbles: true })); } });
    await new Promise(r => setTimeout(r, 300));
    const pickCount = boxes.length;
    const checkedCount = boxes.filter((b) => b.checked).length;
    const offlineText = document.querySelector('#stage-offline').textContent;
    const fullName = boxes[0].parentElement.querySelector('span');
    const idComplete = fullName.textContent.length > 0 && fullName.textContent === fullName.title;
    const zones = document.querySelectorAll('.zone-label').length;
    const autoPlace = Boolean(document.querySelector('#stage-auto-place')?.checked);
    const noOutfitBar = document.querySelectorAll('.stage-actor .actor-outfits').length === 0;
    const sprites = document.querySelectorAll('.stage-actor .pet-strip').length;
    const sheets = [...document.querySelectorAll('.stage-actor .pet-strip')].map((x) => x.style.getPropertyValue('--pet-sheet'));
    const distinctSheets = new Set(sheets).size;
    const deepseekRoster = (document.querySelector('.stage-actor[data-model-id="m-deepseek"] .pet-strip') || { style: { getPropertyValue: () => '' } }).style.getPropertyValue('--pet-sheet').includes('deepseek-');
    const headerText = document.querySelector('#stage-page h1').textContent;
    const consentExists = Boolean(document.querySelector('#stage-consent'));
    const introHonest = document.querySelector('#stage-page .intro').textContent.includes('真的调用在线模型');
    const firstNode = document.querySelector('.stage-actor');
    const keyboardReady = firstNode.tabIndex === 0 && firstNode.getAttribute('role') === 'button'
      && (firstNode.getAttribute('aria-label') || '').includes('回车');
    const panelScroll = getComputedStyle(document.querySelector('.side-panel')).overflowY;
    const turnsScroll = getComputedStyle(document.querySelector('.collab-turns')).overflowY;
    const stopBtnExists = Boolean(document.querySelector('#stage-stop'));
    // 任意两个角色不允许矩形相交
    const rects = [...document.querySelectorAll('.stage-actor')].map((n) => n.getBoundingClientRect());
    let overlaps = 0;
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i], b = rects[j];
        if (a.left < b.right - 4 && b.left < a.right - 4 && a.top < b.bottom - 4 && b.top < a.bottom - 4) overlaps += 1;
      }
    }

    // 悬浮桌宠入口：这里只验证按钮确实调用了 petOpen 并更新状态文案。
    // 桩 preload 不会创建窗口，「窗口是否存在」由 verify:pet 真机验证。
    const hasPetOpen = Boolean(document.querySelector('#stage-pet-open'));
    const petOpenCallsBefore = window.__stubCalls.all().filter(c => c.api === 'petOpen').length;
    if (hasPetOpen) document.querySelector('#stage-pet-open').click();
    await new Promise(r => setTimeout(r, 200));
    const petStatus = document.querySelector('#stage-status').textContent;
    const petOpenDispatched = window.__stubCalls.all().filter(c => c.api === 'petOpen').length > petOpenCallsBefore;

    // 右键菜单：形象与配置全在这里
    const firstActor = document.querySelector('.stage-actor');
    const pickedId = firstActor.dataset.modelId;
    firstActor.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 160, clientY: 200 }));
    await new Promise(r => setTimeout(r, 150));
    const ctxOpen = !document.querySelector('#stage-context-menu').hidden;
    const ctxOutfits = document.querySelectorAll('#stage-context-menu .ctx-outfits .outfit').length;
    const ctxActions = document.querySelectorAll('#stage-context-menu [data-action]').length;
    const beforePet = localStorage.getItem('pet-avatar:' + pickedId);
    document.querySelectorAll('#stage-context-menu .ctx-outfits .outfit')[1].click();
    await new Promise(r => setTimeout(r, 150));
    const afterPet = localStorage.getItem('pet-avatar:' + pickedId);

    // 改 ID / 选中 / 双击戳一下（重画连线不能冲掉动作）
    firstActor.querySelector('.stage-actor-name').click();
    await new Promise(r => setTimeout(r, 120));
    const input = document.querySelector('.stage-name-input');
    input.value = '小鲸';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    const stored = localStorage.getItem('model-alias:' + pickedId);
    const renamed = firstActor.querySelector('.stage-actor-name').textContent;
    firstActor.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    const selected = document.querySelectorAll('.stage-actor.is-selected').length;
    firstActor.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 120));
    window.__stageUi.drawLinks();
    const pokeBubbles = [...document.querySelectorAll('.actor-poke-bubble')].filter((b) => !b.hidden).length;
    const pokeState = firstActor.querySelector('.stage-actor-avatar').dataset.avatarState;
    const pokeRow = (firstActor.querySelector('[data-sprite]') || { style: { getPropertyValue: () => '' } }).style.getPropertyValue('--pet-row');

    // 拖动固定位置
    const dragEl = document.querySelector('.stage-actor[data-model-id="m-cloud"]');
    const r = dragEl.getBoundingClientRect();
    const pe = (type, x, y) => new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y });
    dragEl.dispatchEvent(pe('pointerdown', r.left + 30, r.top + 30));
    dragEl.dispatchEvent(pe('pointermove', r.left + 95, r.top + 62));
    dragEl.dispatchEvent(pe('pointerup', r.left + 95, r.top + 62));
    await new Promise(r => setTimeout(r, 200));
    const savedPos = localStorage.getItem('collab-pos:m-cloud');

    // 一轮讨论：交付任务 → 1v1 → 1v多，对话框与交流记录
    window.__stubCalls.setSendOk(true);
    // 未勾确认时不得派发：先验证「点了也不会开始」，再勾选确认。
    document.querySelector('#stage-question').value = '协作视图测试问题';
    const consent = document.querySelector('#stage-consent');
    consent.checked = false; consent.dispatchEvent(new Event('change', { bubbles: true }));
    const askDisabledWithoutConsent = document.querySelector('#stage-ask').disabled;
    const turnsBeforeProbe = document.querySelectorAll('#stage-turns .collab-turn').length;
    document.querySelector('#stage-ask').click();
    await new Promise(r => setTimeout(r, 150));
    const noSendWithoutConsent = document.querySelectorAll('#stage-turns .collab-turn').length === turnsBeforeProbe
      && document.querySelector('#stage-ask').disabled;
    consent.checked = true; consent.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#stage-ask').click();
    for (let i = 0; i < 60; i += 1) {
      await new Promise(r => setTimeout(r, 500));
      if (!document.querySelector('#stage-ask').disabled) break;
    }
    const bubbles = [...document.querySelectorAll('.stage-actor-bubble')].filter((b) => !b.hidden).length;
    const links = document.querySelectorAll('#stage-links path.collab-link').length;
    const edgeTags = [...document.querySelectorAll('#stage-links text.collab-edge-tag')].map((n) => n.textContent).join('|');
    const turns = document.querySelectorAll('#stage-turns .collab-turn').length;
    const kinds = [...document.querySelectorAll('#stage-turns .turn-kind')].map((n) => n.textContent).join('|');
    const dialogueVisible = !document.querySelector('#stage-dialogue').hidden;
    const dialogueName = document.querySelector('#stage-dialogue-name').textContent;
    const savedHistory = JSON.parse(localStorage.getItem('collab-messages') || '[]').length;
    const statusRows = document.querySelectorAll('#stage-status-list .status-row').length;
    const actorNodes = document.querySelectorAll('.stage-actor').length;
    const refTags = [...document.querySelectorAll('#stage-turns .turn-ref')].map((n) => n.textContent);

    document.querySelector('#nav-chat').click();
    await new Promise(r => setTimeout(r, 300));
    const chatLabels = [...document.querySelectorAll('#chat-model option')].map((o) => o.textContent).join('|');
    localStorage.removeItem('model-alias:' + pickedId);
    localStorage.removeItem('pet-avatar:' + pickedId);
    localStorage.removeItem('collab-pos:m-cloud');
    return { visible, othersHidden, pickCount, checkedCount, offlineText, idComplete, zones, autoPlace, noOutfitBar,
      sprites, distinctSheets, deepseekRoster, headerText, overlaps, keyboardReady, consentExists, introHonest, askDisabledWithoutConsent, noSendWithoutConsent, panelScroll, turnsScroll, stopBtnExists, hasPetOpen, petStatus, petOpenDispatched, ctxOpen, ctxOutfits, ctxActions,
      beforePet, afterPet, stored, renamed, selected, pokeBubbles, pokeState, pokeRow, savedPos, bubbles, links,
      edgeTags, turns, kinds, dialogueVisible, dialogueName, savedHistory, statusRows, actorNodes, refTags, chatLabels };
   } catch (e) { return { jsError: String((e && e.stack) || e) }; }
  })()`);
  if (stage.jsError) throw new Error('stage 段异常：' + stage.jsError);
  if (!stage.visible) throw new Error('协作视图没有显示');
  if (!stage.othersHidden) throw new Error('协作视图打开时其他页面没有隐藏');
  if (stage.pickCount !== 3 || stage.checkedCount !== 3) throw new Error(`在线模型参与数不对：${stage.pickCount}/${stage.checkedCount}`);
  if (!stage.offlineText.includes('离线')) throw new Error(`离线模型没有单独列出：${stage.offlineText}`);
  if (!stage.idComplete) throw new Error('模型 ID 仍被截断或没有完整 title');
  if (stage.headerText.includes('舞台') || stage.headerText.includes('台上')) throw new Error(`标题还留着表演化文案：${stage.headerText}`);
  if (stage.zones !== 2 || !stage.autoPlace) throw new Error(`生态分区或自动归位缺失：${stage.zones}/${stage.autoPlace}`);
  if (!stage.noOutfitBar) throw new Error('角色下面还常驻着形象框');
  if (stage.sprites < 2 || stage.distinctSheets < 2) throw new Error(`默认角色不足或撞形象：${stage.sprites}/${stage.distinctSheets}`);
  if (!stage.deepseekRoster) throw new Error('DeepSeek 没有用对应的专属角色');
  if (stage.overlaps > 0) throw new Error(`角色矩形互相重叠：${stage.overlaps} 对`);
  if (!stage.keyboardReady) throw new Error('角色不能用键盘聚焦和选中');
  if (stage.panelScroll !== 'hidden' || stage.turnsScroll !== 'auto') throw new Error(`右侧面板滚动层级没收敛：${stage.panelScroll}/${stage.turnsScroll}`);
  if (!stage.stopBtnExists) throw new Error('本轮讨论没有停止入口');
  if (!stage.consentExists || !stage.introHonest) throw new Error('没有如实写明会真的调用模型');
  if (!stage.askDisabledWithoutConsent || !stage.noSendWithoutConsent) {
    throw new Error(`未勾确认时仍能派发：disabled=${stage.askDisabledWithoutConsent} noSend=${stage.noSendWithoutConsent} consent=${stage.consentExists}`);
  }
  if (!stage.hasPetOpen || !stage.petOpenDispatched || !stage.petStatus.includes('悬浮到桌面')) {
    throw new Error(`悬浮桌宠入口无效：按钮=${stage.hasPetOpen} 已派发=${stage.petOpenDispatched} 状态=${stage.petStatus}`);
  }
  if (!stage.ctxOpen || stage.ctxOutfits < 2 || stage.ctxActions < 6) throw new Error(`右键菜单不完整：${stage.ctxOpen}/${stage.ctxOutfits}/${stage.ctxActions}`);
  if (stage.afterPet === stage.beforePet) throw new Error('右键换形象没有存到本机');
  if (stage.stored !== '小鲸' || stage.renamed !== '小鲸') throw new Error('改名没有生效');
  if (stage.selected !== 1) throw new Error(`单击没有选中唯一角色：${stage.selected}`);
  if (stage.pokeBubbles !== 1 || stage.pokeState !== 'poke' || stage.pokeRow !== '4') throw new Error(`被戳动作被冲掉：${stage.pokeBubbles}/${stage.pokeState}/${stage.pokeRow}`);
  if (!stage.savedPos) throw new Error('拖动后位置没有存到本机');
  if (stage.bubbles < 1 || stage.links < 1) throw new Error(`讨论后没有摘要或连线：${stage.bubbles}/${stage.links}`);
  if (!stage.edgeTags.includes('1v1') && !stage.edgeTags.includes('1v多') && !stage.edgeTags.includes('回执')) throw new Error(`连线没标交流类型：${stage.edgeTags}`);
  if (stage.turns < 4) throw new Error(`交流记录条数不对：${stage.turns}`);
  if (!stage.kinds.includes('上级交付') || !stage.kinds.includes('1v1')) throw new Error(`交流类型缺失：${stage.kinds}`);
  if (!stage.dialogueVisible || !stage.dialogueName) throw new Error('galgame 对话框没有显示');
  if (stage.savedHistory < 4) throw new Error(`交流记录没有持久化：${stage.savedHistory}`);
  if (stage.statusRows < 2) throw new Error('模型状态列表为空');
  if (stage.statusRows !== stage.actorNodes) throw new Error(`状态行重复或缺失：${stage.statusRows}/${stage.actorNodes}`);
  if (!stage.refTags.some((t) => t.includes('参考'))) throw new Error('交流记录里没有参考条数');
  if (!stage.chatLabels.includes('小鲸')) throw new Error(`改 ID 后对话页下拉没同步：${stage.chatLabels}`);
  result.checks.push('collab-online-only', 'collab-ecosystem-zones', 'collab-context-menu', 'collab-dialogue-flow', 'pet-open-ipc-dispatch', 'collab-reference-graph');

  // 侧栏 MIT 图标 + 协作舱状态情绪标：真机确认图片真的解码了，不是只查 DOM 里有 <img>。
  const vendorVisual = await js(`(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const imgs = [...document.querySelectorAll('img.vendor-ico')];
    const states = [];
    for (const img of imgs) {
      try { await img.decode(); } catch (e) {}
      states.push({ src: img.getAttribute('src') || '', width: img.naturalWidth, complete: img.complete,
        boxW: img.offsetWidth, opacity: Number(getComputedStyle(img).opacity) });
    }
    document.querySelector('#nav-stage').click();
    await wait(400);
    const actor = document.querySelector('.stage-actor');
    const id = actor ? actor.dataset.modelId : null;
    const mood = actor ? actor.querySelector('.actor-mood') : null;
    // 前面的用例刚跑完一轮讨论，角色可能停在 done/speaking；先显式复位再测，
    // 否则「待机时隐藏」这条断言依赖上一段测试的残留状态。
    if (id && window.__stageUi) window.__stageUi.setActorState(id, 'waiting');
    await wait(200);
    const before = mood ? { hidden: mood.hidden, mood: mood.dataset.mood || '' } : null;
    if (id && window.__stageUi) window.__stageUi.setActorState(id, 'thinking');
    await wait(300);
    let shown = null, moodRect = null;
    if (mood) {
      try { await mood.decode(); } catch (e) {}
      const cs = getComputedStyle(mood), r = mood.getBoundingClientRect();
      moodRect = { x: r.x, y: r.y, w: r.width, h: r.height };
      shown = { hidden: mood.hidden, mood: mood.dataset.mood || '', width: mood.naturalWidth,
        src: mood.getAttribute('src') || '', opacity: Number(cs.opacity), boxW: mood.offsetWidth };
    }
    // 故意停在 thinking：Node 侧要在这个状态下抓像素，之后再单独复位。
    return { count: imgs.length, states, before, shown, moodRect, id, innerWidth: window.innerWidth };
  })()`);
  if (vendorVisual.count < 12) throw new Error(`侧栏图标只有 ${vendorVisual.count} 个`);
  // 除了解码，还要真的「看得见」：有尺寸、非透明。隐藏窗口里 CSS 动画不推进，
  // 从 opacity:0 起步的入场动画会永远停在透明帧，只查 DOM/解码会漏掉这种缺陷。
  const badIcons = vendorVisual.states.filter((s) =>
    !(s.complete && s.width > 0 && s.src.startsWith('assets/vendor/') && s.boxW >= 12 && s.opacity > 0.5));
  if (badIcons.length) throw new Error(`侧栏图标未解码、不可见或引用越界：${JSON.stringify(badIcons)}`);
  result.checks.push('sidebar-vendor-icons-decoded');
  if (!vendorVisual.before || !vendorVisual.shown) throw new Error('协作舱缺少状态情绪标');
  if (!vendorVisual.before.hidden) throw new Error('待机状态不该显示情绪标');
  if (vendorVisual.shown.hidden || vendorVisual.shown.mood !== 'thinking' || vendorVisual.shown.width <= 0) {
    throw new Error(`思考态情绪标没显示或没解码：${JSON.stringify(vendorVisual.shown)}`);
  }
  if (!vendorVisual.shown.src.startsWith('assets/vendor/fluent-emoji/')) {
    throw new Error(`情绪标不是本地 Fluent Emoji：${vendorVisual.shown.src}`);
  }
  if (!(vendorVisual.shown.opacity > 0.99) || vendorVisual.shown.boxW < 12) {
    throw new Error(`情绪标解码了却不可见（动画停在透明帧？）：${JSON.stringify(vendorVisual.shown)}`);
  }

  // 像素实证：DOM「有尺寸 + opacity:1 + 已解码」仍不等于屏幕上有颜色
  // （换成灰白表情、或图片只画出白底，这些断言全都会过）。
  // capturePage 的位图是设备像素，getBoundingClientRect 是 CSS 像素，必须按 DPR 换算，
  // 否则采样到的完全是别的区域，之前就因此得到过一组看似合理、实则无关的数字。
  // capturePage 可能交回合成器缓存的上一帧：DOM 里表情已解码、opacity=1，
  // 位图里却还是没有颜色的旧画面（实测过 0/441 全灰度）。阈值一个都不放宽，
  // 只给合成器几次提交机会；每次采样值都留着，真失败时能看出是「没上屏」还是「位置算错」。
  const sampleMood = async () => {
    const shot = await win.capturePage();
    const bmp = shot.toBitmap();
    const bmpSize = shot.getSize();
    const dpr = bmpSize.width / vendorVisual.innerWidth;
    const mr = vendorVisual.moodRect;
    let colorful = 0, opaque = 0;
    if (mr && mr.w > 0) {
      for (let y = Math.round(mr.y * dpr); y < Math.round((mr.y + mr.h) * dpr); y += 1) {
        for (let x = Math.round(mr.x * dpr); x < Math.round((mr.x + mr.w) * dpr); x += 1) {
          if (x < 0 || y < 0 || x >= bmpSize.width || y >= bmpSize.height) continue;
          const i = (y * bmpSize.width + x) * 4;
          const b = bmp[i], g = bmp[i + 1], r = bmp[i + 2], a = bmp[i + 3];
          if (a < 80) continue;
          opaque += 1;
          if (Math.max(r, g, b) - Math.min(r, g, b) > 40) colorful += 1;
        }
      }
    }
    return { colorful, opaque, dpr };
  };
  const moodSamples = [];
  let moodSample = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await new Promise((r) => setTimeout(r, 120)); // 等一帧合成提交再抓
    moodSample = await sampleMood();
    moodSamples.push({ ...moodSample });
    const ratio = moodSample.opaque ? moodSample.colorful / moodSample.opaque : 0;
    if (moodSample.opaque >= 100 && ratio >= 0.12) break;
  }
  const moodRatio = moodSample.opaque ? moodSample.colorful / moodSample.opaque : 0;
  if (moodSample.opaque < 100 || moodRatio < 0.12) {
    throw new Error(`情绪标区域没有可见彩色像素：${moodSamples.map((s) => `${s.colorful}/${s.opaque}`).join(' → ')} (${moodRatio.toFixed(3)}), dpr=${moodSample.dpr.toFixed(2)}`);
  }
  result.checks.push('collab-mood-visible-pixels');

  const moodReset = await js(`(async () => {
    window.__stageUi.setActorState(${JSON.stringify(vendorVisual.id)}, 'waiting');
    await new Promise(r => setTimeout(r, 150));
    const m = document.querySelector('.stage-actor .actor-mood');
    return { hidden: m ? m.hidden : null, mood: m ? (m.dataset.mood || '') : null };
  })()`);
  if (!moodReset.hidden) throw new Error(`回到待机后情绪标没隐藏：${JSON.stringify(moodReset)}`);
  result.checks.push('collab-mood-follows-state');

  // 本轮 UI 复查的四条回归：性能、对话框、历史一致性、不可逆操作确认
  const ux = await js(`(async () => {
   try {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    document.querySelector('#nav-stage').click();
    await wait(400);

    // 拖拽时 SVG 节点不能被 replaceChildren 重建（否则 SMIL 光点每帧重播 = 闪）
    const pathBefore = document.querySelector('#stage-links path.collab-link');
    const dragEl = document.querySelector('.stage-actor[data-model-id="m-deepseek"]');
    let samePath = false;
    if (pathBefore && dragEl) {
      const r = dragEl.getBoundingClientRect();
      const pe = (t, x, y) => new PointerEvent(t, { bubbles: true, button: 0, pointerId: 2, clientX: x, clientY: y });
      dragEl.dispatchEvent(pe('pointerdown', r.left + 30, r.top + 30));
      dragEl.dispatchEvent(pe('pointermove', r.left + 70, r.top + 45));
      dragEl.dispatchEvent(pe('pointerup', r.left + 70, r.top + 45));
      await wait(180);
      samePath = document.querySelector('#stage-links path.collab-link') === pathBefore;
    }

    // 对话框点一下就收起，不再一直杵在画布上
    const dlg = document.querySelector('#stage-dialogue');
    dlg.hidden = false;
    dlg.click();
    await wait(100);
    const dlgHidden = dlg.hidden;

    // 重建舞台不能偷偷丢掉内存里的交流历史（否则刷新后旧记录幽灵复活）
    const turnsBefore = document.querySelectorAll('#stage-turns .collab-turn').length;
    const storedBefore = JSON.parse(localStorage.getItem('collab-messages') || '[]').length;
    window.__stageUi.buildStage();
    await wait(300);
    const turnsAfter = document.querySelectorAll('#stage-turns .collab-turn').length;
    const storedAfter = JSON.parse(localStorage.getItem('collab-messages') || '[]').length;
    const rowsAfter = document.querySelectorAll('#stage-status-list .status-row').length;
    const nodesAfter = document.querySelectorAll('.stage-actor').length;

    // 从历史反推引用边：重建舞台后记录与连线必须同时存在
    const edgesAfterRebuild = document.querySelectorAll('#stage-links path.collab-link').length;

    // 待机小动作：手动触发一次，角色的动作行应切到招手(3)或跳跃(4)，而不是永远停在第 0 行
    window.__stageUi.idlePoke();
    await wait(150);
    const idleRows = [...document.querySelectorAll('.pet-sprite')].map((n) => n.style.getPropertyValue('--pet-row'));
    const idleAnimated = idleRows.includes('3') || idleRows.includes('4');

    // 菜单键盘可达：Shift+F10 打开后焦点应落在菜单内，Esc 归还角色
    const kbActor = document.querySelector('.stage-actor');
    kbActor.focus();
    kbActor.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
    await wait(120);
    const menuFocused = document.querySelector('#stage-context-menu').contains(document.activeElement);
    const menuRole = document.querySelector('#stage-context-menu').getAttribute('role');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(100);
    const focusReturned = document.activeElement === kbActor;

    // 完整形象库：右键菜单里点进去必须真的打开，而且整体在视口内
    // （曾经因为「先建库再关菜单」，刚建好的库被 closeContextMenu 当场删掉）。
    const libActor = document.querySelector('.stage-actor');
    libActor.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 220, clientY: 260 }));
    await wait(150);
    const libBtn = document.querySelector('#stage-context-menu [data-action="library"]');
    const libLabel = libBtn ? libBtn.textContent : '';
    if (libBtn) libBtn.click();
    await wait(300);
    const picker = document.querySelector('.outfit-picker');
    const pr = picker ? picker.getBoundingClientRect() : null;
    const libState = {
      label: libLabel,
      opened: Boolean(picker),
      items: picker ? picker.querySelectorAll('.outfit-item').length : 0,
      inViewport: pr ? (pr.left >= -1 && pr.top >= -1 && pr.right <= innerWidth + 1 && pr.bottom <= innerHeight + 1) : false,
      notCenterShifted: pr ? Math.abs((pr.left + pr.right) / 2 - (libActor.getBoundingClientRect().left + libActor.getBoundingClientRect().width / 2)) < 40 : false,
    };
    if (picker) picker.remove();

    // 序列帧必须按「有效帧数」播：素材 8 列里 idle 只有 6 帧、wave 只有 4 帧。
    // 一旦退回写死 steps(8)，动画会扫到空白格，角色每轮消失——用户报的就是这个「闪」。
    const strip0 = document.querySelector('.pet-strip');
    const sprite0 = strip0 ? strip0.closest('.pet-sprite') : null;
    const stripFrames = sprite0 ? sprite0.style.getPropertyValue('--pet-frames') : '';
    const stripTiming = strip0 ? getComputedStyle(strip0).animationTimingFunction : '';
    const stripDur = strip0 ? getComputedStyle(strip0).animationDuration : '';

    // 降低动效：开起来后循环序列帧与呼吸动画都必须停，用于排查闪烁
    const root = document.documentElement;
    root.dataset.reduceMotion = '1';
    await wait(120);
    const stripAnim = getComputedStyle(document.querySelector('.pet-strip')).animationName;
    const breatheAnim = getComputedStyle(document.querySelector('.stage-actor-avatar')).animationName;
    root.dataset.reduceMotion = '0';
    await wait(80);
    const stripAnimBack = getComputedStyle(document.querySelector('.pet-strip')).animationName;

    // 页内小窗：工位网格 / 休息地毯 / 分隔线都不该残留
    const petToggle = document.querySelector('#stage-pet');
    petToggle.checked = true; petToggle.dispatchEvent(new Event('change'));
    await wait(150);
    // 小窗 176×200 放不下家具：房间层必须整体隐藏（旧的 ::before/::after 装饰已由房间层取代）
    const petDecor = getComputedStyle(document.querySelector('#stage-room')).display;
    const dividerHidden = getComputedStyle(document.querySelector('.zone-divider')).display;
    petToggle.checked = false; petToggle.dispatchEvent(new Event('change'));
    await wait(150);

    // 清空历史是二次确认：第一次只进入确认态，第二次才真删
    const actor = document.querySelector('.stage-actor');
    actor.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 240 }));
    await wait(120);
    const clearBtn = document.querySelector('#stage-context-menu [data-action="clear"]');
    clearBtn.click();
    await wait(120);
    const afterFirst = JSON.parse(localStorage.getItem('collab-messages') || '[]').length;
    const armedLabel = clearBtn.querySelector('span').textContent;
    clearBtn.click();
    await wait(150);
    const afterSecond = JSON.parse(localStorage.getItem('collab-messages') || '[]').length;
    return { samePath, dlgHidden, turnsBefore, turnsAfter, storedBefore, storedAfter, rowsAfter, nodesAfter, edgesAfterRebuild, idleRows, idleAnimated, stripFrames, stripTiming, stripDur, libState, stripAnim, breatheAnim, stripAnimBack, menuFocused, menuRole, focusReturned, petDecor, dividerHidden, afterFirst, afterSecond, armedLabel };
   } catch (e) { return { jsError: String((e && e.stack) || e) }; }
  })()`);
  if (ux.jsError) throw new Error('UX 回归段异常：' + ux.jsError);
  if (!ux.samePath) throw new Error('拖拽时连线 SVG 被重建了（会闪）');
  if (!ux.dlgHidden) throw new Error('点对话框没有收起');
  if (ux.turnsBefore < 4 || ux.turnsAfter !== ux.turnsBefore || ux.storedAfter !== ux.storedBefore) {
    throw new Error(`重建舞台丢了历史：${JSON.stringify(ux)}`);
  }
  if (ux.rowsAfter !== ux.nodesAfter) throw new Error(`重建舞台后状态行重复：${ux.rowsAfter}/${ux.nodesAfter}`);
  if (ux.edgesAfterRebuild < 1) throw new Error('重建舞台后历史交流没有对应连线');
  if (!ux.idleAnimated) throw new Error(`待机小动作没生效，动作行一直是：${ux.idleRows}`);
  // 关系断言：steps 的分母、动画时长、位移范围都必须跟当前动作的有效帧数一致。
  // 只认「三者对齐」，不锁死具体帧数——不同状态对应不同动作（待机 6 帧、已发言 4 帧等）。
  if (!ux.libState.opened) throw new Error(`完整形象库打不开：${JSON.stringify(ux.libState)}`);
  if (ux.libState.items < 6) throw new Error(`形象库条目太少：${ux.libState.items}`);
  if (!ux.libState.inViewport) throw new Error(`形象库超出视口被裁：${JSON.stringify(ux.libState)}`);
  if (!ux.libState.notCenterShifted) throw new Error(`形象库没有对齐角色（transform 残留）：${JSON.stringify(ux.libState)}`);
  if (!['4', '5', '6', '8'].includes(ux.stripFrames)) throw new Error(`帧数不是任何动作的有效值：${ux.stripFrames}`);
  const stepMatch = String(ux.stripTiming).match(/steps\((\d+)/);
  if (!stepMatch || stepMatch[1] !== ux.stripFrames) throw new Error(`步进没按帧数走：${ux.stripTiming} vs ${ux.stripFrames}`);
  // 浏览器会把 1320ms 规范成 1.32s，统一按秒比。
  const durSec = parseFloat(ux.stripDur);
  if (!(Math.abs(durSec - Number(ux.stripFrames) * 0.22) < 0.011)) throw new Error(`时长没按帧数算：${ux.stripDur}（应为 ${Number(ux.stripFrames) * 0.22}s）`);
  if (ux.stripAnim !== 'none' || ux.breatheAnim !== 'none') throw new Error(`降低动效没停掉动画：${ux.stripAnim}/${ux.breatheAnim}`);
  if (ux.stripAnimBack === 'none') throw new Error('关掉降低动效后序列帧没有恢复');
  if (!ux.menuFocused || ux.menuRole !== 'menu') throw new Error(`菜单没有接管键盘焦点：${ux.menuFocused}/${ux.menuRole}`);
  if (!ux.focusReturned) throw new Error('Esc 没有把焦点还给角色');
  if (ux.petDecor !== 'none' || ux.dividerHidden !== 'none') throw new Error(`页内小窗残留分区装饰：${ux.petDecor}/${ux.dividerHidden}`);
  if (ux.afterFirst !== ux.storedBefore || !ux.armedLabel.includes('再点一次')) throw new Error(`清空没有二次确认：${JSON.stringify(ux)}`);
  if (ux.afterSecond !== 0) throw new Error(`二次确认后没有清空历史：${ux.afterSecond}`);
  result.checks.push('collab-no-link-rebuild', 'collab-dialogue-dismiss', 'collab-history-consistency', 'collab-clear-confirm', 'collab-consent-gate', 'collab-menu-keyboard', 'collab-pet-mode-clean', 'collab-idle-motion', 'collab-reduce-motion', 'collab-sprite-frame-count', 'collab-outfit-library-opens');

  // 房间层：6 件家具各有一块头顶 ID 条，不能被画布裁掉、不能被家具的深度排序吞掉，
  // 且「有人坐上去就亮灯」。PC-01 曾被机柜 SVG 盖住，这几条是那次回归。
  const roomCheck = await js(`(async () => {
    document.getElementById('nav-stage').click();
    await new Promise(r => setTimeout(r, 250));
    const host = document.getElementById('stage-room');
    const fr = host.getBoundingClientRect();
    const plates = [...host.querySelectorAll('.room-plate')];
    const props = [...host.querySelectorAll('.room-prop')];
    const clipped = plates.filter((p) => {
      const r = p.getBoundingClientRect();
      return r.width === 0 || r.left < fr.left - 1 || r.right > fr.right + 1 || r.top < fr.top - 1 || r.bottom > fr.bottom + 1;
    }).map((p) => p.textContent.trim());
    const minZ = Math.min(...plates.map((p) => Number(getComputedStyle(p).zIndex)));
    const maxPropZ = Math.max(...props.map((p) => Number(getComputedStyle(p).zIndex)));
    // 编号必须挂在家具头顶：底边落在家具顶沿附近，而不是贴在地板上。
    const overhead = plates.every((p) => {
      const prop = props.find((x) => x.dataset.propId === p.dataset.propId);
      if (!prop) return false;
      const pr = prop.getBoundingClientRect(), rr = p.getBoundingClientRect();
      return rr.bottom >= pr.top - 4 && rr.bottom <= pr.top + 40;
    });
    // 更严的一条：底边要贴住 SVG 里实际画出来的物体顶（getBBox），不是 SVG 盒子上沿。
    // 目测曾让机柜标签高出 29px 挂在墙上，这条专防回归。
    const headGap = plates.every((p) => {
      const prop = props.find((x) => x.dataset.propId === p.dataset.propId);
      const svg = prop && prop.querySelector('svg');
      if (!svg || typeof svg.getBBox !== 'function') return false;
      const sr = svg.getBoundingClientRect(), rr = p.getBoundingClientRect();
      const scale = sr.height / (svg.viewBox.baseVal.height || sr.height || 1);
      const visualTop = sr.top + svg.getBBox().y * scale;
      return Math.abs(rr.bottom - (visualTop - 8)) <= 10;
    });
    window.__room.setUsage({});
    const allOff = plates.every((p) => p.dataset.used === '0');
    window.__room.setUsage({ 'desk-a': 1 });
    const deskOn = host.querySelector('.room-plate[data-prop-id="desk-a"]').dataset.used === '1';
    const othersOff = plates.filter((p) => p.dataset.propId !== 'desk-a').every((p) => p.dataset.used === '0');
    // 角色头顶代号牌：数量对齐、位于头像上方、状态灯跟着角色状态走。
    const liveActors = [...document.querySelectorAll('.stage-actor')].filter((a) => !a.hidden);
    const tags = liveActors.map((a) => a.querySelector('.actor-id-tag'));
    const tagCodes = tags.map((t) => t && t.textContent.trim());
    const tagAbove = tags.every((t, i) => t
      && t.getBoundingClientRect().bottom <= liveActors[i].querySelector('.stage-actor-avatar').getBoundingClientRect().top + 2);
    window.__stageUi.setActorState('m-local', 'thinking');
    const tag = document.querySelector('.stage-actor[data-model-id="m-local"] .actor-id-tag');
    const syncState = Boolean(tag) && tag.dataset.state === 'thinking';
    window.__stageUi.setActorState('m-local', 'waiting');
    await window.__stageUi.applyEcosystem(true);
    return { props: props.length, plates: plates.length, codes: plates.map((p) => p.textContent.trim()), clipped,
      minZ, maxPropZ, overhead, headGap, allOff, deskOn, othersOff,
      actors: liveActors.length, tagCount: tags.filter(Boolean).length, tagCodes, tagAbove, syncState };
  })()`);
  if (roomCheck.props !== 6 || roomCheck.plates !== 6) throw new Error(`设施铭牌数量不对：${JSON.stringify(roomCheck)}`);
  if (roomCheck.clipped.length) throw new Error(`铭牌被画布裁掉：${JSON.stringify(roomCheck.clipped)}`);
  if (!(roomCheck.minZ > roomCheck.maxPropZ)) throw new Error(`铭牌 z 低于家具，会被盖住：${roomCheck.minZ}/${roomCheck.maxPropZ}`);
  if (!roomCheck.overhead) throw new Error(`设施编号没挂在家具头顶：${JSON.stringify(roomCheck)}`);
  if (!roomCheck.headGap) throw new Error(`设施编号离家具实际顶部太远：${JSON.stringify(roomCheck)}`);
  if (!roomCheck.allOff || !roomCheck.deskOn || !roomCheck.othersOff) throw new Error(`占用灯不跟座位走：${JSON.stringify(roomCheck)}`);
  if (roomCheck.tagCount !== roomCheck.actors || !roomCheck.tagCodes.every((c) => c && c.length <= 12)) throw new Error(`角色头顶代号牌数量/内容不对：${JSON.stringify(roomCheck)}`);
  if (!roomCheck.tagAbove) throw new Error(`角色代号牌没挂在头像上方：${JSON.stringify(roomCheck)}`);
  if (!roomCheck.syncState) throw new Error(`角色代号牌状态没跟着角色走：${JSON.stringify(roomCheck)}`);
  result.checks.push('room-facility-plates', 'room-plates-not-clipped', 'room-plates-overhead', 'room-plate-head-gap', 'room-plate-occupancy',
    'collab-actor-id-tags', 'collab-actor-id-overhead', 'collab-actor-id-state-sync');

  // 设施详情浮层：铭牌真的可点（elementFromPoint 命中，不是只改了 CSS）、
  // 面板锚在牌子上且拖得动、内容只来自真实座位与本机时间、操作真的接到已有能力。
  const facilityCheck = await js(`(async () => {
    document.getElementById('nav-stage').click();
    await new Promise(r => setTimeout(r, 200));
    const floor = document.getElementById('stage-floor');
    const panel = document.getElementById('facility-panel');
    const wrap = panel.parentElement;
    const plates = [...document.querySelectorAll('.room-plate')];
    const pe = getComputedStyle(plates[0]).pointerEvents;
    const cursor = getComputedStyle(plates[0]).cursor;
    const hit = plates.filter((p) => {
      const r = p.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return el && (el === p || p.contains(el));
    }).length;

    const target = document.querySelector('.room-plate[data-prop-id="desk-a"]');
    target.click();
    const opened = !panel.hidden;
    const headText = panel.querySelector('.facility-name')?.textContent || '';
    const clockText = panel.querySelector('.facility-clock')?.textContent || '';
    const bodyText = panel.querySelector('.facility-body')?.textContent || '';
    const info = window.__stageUi.facilityInfo('desk-a');
    const namesMatch = info.occupants.length > 0 && info.occupants.every((o) => bodyText.includes(o.name));
    const noFakeMetrics = !/%|效率|产出|心情|收益|产能/.test(bodyText + headText);
    const wr = wrap.getBoundingClientRect(), pr = panel.getBoundingClientRect();
    const inWrap = pr.left >= wr.left - 1 && pr.right <= wr.right + 1 && pr.top >= wr.top - 1 && pr.bottom <= wr.bottom + 1;
    const plateRect = target.getBoundingClientRect();
    const anchored = Math.abs((pr.left + pr.width / 2) - (plateRect.left + plateRect.width / 2)) < 130;

    const head = panel.querySelector('.facility-head');
    const beforeLeft = parseFloat(panel.style.left) || 0;
    const beforeTop = parseFloat(panel.style.top) || 0;
    const mk = (type, x, y) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 7 });
    const hr = head.getBoundingClientRect();
    head.dispatchEvent(mk('pointerdown', hr.left + 20, hr.top + 10));
    panel.dispatchEvent(mk('pointermove', hr.left + 60, hr.top + 40));
    panel.dispatchEvent(mk('pointerup', hr.left + 60, hr.top + 40));
    const moved = (parseFloat(panel.style.left) || 0) !== beforeLeft || (parseFloat(panel.style.top) || 0) !== beforeTop;
    const pr2 = panel.getBoundingClientRect();
    const stillInWrap = pr2.left >= wr.left - 1 && pr2.right <= wr.right + 1 && pr2.top >= wr.top - 1 && pr2.bottom <= wr.bottom + 1;

    const dayparts = ['morning', 'day', 'dusk', 'night'];
    const daypartOk = dayparts.includes(floor.dataset.daypart)
      && floor.dataset.daypart === window.__stageUi.daypartOf(new Date().getHours());
    const clockOk = /^本机 \\d{2}:\\d{2}/.test(clockText);

    const actorCountLive = document.querySelectorAll('.stage-actor:not([hidden])').length;
    const activities = [...document.querySelectorAll('.stage-actor:not([hidden]) .actor-id-tag')]
      .map((t) => t.querySelector('.actor-activity')).filter(Boolean).length;
    window.__stageUi.setActorState('m-local', 'thinking');
    const bar = document.querySelector('.stage-actor[data-model-id="m-local"] .actor-activity');
    const busyBar = bar ? Number(getComputedStyle(bar, '::before').opacity) : -1;
    window.__stageUi.setActorState('m-local', 'waiting');
    const idleBar = bar ? Number(getComputedStyle(bar, '::before').opacity) : -1;

    const pokeBtn = panel.querySelector('button[data-action="poke"]');
    let poked = null;
    if (pokeBtn) {
      pokeBtn.click();
      poked = Boolean(document.querySelector('.stage-actor:not([hidden]) .actor-poke-bubble:not([hidden])'));
    }
    panel.querySelector('.facility-close').click();
    const closed = panel.hidden && !document.querySelector('.room-plate.is-open');
    window.__stageUi.setActorState('m-local', 'waiting');
    await window.__stageUi.applyEcosystem(true);
    return { pe, cursor, hit, opened, headText, clockText, occupantCount: info.occupants.length,
      namesMatch, noFakeMetrics, inWrap, anchored, moved, stillInWrap, daypartOk, clockOk,
      activities, actorCountLive, busyBar, idleBar, poked, closed };
  })()`);
  if (facilityCheck.pe !== 'auto' || facilityCheck.cursor !== 'pointer' || facilityCheck.hit < 1) {
    throw new Error(`设施铭牌不可点：${JSON.stringify(facilityCheck)}`);
  }
  if (!facilityCheck.opened || !facilityCheck.headText.includes('PC-01')) throw new Error(`点铭牌没打开设施详情：${JSON.stringify(facilityCheck)}`);
  if (!facilityCheck.namesMatch || !facilityCheck.noFakeMetrics) throw new Error(`设施详情不是真实占用或混进了编造指标：${JSON.stringify(facilityCheck)}`);
  if (!facilityCheck.inWrap || !facilityCheck.anchored) throw new Error(`设施面板没锚在代号牌上或跑出画布：${JSON.stringify(facilityCheck)}`);
  if (!facilityCheck.moved || !facilityCheck.stillInWrap) throw new Error(`设施面板拖不动或拖出画布：${JSON.stringify(facilityCheck)}`);
  if (!facilityCheck.daypartOk || !facilityCheck.clockOk) throw new Error(`时段光照 / 本机时间不对：${JSON.stringify(facilityCheck)}`);
  if (facilityCheck.activities !== facilityCheck.actorCountLive) throw new Error(`头顶状态条数量不对：${JSON.stringify(facilityCheck)}`);
  if (!(facilityCheck.busyBar > 0) || facilityCheck.idleBar !== 0) throw new Error(`状态条没跟真实状态走：${JSON.stringify(facilityCheck)}`);
  if (!facilityCheck.poked || !facilityCheck.closed) throw new Error(`面板操作没接到已有能力或关不掉：${JSON.stringify(facilityCheck)}`);
  result.checks.push('facility-plates-clickable', 'facility-panel-opens', 'facility-panel-real-occupancy',
    'facility-panel-anchored', 'facility-panel-draggable', 'daypart-follows-clock',
    'actor-activity-follows-state', 'facility-actions-wired', 'facility-panel-closes');

  // 留两张图：默认关系图、桌宠模式。
  const spriteReady = await js(`(async () => {
    ['m-local', 'm-cloud', 'm-deepseek'].forEach((id) => {
      localStorage.removeItem('pet-avatar:' + id);
      localStorage.removeItem('collab-pos:' + id);
      localStorage.removeItem('model-alias:' + id);
    });
    localStorage.removeItem('collab-messages');
    document.querySelector('#nav-stage').click();
    await new Promise(r => setTimeout(r, 300));
    await window.__stageUi.refresh();
    await new Promise(r => setTimeout(r, 500));
    // 隐藏窗口的合成器会滞后；重建 DOM 后必须等每张 spritesheet 真正解码完，
    // 否则抓到的帧里只有名字、没有角色。
    const urls = [...new Set([...document.querySelectorAll('.pet-strip')]
      .map((n) => (getComputedStyle(n).backgroundImage.match(/url[(]["']?([^"')]+)/) || [])[1])
      .filter(Boolean))];
    await Promise.all(urls.map((u) => new Promise((res) => {
      let settled = false;
      const done = () => { if (!settled) { settled = true; res(); } };
      const guard = setTimeout(done, 2000);
      const img = new Image();
      img.onload = () => { if (img.decode) img.decode().then(() => { clearTimeout(guard); done(); }, () => { clearTimeout(guard); done(); }); else { clearTimeout(guard); done(); } };
      img.onerror = () => { clearTimeout(guard); done(); };
      img.src = u;
    })));
    await new Promise(r => setTimeout(r, 600));
    return { sheets: urls.length, sprites: document.querySelectorAll('.pet-strip').length };
  })()`);
  if (!spriteReady.sheets || !spriteReady.sprites) throw new Error(`截图前角色素材没就绪：${JSON.stringify(spriteReady)}`);
  for (let i = 0; i < 8; i += 1) { await wait(300); await win.capturePage(); }
  fs.writeFileSync(path.join(__dirname, 'stage-page.png'), (await win.capturePage()).toPNG());
  await js("document.querySelector('#stage-pet').checked = true; document.querySelector('#stage-pet').dispatchEvent(new Event('change')); true;");
  await wait(500);
  fs.writeFileSync(path.join(__dirname, 'stage-pet.png'), (await win.capturePage()).toPNG());
  await js("document.querySelector('#stage-pet').checked = false; document.querySelector('#stage-pet').dispatchEvent(new Event('change')); true;");

  // 刷新模型后要保留用户勾选
  const pickerPersist = await js(`(async () => {
    const box = document.querySelector('#stage-models input[value="m-cloud"]');
    box.checked = false; box.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    const beforeNodes = document.querySelectorAll('.stage-actor').length;
    await window.__stageUi.refresh();
    await new Promise(r => setTimeout(r, 300));
    const after = document.querySelector('#stage-models input[value="m-cloud"]');
    return { kept: !after.checked, beforeNodes, afterNodes: document.querySelectorAll('.stage-actor').length };
  })()`);
  if (!pickerPersist.kept || pickerPersist.beforeNodes !== pickerPersist.afterNodes) {
    throw new Error(`刷新模型丢了勾选：${JSON.stringify(pickerPersist)}`);
  }
  result.checks.push('collab-model-selection-persists');

  // 归位走路：动作名必须真的解析成走路行，且「拖到别处 → 交回自动归位」时
  // sprite 要切到 row 1/2、8 帧、不镜像，走完再回到状态帧。
  // 旧实现只查 STATE_ACTION，'moveLeft'/'moveRight' 查不到就回落 idle（row 0），
  // 看起来是待机帧在平移滑行。这里用真实 DOM 事件走一遍，不直接调内部函数。
  const walkFrame = await js(`(async () => {
    const A = window.__avatars;
    const id = 'm-local';
    document.documentElement.dataset.reduceMotion = '0';
    document.querySelector('#nav-stage').click();
    await new Promise(r => setTimeout(r, 300));
    const actor = document.querySelector('.stage-actor[data-model-id="' + id + '"]');
    const sprite = actor && actor.querySelector('.pet-sprite');
    if (!sprite) return { error: 'no-sprite' };
    const r0 = actor.getBoundingClientRect();
    const fire = (type, x, y) => actor.dispatchEvent(new PointerEvent(type, {
      bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y,
    }));
    fire('pointerdown', r0.left + 30, r0.top + 30);
    fire('pointermove', Math.max(8, r0.left - 220), r0.top + 30);
    fire('pointerup', Math.max(8, r0.left - 220), r0.top + 30);
    await new Promise(r => setTimeout(r, 120));
    actor.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, clientX: r0.left + 20, clientY: r0.top + 20,
    }));
    const pin = document.querySelector('#stage-context-menu [data-action="pin"]');
    if (!pin) return { error: 'no-pin' };
    pin.click();
    await new Promise(r => setTimeout(r, 70));
    const row = sprite.style.getPropertyValue('--pet-row');
    const frames = sprite.style.getPropertyValue('--pet-frames');
    const flip = sprite.style.getPropertyValue('--pet-flip');
    await new Promise(r => setTimeout(r, 1200));
    return {
      nameLeft: A.actionName(null, 'moveLeft', 'discuss'),
      nameRight: A.actionName(null, 'moveRight', 'discuss'),
      rowLeft: A.actionRow(null, 'moveLeft', 'discuss'),
      framesLeft: A.actionFrames(null, 'moveLeft', 'discuss'),
      idleName: A.actionName(null, 'waiting', 'discuss'),
      row, frames, flip,
      settled: sprite.style.getPropertyValue('--pet-row'),
      manualCleared: !localStorage.getItem('collab-pos:' + id),
    };
  })()`);
  if (walkFrame.error) throw new Error(`走路帧验证没跑起来：${walkFrame.error}`);
  if (walkFrame.nameLeft !== 'moveLeft' || walkFrame.nameRight !== 'moveRight'
    || walkFrame.rowLeft !== 2 || walkFrame.framesLeft !== 8 || walkFrame.idleName !== 'idle') {
    throw new Error(`动作名没有解析成走路行：${JSON.stringify(walkFrame)}`);
  }
  if (walkFrame.row !== '1' && walkFrame.row !== '2') {
    throw new Error(`归位时没有切到走路帧（row=${walkFrame.row}）：${JSON.stringify(walkFrame)}`);
  }
  if (walkFrame.frames !== '8' || walkFrame.flip !== '1') {
    throw new Error(`走路帧数或朝向不对：${JSON.stringify(walkFrame)}`);
  }
  if (walkFrame.settled === '1' || walkFrame.settled === '2') {
    throw new Error(`走完后没有回到状态帧：${JSON.stringify(walkFrame)}`);
  }
  if (!walkFrame.manualCleared) throw new Error('交回自动归位没有清掉手动位置');
  result.checks.push('collab-walk-action-resolves', 'collab-walk-frames-on-return', 'collab-walk-settles-to-state');

  // 空房间：取消全部参与模型后给出引导，按钮能跳到模型页，恢复勾选后收回。
  const emptyState = await js(`(async () => {
    const empty = document.querySelector('#stage-empty');
    const btn = document.querySelector('#stage-empty-goto');
    const snap = () => ({ shown: !empty.hidden,
      actors: document.querySelectorAll('.stage-actor').length,
      title: empty.querySelector('.stage-empty-title').textContent,
      text: empty.querySelector('.stage-empty-text').textContent,
      btnHidden: btn.hidden });
    const withActorsHidden = empty.hidden;
    // 情况一：有在线模型，只是全都没勾选 —— 不该再说「先启用连接」。
    [...document.querySelectorAll('#stage-models input[type="checkbox"]')].forEach(b => {
      if (b.checked) { b.checked = false; b.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await new Promise(r => setTimeout(r, 250));
    const unchecked = snap();
    // 情况二：一个在线模型都没有 —— 文案换成启用连接，按钮恢复可点。
    window.__stubCalls.setModelsOverride([]);
    await window.__stageUi.refresh();
    await new Promise(r => setTimeout(r, 300));
    const noOnline = snap();
    btn.click();
    await new Promise(r => setTimeout(r, 250));
    const jumped = !document.getElementById('models-page').hidden;
    document.querySelector('#nav-stage').click();
    await new Promise(r => setTimeout(r, 200));
    window.__stubCalls.resetModelsOverride();
    await window.__stageUi.refresh();
    await new Promise(r => setTimeout(r, 350));
    return { withActorsHidden, unchecked, noOnline, jumped, restored: snap() };
  })()`);
  if (!emptyState.withActorsHidden || !emptyState.unchecked.shown || emptyState.unchecked.actors !== 0) {
    throw new Error(`空状态显隐没跟真实角色数走：${JSON.stringify(emptyState)}`);
  }
  if (emptyState.unchecked.title !== '还没有人参与' || !emptyState.unchecked.text.includes('勾')
    || !emptyState.unchecked.btnHidden) {
    throw new Error(`有在线模型时空状态仍叫人去启用连接：${JSON.stringify(emptyState.unchecked)}`);
  }
  if (emptyState.noOnline.title !== '房间里还没有人' || !emptyState.noOnline.text.includes('刷新模型')
    || emptyState.noOnline.btnHidden || !emptyState.noOnline.shown) {
    throw new Error(`没有在线模型时空状态文案/按钮不对：${JSON.stringify(emptyState.noOnline)}`);
  }
  if (!emptyState.jumped) throw new Error('空状态的按钮没有跳到模型与额度');
  if (emptyState.restored.shown || emptyState.restored.actors < 1) {
    throw new Error(`恢复模型后空状态没收回：${JSON.stringify(emptyState.restored)}`);
  }
  result.checks.push('stage-empty-state-follows-actors', 'stage-empty-state-distinguishes-offline',
    'stage-empty-state-guides-next-step', 'stage-empty-state-restores');

  // 导航高亮唯一性：切页后不能有两个按钮同时亮（粘连）
  const navSticky = await js(`(async () => {
    const out = [];
    for (const id of ['nav-stage', 'nav-tasks', 'nav-memory', 'nav-chat', 'nav-designer', 'nav-panel']) {
      document.querySelector('#' + id).click();
      await new Promise(r => setTimeout(r, 320));
      out.push({ id, actives: [...document.querySelectorAll('.nav-button.active')].map((b) => b.id) });
    }
    return out;
  })()`);
  for (const item of navSticky) {
    if (item.actives.length !== 1 || item.actives[0] !== item.id) throw new Error(`导航粘连：点 ${item.id} 后高亮 ${JSON.stringify(item.actives)}`);
  }
  result.checks.push('nav-no-sticky');

  // 3) 派发卡片：预览同样用绝对路径
  const dispatch = await js(`(async () => {
    document.querySelector('#nav-tasks').click();
    await new Promise(r => setTimeout(r, 300));
    const dispatchCollapsedInitially = !document.querySelector('#dispatch-details').open;
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
    const previewBox = document.querySelector('#dispatch-preview-body');
    const summaryLines = [...previewBox.querySelectorAll(':scope > p')].map(p => p.textContent);
    const technicalDetails = previewBox.querySelector('details');
    const compactPreview = summaryLines.length === 4 && summaryLines[0].includes('模型：') && technicalDetails && !technicalDetails.open;
    document.querySelector('#dispatch-send').click();
    await new Promise(r => setTimeout(r, 500));
    return { project: previewProject, compactPreview: Boolean(compactPreview), dispatchCollapsedInitially,
      status: document.querySelector('#dispatch-status').textContent,
      sendDisabledWhileRunning: document.querySelector('#dispatch-send').disabled,
      cancelVisible: !document.querySelector('#dispatch-cancel').hidden };
  })()`);
  if (dispatch.project !== PROJECT) throw new Error(`派发预览用了错误项目：${dispatch.project}`);
  if (!dispatch.dispatchCollapsedInitially) throw new Error('派发卡片没有默认收起（运行与连接页仍过载）');
  if (!dispatch.compactPreview) throw new Error('派发预览应先展示可读摘要，技术详情默认折叠');
  if (!dispatch.sendDisabledWhileRunning) throw new Error('任务在跟跑时派发按钮仍可点：会覆盖前一个任务的跟踪');
  if (!dispatch.cancelVisible) throw new Error('派发后没有出现取消入口');
  result.checks.push('dispatch-preview-uses-absolute-project');
  result.checks.push('dispatch-preview-human-readable');
  result.checks.push('dispatch-no-double-send');
  // 派发折叠收起时截一张「运行与连接」页，确认纵向流布局。
  await new Promise((resolve) => setTimeout(resolve, 200));
  fs.writeFileSync(path.join(__dirname, 'tasks-page.png'), (await win.capturePage()).toPNG());

  // 4) 嵌入失败时不锁滚动（不能把外壳滚动条永久关掉）
  const embed = await js(`(async () => {
    document.querySelector('#nav-panel').click();
    document.querySelector('#models-advanced').click();
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
