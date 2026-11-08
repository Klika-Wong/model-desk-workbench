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
    await new Promise(r => setTimeout(r, 3400));
    const multiBranches = document.querySelectorAll('.chat-branch').length;
    const adoptable = [...document.querySelectorAll('.chat-branch-foot button')].filter((b) => !b.disabled);
    if (adoptable.length) adoptable[0].click();
    await new Promise(r => setTimeout(r, 500));
    const lastSave = window.__stubCalls.all().filter(c => c.api === 'chatSave').pop();
    const multiAdopted = Boolean(lastSave && JSON.stringify(lastSave.input).includes('来自'));
    // 讨论模式：两个模型串行发言，每位能看到前面发言
    // 等上一轮多视角的并行分支完全结束，否则 multiGroupRunning 门控会拦住讨论（产品行为正确）。
    await new Promise(r => setTimeout(r, 2500));
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
      multiVisible, multiSendEnabled, multiBranches, multiAdopted, discussionSendEnabled, discussionWho: discussionWho.length, discussionStageVisible, discussionAgents, discussionDoneAgents, adoptCount, adoptedDiscussion, petSwitched,
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
    const sprites = document.querySelectorAll('.stage-actor .pet-sprite').length;
    const sheets = [...document.querySelectorAll('.stage-actor .pet-sprite')].map((x) => x.style.getPropertyValue('--pet-sheet'));
    const distinctSheets = new Set(sheets).size;
    const deepseekRoster = (document.querySelector('.stage-actor[data-model-id="m-deepseek"] .pet-sprite') || { style: { getPropertyValue: () => '' } }).style.getPropertyValue('--pet-sheet').includes('deepseek-');
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

    // 悬浮桌宠入口
    const hasPetOpen = Boolean(document.querySelector('#stage-pet-open'));
    if (hasPetOpen) document.querySelector('#stage-pet-open').click();
    await new Promise(r => setTimeout(r, 200));
    const petStatus = document.querySelector('#stage-status').textContent;

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
      sprites, distinctSheets, deepseekRoster, headerText, overlaps, keyboardReady, consentExists, introHonest, askDisabledWithoutConsent, noSendWithoutConsent, panelScroll, turnsScroll, stopBtnExists, hasPetOpen, petStatus, ctxOpen, ctxOutfits, ctxActions,
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
  if (!stage.hasPetOpen || !stage.petStatus.includes('悬浮到桌面')) throw new Error('悬浮桌宠入口无效');
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
  result.checks.push('collab-online-only', 'collab-ecosystem-zones', 'collab-context-menu', 'collab-dialogue-flow', 'pet-desktop-window', 'collab-reference-graph');

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

    // 页内小窗：工位网格 / 休息地毯 / 分隔线都不该残留
    const petToggle = document.querySelector('#stage-pet');
    petToggle.checked = true; petToggle.dispatchEvent(new Event('change'));
    await wait(150);
    const petDecor = getComputedStyle(document.querySelector('#stage-floor'), '::before').display;
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
    return { samePath, dlgHidden, turnsBefore, turnsAfter, storedBefore, storedAfter, rowsAfter, nodesAfter, edgesAfterRebuild, menuFocused, menuRole, focusReturned, petDecor, dividerHidden, afterFirst, afterSecond, armedLabel };
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
  if (!ux.menuFocused || ux.menuRole !== 'menu') throw new Error(`菜单没有接管键盘焦点：${ux.menuFocused}/${ux.menuRole}`);
  if (!ux.focusReturned) throw new Error('Esc 没有把焦点还给角色');
  if (ux.petDecor !== 'none' || ux.dividerHidden !== 'none') throw new Error(`页内小窗残留分区装饰：${ux.petDecor}/${ux.dividerHidden}`);
  if (ux.afterFirst !== ux.storedBefore || !ux.armedLabel.includes('再点一次')) throw new Error(`清空没有二次确认：${JSON.stringify(ux)}`);
  if (ux.afterSecond !== 0) throw new Error(`二次确认后没有清空历史：${ux.afterSecond}`);
  result.checks.push('collab-no-link-rebuild', 'collab-dialogue-dismiss', 'collab-history-consistency', 'collab-clear-confirm', 'collab-consent-gate', 'collab-menu-keyboard', 'collab-pet-mode-clean');

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
    const urls = [...new Set([...document.querySelectorAll('.pet-sprite')]
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
    return { sheets: urls.length, sprites: document.querySelectorAll('.pet-sprite').length };
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
