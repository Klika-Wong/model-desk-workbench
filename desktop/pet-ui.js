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
  const menu = $('pet-menu');
  const outfitsPanel = $('pet-outfits');
  const outfitsGrid = $('pet-outfits-grid');
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
  // 全部用 GitHub 开源素材（llm-pet：15 个模型 × 标准版 / Q 版 = 30 个）。
  const ROSTER = (AVATARS && AVATARS.ROSTER) || {};
  const OUTFITS = Object.values(ROSTER).flatMap((def) => (def.ids || []).map((id) => 'roster:' + id));
  const TERMINAL = ['completed', 'accepted', 'failed', 'cancelled', 'blocked'];
  const petModel = { id: 'desktop-pet', name: '桌面形象' };

  let locked = false;
  let alwaysOnTop = true;
  let outfit = OUTFITS[0] || 'roster:deepseek-chibi';
  let opaque = false;
  let bubbleTimer = null;
  let chatTimers = [];
  let dragging = false;
  let dragReady = false;
  let dragFrame = false;

  // 输入驱动动作（仿 BongoCat / CatPet 的交互模式），纯逻辑在 pet-motion.js。
  const motion = window.__petMotion ? window.__petMotion.create() : null;
  let applied = '';
  // 只读快照，供真机验证确认动作确实在切，而不是只看 CSS 变量初值。
  window.__petMotionState = () => (motion ? motion.snapshot() : null);

  function applyRow(row, facing) {
    const sprite = actor.querySelector('[data-sprite]');
    if (!sprite) return;
    // 帧数和时长必须跟动作行一起换：素材每行有效帧数不同（idle 6 / wave 4 / jump 5），
    // 只改 --pet-row 会扫到空白格，表现就是「角色闪一下」。
    const frames = AVATARS.ACTION_FRAMES[row] || 8;
    sprite.style.setProperty('--pet-frames', String(frames));
    sprite.style.setProperty('--pet-dur', (frames * AVATARS.FRAME_MS) + 'ms');
    sprite.style.setProperty('--pet-row', String(AVATARS.ACTIONS[row] ?? 0));
    sprite.style.setProperty('--pet-flip', facing === 'left' ? '-1' : '1');
  }
  function applyMotion(force) {
    if (!motion) return;
    if (window.__motion) motion.poke('reduced', window.__motion.get());
    const next = motion.tick();
    const key = next.row + '/' + next.facing;
    if (!force && key === applied) return;
    applied = key;
    applyRow(next.row, next.facing);
  }
  let motionAt = 0;
  function motionLoop(ts) {
    if (ts - motionAt >= 110) { motionAt = ts; applyMotion(false); }
    requestAnimationFrame(motionLoop);
  }

  function renderActor() {
    AVATARS.mount(actor, petModel, outfit, { state: 'waiting', scene: 'discuss' });
    applied = '';           // DOM 重建，强制把状态机当前结果写回新 sprite
    applyMotion(true);
  }
  // 显式动作（表情 / 派发结果）也交给状态机统一排队，避免多个 setTimeout 互相把行改回 0。
  function setRow(row, ms = 0) {
    if (!motion) { applyRow(row, 'right'); return; }
    motion.poke('emote', { row, ms });
    applyMotion(false);
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
    for (const box of [emotesBox, chatbox, outfitsPanel]) {
      if (box !== which) box.hidden = true;
    }
    which.hidden = !which.hidden;
  }

  // 拖动：主进程读屏幕绝对坐标，渲染层只报告「按下时光标在窗口内的位置」。
  // 之前只报 start/move/end，主进程在收到 start 时自己采样光标——按下后到 IPC 到达之间
  // 掉的那几帧位移会被永久丢掉，于是窗口始终比光标偏一截。现在把 offset 直接带过去，
  // 主进程每次都用「光标 − offset」绝对定位，偏移被彻底消掉。
  pet.addEventListener('pointerdown', (event) => {
    if (locked || event.target.closest('button, input, select, .pet-chatbox, .pet-emotes, .pet-toolbar, .pet-menu')) return;
    dragging = true;
    dragReady = false;
    try { pet.setPointerCapture(event.pointerId); } catch {}
    pet.classList.add('is-dragging');
    if (motion) motion.poke('drag-start');
    window.workbench.petControl('drag-start', { x: event.clientX, y: event.clientY })
      .then(() => { dragReady = true; })
      .catch(() => { dragReady = false; });
  });
  pet.addEventListener('pointermove', (event) => {
    // 光标在角色左/右决定朝向，划得快就「追光」跳一下；拖动时只挪窗，不改动作。
    if (motion && !dragging) {
      motion.poke('pointer', { x: event.clientX, centerX: window.innerWidth / 2 });
    }
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
    if (motion) motion.poke('drag-end');
    window.workbench.petControl('drag-end').catch(() => {});
  };
  // 把「真正能点的地方」告诉主进程（角色 / 工具栏 / 气泡 / 面板的合并包围盒）。
  // 主进程按光标位置动态开关注透：落在外面就让点击穿透到桌面和其他窗口。
  let hitboxTimer = null;
  function reportHitbox() {
    const boxes = ['#pet-actor', '#pet-toolbar', '#pet-bubble', '#pet-emotes', '#pet-chatbox', '#pet-menu', '#pet-outfits']
      .map((sel) => document.querySelector(sel))
      .filter((el) => el && !el.hidden && getComputedStyle(el).display !== 'none')
      .map((el) => el.getBoundingClientRect());
    if (!boxes.length) return;
    const x = Math.min(...boxes.map((b) => b.left));
    const y = Math.min(...boxes.map((b) => b.top));
    const w = Math.max(...boxes.map((b) => b.right)) - x;
    const h = Math.max(...boxes.map((b) => b.bottom)) - y;
    window.workbench.petControl('hitbox', { x, y, w, h }).catch(() => {});
  }
  function queueHitbox() {
    if (hitboxTimer) return;
    hitboxTimer = setTimeout(() => { hitboxTimer = null; reportHitbox(); }, 60);
  }
  new MutationObserver(queueHitbox).observe(document.body, {
    subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class', 'style'],
  });
  window.addEventListener('resize', queueHitbox);
  reportHitbox();

  pet.addEventListener('pointerup', endDrag);
  pet.addEventListener('pointercancel', endDrag);
  actor.addEventListener('pointerdown', () => { closeMenu(); if (outfitsPanel) outfitsPanel.hidden = true; }, true);
  // 单击 = 被摸一下（招手），双击 = 表情，两者不抢：dblclick 的动作优先级更高。
  actor.addEventListener('click', () => { if (motion) motion.poke('tap'); });
  actor.addEventListener('dblclick', () => {
    const e = EMOTES[Math.floor(Math.random() * EMOTES.length)];
    showBubble(e.text, e.face);
    setRow(e.row, 1800);
  });

  // ---- 动作：工具条和右键菜单共用同一套 ----
  async function toggleLock() {
    const reply = await window.workbench.petControl('lock', !locked);
    if (reply && reply.ok) {
      locked = reply.data.locked;
      pet.classList.toggle('is-locked', locked);
      $('pet-lock').textContent = locked ? '🔒' : '🔓';
      $('pet-lock').classList.toggle('is-on', locked);
      showBubble(locked ? '锁定啦，拖不动了' : '解锁，可以拖我', locked ? '🔒' : '🔓');
    }
  }
  async function toggleTop() {
    const reply = await window.workbench.petControl('top', !alwaysOnTop);
    if (reply && reply.ok) {
      alwaysOnTop = reply.data.alwaysOnTop;
      $('pet-top').classList.toggle('is-on', alwaysOnTop);
      showBubble(alwaysOnTop ? '已置顶' : '取消置顶', '📌');
    }
  }
  // 形象面板：3 列滚动网格，列出全部 30 个开源形象（15 模型 × 标准/Q 版）
  function buildOutfits() {
    outfitsGrid.replaceChildren();
    for (const def of Object.values(ROSTER)) {
      for (const id of (def.ids || [])) {
        const value = 'roster:' + id;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pet-outfit' + (value === outfit ? ' is-active' : '');
        btn.dataset.outfit = value;
        const chibi = id.endsWith('-chibi');
        btn.title = `${def.label} · ${chibi ? 'Q 版' : '标准版'}`;
        const thumb = document.createElement('div');
        thumb.className = 'thumb';
        thumb.style.backgroundImage = `url("${AVATARS.R}${id}.webp")`;
        btn.append(thumb);
        const name = document.createElement('span');
        name.textContent = String(def.label).split(' · ')[0] + (chibi ? '·Q' : '·标');
        btn.append(name);
        outfitsGrid.append(btn);
      }
    }
  }
  function openOutfits() {
    bubble.hidden = true;
    if (!outfitsPanel.hidden) { outfitsPanel.hidden = true; queueHitbox(); return; }
    buildOutfits();
    toggleBox(outfitsPanel);
    queueHitbox();
  }
  outfitsGrid.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-outfit]');
    if (!btn) return;
    outfit = btn.dataset.outfit;
    renderActor();
    outfitsPanel.hidden = true;
    queueHitbox();
    await window.workbench.petControl('outfit', outfit);
    const label = btn.title || '';
    showBubble(label ? `换成 ${label.split(' · ')[0]}` : '换好了', '✨');
  });
  function toggleChat() {
    toggleBox(chatbox);
    const open = !chatbox.hidden;
    // 只有要打字时才让窗口夺焦；平时保持「点了也不抢焦点」。
    window.workbench.petControl('focusable', open).catch(() => {});
    if (open) input.focus();
  }
  async function toggleOpaque() {
    const next = !opaque;
    const reply = await window.workbench.petControl('opaque', next);
    if (reply && reply.ok) {
      opaque = Boolean(reply.data && reply.data.opaque);
      // 透明开关要重建窗口，这里不用再做什么；新窗口会重新读状态。
    }
  }

  $('pet-lock').addEventListener('click', toggleLock);
  $('pet-top').addEventListener('click', toggleTop);
  $('pet-emote').addEventListener('click', () => toggleBox(emotesBox));
  $('pet-chat').addEventListener('click', toggleChat);
  $('pet-close').addEventListener('click', () => window.workbench.petControl('close'));
  $('pet-swap').addEventListener('click', openOutfits);

  // ---- 右键菜单：配置都收在这里，工具条只留常用的 ----
  function closeMenu() {
    if (!menu) return;
    menu.hidden = true;
    menu.replaceChildren();
    queueHitbox();
  }
  function item(label, hint, action, on) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pet-menu-item' + (on ? ' is-on' : '');
    b.dataset.action = action;
    b.setAttribute('role', 'menuitem');
    const text = document.createElement('span');
    text.textContent = label;
    b.append(text);
    if (hint) {
      const small = document.createElement('small');
      small.textContent = hint;
      b.append(small);
    }
    return b;
  }
  function openMenu(x, y) {
    if (!menu) return;
    bubble.hidden = true; // 气泡和菜单叠在一起太挤，开菜单先收气泡
    menu.replaceChildren();
    menu.append(item('选择形象', `${OUTFITS.length} 个开源形象`, 'outfit'));
    menu.append(item(opaque ? '不透明窗口：开' : '不透明窗口：关', '透明窗在部分显卡上会闪', 'opaque', opaque));
    menu.append(item(locked ? '锁定位置：开' : '锁定位置：关', locked ? '拖不动' : '可以拖动', 'lock', locked));
    menu.append(item(alwaysOnTop ? '始终置顶：开' : '始终置顶：关', '', 'top', alwaysOnTop));
    menu.append(item('连模型聊一句', '不新开窗口', 'chat'));
    const sep = document.createElement('div');
    sep.className = 'pet-menu-sep';
    menu.append(sep);
    menu.append(item('关掉桌宠', '', 'close'));
    menu.hidden = false;
    // 菜单必须整体留在窗口内，否则超出的部分会被窗口边界裁掉。
    const w = menu.offsetWidth || 190;
    const h = menu.offsetHeight || 200;
    const left = Math.min(Math.max(4, x), Math.max(4, window.innerWidth - w - 4));
    const top = Math.min(Math.max(4, y), Math.max(4, window.innerHeight - h - 4));
    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(top) + 'px';
    queueHitbox();
  }
  pet.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    openMenu(event.clientX, event.clientY);
  });
  menu.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn) return;
    event.stopPropagation();
    const action = btn.dataset.action;
    closeMenu();
    if (action === 'outfit') openOutfits();
    else if (action === 'opaque') await toggleOpaque();
    else if (action === 'lock') await toggleLock();
    else if (action === 'top') await toggleTop();
    else if (action === 'chat') toggleChat();
    else if (action === 'close') window.workbench.petControl('close');
  });
  document.addEventListener('click', (event) => {
    if (event.target.closest('.pet-menu')) return;
    closeMenu();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });
  sendBtn.addEventListener('click', sendChat);
  input.addEventListener('keydown', (event) => {
    if (motion && event.key !== 'Enter') motion.poke('type');  // 打字 → 敲键盘动作
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
      opaque = s.opaque === true;
      if (typeof s.outfit === 'string' && OUTFITS.includes(s.outfit)) outfit = s.outfit;
      pet.classList.toggle('is-locked', locked);
      $('pet-lock').textContent = locked ? '🔒' : '🔓';
      $('pet-lock').classList.toggle('is-on', locked);
      $('pet-top').classList.toggle('is-on', alwaysOnTop);
    }
    renderActor();
    if (motion) requestAnimationFrame(motionLoop);
    await loadModels();
    if (reply && reply.ok && reply.data && reply.data.modelId) modelSelect.value = reply.data.modelId;
    showBubble('在呢，双击发表情', '👋');
  }
  init();
})();
