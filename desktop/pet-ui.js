/* 独立桌宠：透明置顶小窗里的角色、表情包、锁定/置顶、模型对话。
   复用主窗口已有的派发链路（dispatch:send / log / status），不新造后端。 */
(() => {
  const $ = (id) => document.getElementById(id);
  const AVATARS = window.__avatars;
  const pet = $('pet');
  const actor = $('pet-actor');
  const bubble = $('pet-bubble');
  const toolbar = $('pet-toolbar');
  const emotesBox = $('pet-emotes');
  const chatbox = $('pet-chatbox');
  const modelSelect = $('pet-model');
  const input = $('pet-input');
  const sendBtn = $('pet-send');
  const chatStatus = $('pet-chat-status');
  if (!pet || !AVATARS || !window.workbench) return;

  const EMOTES = [
    { face: '🎉', text: '搞定啦！', row: 'jump' },
    { face: '💡', text: '想到一个点子', row: 'work' },
    { face: '👀', text: '我看着呢', row: 'idle' },
    { face: '☕', text: '摸鱼一下', row: 'wait' },
    { face: '🔥', text: '这波稳了', row: 'wave' },
    { face: '💤', text: '有点困…', row: 'wait' },
    { face: '❓', text: '啊？', row: 'fail' },
    { face: '👍', text: '收到', row: 'wave' },
  ];
  const OUTFITS = ['roster:deepseek-chibi', 'roster:chatgpt-chibi', 'roster:claude-chibi', 'roster:gemini-chibi', 'roster:grok-chibi'];
  const TERMINAL = ['completed', 'accepted', 'failed', 'cancelled', 'blocked'];
  const petModel = { id: 'desktop-pet', name: '桌面形象' };

  let locked = false;
  let alwaysOnTop = true;
  let outfit = OUTFITS[0];
  let bubbleTimer = null;
  let rowTimer = null;
  let chatTimers = [];
  let dragging = false;
  let dragReady = false;
  let dragFrame = false;

  function renderActor(row) {
    AVATARS.mount(actor, petModel, outfit, { state: 'waiting', scene: 'discuss' });
    const sprite = actor.querySelector('[data-sprite]');
    if (sprite && row) sprite.style.setProperty('--pet-row', String(AVATARS.ACTIONS[row] ?? 0));
  }
  function setRow(row, ms = 0) {
    const sprite = actor.querySelector('[data-sprite]');
    if (!sprite) return;
    if (rowTimer) clearTimeout(rowTimer);
    sprite.style.setProperty('--pet-row', String(AVATARS.ACTIONS[row] ?? 0));
    if (ms) rowTimer = setTimeout(() => sprite.style.setProperty('--pet-row', '0'), ms);
  }
  function showBubble(text, face) {
    if (bubbleTimer) clearTimeout(bubbleTimer);
    bubble.replaceChildren();
    if (face) {
      const glyph = document.createElement('span');
      glyph.className = 'emote-glyph';
      glyph.textContent = face;
      bubble.append(glyph);
    }
    const body = document.createElement('span');
    body.textContent = text;
    bubble.append(body);
    bubble.hidden = false;
    bubbleTimer = setTimeout(() => { bubble.hidden = true; }, 4200);
  }

  function buildEmotes() {
    emotesBox.replaceChildren();
    for (const emote of EMOTES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.title = emote.text;
      const face = document.createElement('span');
      face.className = 'emote-face';
      face.textContent = emote.face;
      const cap = document.createElement('span');
      cap.textContent = emote.text.slice(0, 4);
      btn.append(face, cap);
      btn.addEventListener('click', () => {
        showBubble(emote.text, emote.face);
        setRow(emote.row, 1800);
        emotesBox.hidden = true;
      });
      emotesBox.append(btn);
    }
  }

  async function loadModels() {
    try {
      const reply = await window.workbench.dispatchModels();
      const list = (reply && reply.ok && Array.isArray(reply.data.models)) ? reply.data.models : [];
      modelSelect.replaceChildren();
      if (!list.length) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '未读到模型（面板未连接）';
        modelSelect.append(opt);
        return;
      }
      for (const m of list) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name || m.id;
        modelSelect.append(opt);
      }
      chatStatus.textContent = `可连 ${list.length} 个模型，走本机面板派发。`;
    } catch (error) {
      chatStatus.textContent = `读取模型失败：${error.message}`;
    }
  }

  function stopChatPolling() {
    for (const t of chatTimers) clearInterval(t);
    chatTimers = [];
  }

  async function sendChat() {
    const prompt = input.value.trim();
    const modelId = modelSelect.value;
    if (!prompt || !modelId || sendBtn.disabled) return;
    sendBtn.disabled = true;
    chatStatus.textContent = '正在派发…';
    showBubble('想想…', '💭');
    setRow('work');
    stopChatPolling();
    try {
      const state = await window.workbench.getState();
      const project = state && state.project;
      if (!project) { chatStatus.textContent = '先在主窗口选择项目。'; return; }
      const reply = await window.workbench.dispatchSend({ prompt, modelId, kind: 'chat', project });
      if (!reply || !reply.ok) { chatStatus.textContent = `派发失败：${(reply && reply.error) || '未知原因'}`; return; }
      const taskId = reply.data.id;
      let latest = '';
      chatStatus.textContent = '已派发，等待输出…';
      chatTimers.push(setInterval(async () => {
        try {
          const live = await window.workbench.dispatchLog(taskId);
          if (live && live.ok) {
            const text = String(live.data.answer || '').trim();
            if (text && text !== latest) {
              latest = text;
              showBubble(text.length > 90 ? text.slice(0, 90) + '…' : text, '💬');
            }
          }
        } catch {}
      }, 600));
      chatTimers.push(setInterval(async () => {
        try {
          const s = await window.workbench.dispatchStatus(taskId);
          if (!s || !s.ok) return;
          const task = s.data.task;
          const st = String(task ? (task.status || task.phase) : '').toLowerCase();
          if (TERMINAL.includes(st)) {
            const ans = String(s.data.answer || latest || '').trim();
            stopChatPolling();
            setRow(st === 'completed' || st === 'accepted' ? 'wave' : 'fail', 2200);
            showBubble(ans ? (ans.length > 90 ? ans.slice(0, 90) + '…' : ans) : '（没有有效回答）', '💬');
            chatStatus.textContent = '已回复。';
            sendBtn.disabled = false;
          }
        } catch {}
      }, 2000));
    } catch (error) {
      chatStatus.textContent = `发送失败：${error.message}`;
      stopChatPolling();
      sendBtn.disabled = false;
    } finally {
      // 轮询期间保持禁用；若前面提前返回（没有项目/派发失败）也要解开。
      if (!chatTimers.length) sendBtn.disabled = false;
    }
  }

  function toggleBox(which) {
    for (const box of [emotesBox, chatbox]) {
      if (box !== which) box.hidden = true;
    }
    which.hidden = !which.hidden;
  }

  // 拖动：坐标一律由主进程读屏幕绝对位置。窗口移动会让 clientX/Y 反向变化，
  // 渲染层自己算 delta 会出现「反方向跑」和来回抖，这里只发开始/移动/结束。
  pet.addEventListener('pointerdown', (event) => {
    if (locked || event.target.closest('button, input, select, .pet-chatbox, .pet-emotes, .pet-toolbar')) return;
    dragging = true;
    dragReady = false;
    try { pet.setPointerCapture(event.pointerId); } catch {}
    pet.classList.add('is-dragging');
    setRow('moveRight');
    window.workbench.petControl('drag-start').then(() => { dragReady = true; }).catch(() => { dragReady = false; });
  });
  pet.addEventListener('pointermove', () => {
    if (!dragging || !dragReady || dragFrame) return;
    dragFrame = true;
    requestAnimationFrame(() => {
      dragFrame = false;
      if (dragging && dragReady) window.workbench.petControl('drag-move').catch(() => {});
    });
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false; dragReady = false;
    pet.classList.remove('is-dragging');
    setRow('idle');
    window.workbench.petControl('drag-end').catch(() => {});
  };
  pet.addEventListener('pointerup', endDrag);
  pet.addEventListener('pointercancel', endDrag);
  actor.addEventListener('dblclick', () => {
    const e = EMOTES[Math.floor(Math.random() * EMOTES.length)];
    showBubble(e.text, e.face);
    setRow(e.row, 1800);
  });

  $('pet-lock').addEventListener('click', async () => {
    const reply = await window.workbench.petControl('lock', !locked);
    if (reply && reply.ok) {
      locked = reply.data.locked;
      pet.classList.toggle('is-locked', locked);
      $('pet-lock').textContent = locked ? '🔒' : '🔓';
      $('pet-lock').classList.toggle('is-on', locked);
      showBubble(locked ? '锁定啦，拖不动了' : '解锁，可以拖我', locked ? '🔒' : '🔓');
    }
  });
  $('pet-top').addEventListener('click', async () => {
    const reply = await window.workbench.petControl('top', !alwaysOnTop);
    if (reply && reply.ok) {
      alwaysOnTop = reply.data.alwaysOnTop;
      $('pet-top').classList.toggle('is-on', alwaysOnTop);
      showBubble(alwaysOnTop ? '已置顶' : '取消置顶', '📌');
    }
  });
  $('pet-emote').addEventListener('click', () => toggleBox(emotesBox));
  $('pet-chat').addEventListener('click', () => { toggleBox(chatbox); if (!chatbox.hidden) input.focus(); });
  $('pet-close').addEventListener('click', () => window.workbench.petControl('close'));
  $('pet-swap').addEventListener('click', async () => {
    const idx = OUTFITS.indexOf(outfit);
    outfit = OUTFITS[(idx + 1) % OUTFITS.length];
    renderActor();
    await window.workbench.petControl('outfit', outfit);
    showBubble('换了个形象', '✨');
  });
  sendBtn.addEventListener('click', sendChat);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); sendChat(); }
  });
  modelSelect.addEventListener('change', () => window.workbench.petControl('model', modelSelect.value));

  async function init() {
    buildEmotes();
    const reply = await window.workbench.petState();
    if (reply && reply.ok) {
      const s = reply.data || {};
      locked = Boolean(s.locked);
      alwaysOnTop = s.alwaysOnTop !== false;
      if (typeof s.outfit === 'string' && OUTFITS.includes(s.outfit)) outfit = s.outfit;
      pet.classList.toggle('is-locked', locked);
      $('pet-lock').textContent = locked ? '🔒' : '🔓';
      $('pet-lock').classList.toggle('is-on', locked);
      $('pet-top').classList.toggle('is-on', alwaysOnTop);
    }
    renderActor();
    await loadModels();
    if (reply && reply.ok && reply.data && reply.data.modelId) modelSelect.value = reply.data.modelId;
    showBubble('在呢，双击发表情', '👋');
  }
  init();
})();
