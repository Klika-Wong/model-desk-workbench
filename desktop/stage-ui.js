/* 协作视图：同一个画面里分「工作区 / 摸鱼角」，角色按真实状态归位。
   配置全部收进右键菜单；只让在线（已连接）的模型参与，未连接的给启用连接引导。
   状态来自真实派发，不替模型编内容。 */
(() => {
  const $ = (id) => document.getElementById(id);
  const page = $('stage-page');
  const modelPick = $('stage-models');
  const offlineBox = $('stage-offline');
  const floor = $('stage-floor');
  const linksSvg = $('stage-links');
  const turnsList = $('stage-turns');
  const turnCount = $('stage-turn-count');
  const statusList = $('stage-status-list');
  const actorCount = $('stage-actor-count');
  const contextMenu = $('stage-context-menu');
  const dialogueBox = $('stage-dialogue');
  const question = $('stage-question');
  const askBtn = $('stage-ask');
  const stopBtn = $('stage-stop');
  const consentBox = $('stage-consent');
  const statusLine = $('stage-status');
  const petToggle = $('stage-pet');
  const pickedHint = $('stage-picked');
  if (!page || !modelPick || !floor) return;

  const AVATARS = window.__avatars;
  const STATE_LABEL = { waiting: '待机', thinking: '生成中', speaking: '正在输出', done: '已发言', failed: '失败' };
  const TERMINAL = ['completed', 'accepted', 'failed', 'cancelled', 'blocked'];
  const PAGE_IDS = ['memory-page', 'tasks-page', 'designer-page', 'chat-page', 'models-page', 'stage-page'];
  const POKE_LINES = ['在呢', '等我一下，我在想', '刚说到我？', '这条我记下了'];
  const SVG_NS = 'http://www.w3.org/2000/svg';

  let models = [];
  let actors = new Map();
  let running = false;
  let selectedId = null;
  let round = [];
  let messages = [];
  let edges = [];
  let activeTurn = -1;
  let autoPlace = true;
  let statusRows = new Map();
  let lastLinkSig = '';
  let contextActor = null;
  let dialogueTimer = null, dialoguePinned = false, lastMessage = null;
  let clearArmed = 0, clearArmTimer = null;
  let stopRequested = false, abortTurn = null;
  let idleBeatTimer = null;
  const KIND_LABEL = { task: '上级交付', ack: '1v1 回执', chat: '1v1 交流', broadcast: '1v多 广播' };
  const TURN_LIMIT = 40;

  const aliasOf = (model) => (window.__modelAlias ? window.__modelAlias.of(model) : (model.name || model.id));
  const petKey = (id) => 'pet-avatar:' + id;
  const posKey = (id) => 'collab-pos:' + id;
  const MESSAGE_KEY = 'collab-messages';
  const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
  const isOnline = (m) => m && m.enabled !== false && m.ready !== false;
  const zoneOf = (state) => (state === 'thinking' || state === 'speaking') ? 'work' : 'rest';

  function currentPet(model) {
    return read(petKey(model.id)) || (AVATARS ? AVATARS.defaultChoice(model) : 'character');
  }
  function setPickerDisabled(on) {
    for (const cb of modelPick.querySelectorAll('input[type="checkbox"]')) cb.disabled = on;
    const refresh = $('stage-refresh'); if (refresh) refresh.disabled = on;
    if (modelPick) modelPick.classList.toggle('is-locked', on);
  }

  function checkedIds() {
    return [...modelPick.querySelectorAll('input[type="checkbox"]:checked')].map((i) => i.value);
  }
  function savedPos(id) {
    try {
      const raw = read(posKey(id));
      if (!raw) return null;
      const v = JSON.parse(raw);
      if (typeof v.x === 'number' && typeof v.y === 'number') {
        return { x: Math.min(0.94, Math.max(0.06, v.x)), y: Math.min(0.86, Math.max(0.14, v.y)) };
      }
    } catch {}
    return null;
  }

  // 临时动作优先于真实状态，且不会被连线重绘冲掉。
  function visualState(actor) { return actor.visualState || actor.el.dataset.state || 'waiting'; }
  function applyActorVisual(actor, facing) {
    if (!AVATARS) return;
    AVATARS.updateState(actor.avatar, currentPet(actor.model), visualState(actor), 'discuss', facing);
  }
  function setVisual(actor, state, ms) {
    if (actor.visualTimer) clearTimeout(actor.visualTimer);
    actor.visualState = state;
    actor.visualTimer = null;
    applyActorVisual(actor);
    if (ms) {
      actor.visualTimer = setTimeout(() => {
        actor.visualState = null; actor.visualTimer = null;
        applyActorVisual(actor);
      }, ms);
    }
  }
  function clearVisual(actor) {
    if (actor.visualTimer) clearTimeout(actor.visualTimer);
    actor.visualState = null; actor.visualTimer = null;
    applyActorVisual(actor);
  }

  function renderAvatar(actor, state, facing) {
    if (!AVATARS) { actor.avatar.textContent = '🐳'; return; }
    AVATARS.mount(actor.avatar, actor.model, currentPet(actor.model), {
      imgClass: 'avatar-figure', state: state || visualState(actor), scene: 'discuss', facing,
    });
  }

  // ---- 右键菜单：形象与所有配置都收在这里，画布上不再常驻一排框 ----
  function closeContextMenu() {
    if (contextMenu) contextMenu.hidden = true;
    contextActor = null; clearArmed = 0;
    for (const actor of actors.values()) {
      if (actor.picker) { actor.picker.remove(); actor.picker = null; }
    }
  }

  // 缩略图用 spritesheet 的第一帧，不再加载 .gif：几十张 GIF 同时解码会拖主线程。
  function thumbSprite(src) {
    const box = document.createElement('span');
    box.className = 'thumb-sprite';
    box.style.backgroundImage = `url("${src}")`;
    return box;
  }

  function outfitChip(choice, cur, actor) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'outfit' + (choice.value === cur ? ' is-active' : '');
    btn.title = choice.label;
    btn.dataset.value = choice.value;
    if (choice.thumb) {
      btn.append(thumbSprite(choice.thumb));
    } else btn.textContent = choice.glyph || '·';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      write(petKey(actor.model.id), choice.value);
      renderAvatar(actor); updateStatusRow(actor); closeContextMenu();
      statusLine.textContent = `${aliasOf(actor.model)} 的形象已换为「${choice.label}」。`;
    });
    return btn;
  }

  function openOutfitLibrary(actor) {
    if (!AVATARS) return;
    if (actor.picker) { actor.picker.remove(); actor.picker = null; return; }
    const choices = AVATARS.choicesFor(actor.model);
    const cur = currentPet(actor.model);
    const picker = document.createElement('div');
    picker.className = 'outfit-picker';
    const head = document.createElement('div');
    head.className = 'outfit-picker-head';
    head.textContent = '给「' + aliasOf(actor.model) + '」换形象';
    picker.append(head);
    const grid = document.createElement('div');
    grid.className = 'outfit-grid';
    for (const choice of choices) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'outfit-item' + (choice.value === cur ? ' is-active' : '');
      item.title = choice.label;
      if (choice.thumb) {
        item.append(thumbSprite(choice.thumb));
      } else {
        const glyph = document.createElement('span'); glyph.className = 'outfit-glyph';
        glyph.textContent = choice.glyph || '·'; item.append(glyph);
      }
      const cap = document.createElement('span'); cap.textContent = choice.label;
      item.append(cap);
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        write(petKey(actor.model.id), choice.value);
        renderAvatar(actor); updateStatusRow(actor);
        picker.remove(); actor.picker = null; closeContextMenu();
      });
      grid.append(item);
    }
    picker.append(grid);
    const foot = document.createElement('p'); foot.className = 'hint';
    foot.textContent = '手绘 Q 版来自 llm-pet（ZipZipPipe，仅非商业 · 需署名）';
    picker.append(foot);
    actor.el.append(picker);
    actor.picker = picker;
  }

  function menuButton(label, action, hint) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ctx-item'; b.dataset.action = action;
    const text = document.createElement('span'); text.textContent = label;
    b.append(text);
    if (hint) { const h = document.createElement('small'); h.textContent = hint; b.append(h); }
    return b;
  }

  function openContextMenu(actor, clientX, clientY, fromKeyboard) {
    if (!contextMenu || !AVATARS) return;
    closeContextMenu();
    contextActor = actor;
    const choices = AVATARS.choicesFor(actor.model);
    const cur = currentPet(actor.model);
    contextMenu.replaceChildren();
    const head = document.createElement('div');
    head.className = 'ctx-head'; head.textContent = aliasOf(actor.model); head.title = head.textContent;
    contextMenu.append(head);
    const sub = document.createElement('div'); sub.className = 'ctx-sub';
    sub.textContent = `${STATE_LABEL[actor.el.dataset.state] || '待机'} · ${zoneOf(actor.el.dataset.state) === 'work' ? '工作区' : '摸鱼角'}`;
    contextMenu.append(sub);
    const label = document.createElement('div'); label.className = 'ctx-label'; label.textContent = '形象';
    contextMenu.append(label);
    const row = document.createElement('div'); row.className = 'ctx-outfits';
    for (const choice of choices.filter((c) => c.own).slice(0, 2)) row.append(outfitChip(choice, cur, actor));
    for (const choice of choices.filter((c) => !c.own).slice(0, 3)) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'outfit'; b.title = choice.label;
      b.textContent = choice.glyph || '·';
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        write(petKey(actor.model.id), choice.value);
        renderAvatar(actor); updateStatusRow(actor); closeContextMenu();
      });
      row.append(b);
    }
    contextMenu.append(row);
    contextMenu.append(menuButton('打开完整形象库', 'library', choices.length + ' 个可选'));
    const sep = document.createElement('div'); sep.className = 'ctx-sep'; contextMenu.append(sep);
    contextMenu.append(menuButton('改显示名称', 'rename', '同步到对话与派发页'));
    contextMenu.append(menuButton('看它的引用关系', 'select'));
    contextMenu.append(menuButton(actor.manualPos ? '取消固定位置' : '固定此角色位置', 'pin', actor.manualPos ? '恢复随状态归位' : '不再随状态移动'));
    contextMenu.append(menuButton(autoPlace ? '关闭自动归位' : '打开自动归位', 'auto', autoPlace ? '当前：按状态分区' : '当前：角色不再自动移动'));
    contextMenu.append(menuButton('悬浮到桌面', 'pet', '新开独立小窗'));
    contextMenu.append(menuButton(dialoguePinned ? '对话框：保持显示' : '对话框：说完 8 秒自动收起', 'dialogue', '悬停暂停 · 点一下收起'));
    contextMenu.append(menuButton('去「模型与额度」查看连接', 'activate'));
    contextMenu.append(menuButton('清空交流记录', 'clear', '需二次确认'));
    contextMenu.hidden = false;
    const rect = contextMenu.getBoundingClientRect();
    contextMenu.style.left = Math.min(clientX, window.innerWidth - rect.width - 8) + 'px';
    contextMenu.style.top = Math.min(clientY, window.innerHeight - rect.height - 8) + 'px';
    // 键盘打开（Shift+F10 / ContextMenu）时把焦点交给菜单，否则四项配置仍无法用键盘完成。
    if (fromKeyboard) {
      const first = contextMenu.querySelector('.ctx-outfits .outfit, [data-action]');
      if (first) first.focus();
    }
  }

  function handleContextAction(action) {
    const actor = contextActor;
    if (!actor) return;
    if (action === 'library') { openOutfitLibrary(actor); closeContextMenu(); return; }
    if (action === 'clear') {
      // 清空 40 条本机历史不可恢复，必须二次确认；首次点击保持菜单打开并把按钮改成确认态。
      if (!clearArmed || Date.now() - clearArmed > 4000) {
        clearArmed = Date.now();
        const label = contextMenu.querySelector('[data-action="clear"] span');
        if (label) label.textContent = '再点一次确认清空';
        statusLine.textContent = '清空会删除本机全部交流历史，且不可恢复。4 秒内再点一次确认。';
        clearTimeout(clearArmTimer);
        clearArmTimer = setTimeout(() => {
          clearArmed = 0;
          const btn = contextMenu.querySelector('[data-action="clear"] span');
          if (btn) btn.textContent = '清空交流记录';
        }, 4000);
        return;
      }
      clearTimeout(clearArmTimer); clearArmed = 0; clearMessages(); closeContextMenu(); return;
    }
    closeContextMenu();
    if (action === 'dialogue') {
      dialoguePinned = !dialoguePinned;
      if (dialogueTimer) clearTimeout(dialogueTimer);
      dialogueTimer = null;
      if (dialoguePinned && lastMessage) showDialogue(lastMessage);
      else if (!dialoguePinned && dialogueBox && !dialogueBox.hidden) armDialogueTimer(2500);
      statusLine.textContent = `对话框已设为${dialoguePinned ? '保持显示（点一下仍可收起）' : '说完 8 秒自动收起'}。`;
    }
    else if (action === 'rename') editName(actor);
    else if (action === 'select') selectActor(actor.model.id);
    else if (action === 'pin') {
      actor.manualPos = !actor.manualPos;
      if (actor.manualPos) write(posKey(actor.model.id), JSON.stringify(actor.pos));
      else { try { localStorage.removeItem(posKey(actor.model.id)); } catch {} applyEcosystem(true); }
      updateStatusRow(actor);
      statusLine.textContent = `${aliasOf(actor.model)}：${actor.manualPos ? '位置已固定，不再自动归位' : '已交回自动归位'}。`;
    } else if (action === 'auto') {
      autoPlace = !autoPlace;
      const box = $('stage-auto-place'); if (box) box.checked = autoPlace;
      if (autoPlace) applyEcosystem(true);
      statusLine.textContent = `自动归位已${autoPlace ? '打开' : '关闭'}。`;
    } else if (action === 'pet') $('stage-pet-open')?.click();
    else if (action === 'activate') {
      document.querySelector('#nav-panel')?.click();
      statusLine.textContent = '已跳到「模型与额度」。本机没有一键唤醒离线模型的能力：请先在那里启用对应连接，再回这里点「刷新模型」重新检测。';
    }
  }

  function editName(actor) {
    const input = document.createElement('input');
    input.className = 'stage-name-input'; input.value = aliasOf(actor.model); input.maxLength = 40;
    actor.name.replaceWith(input); input.focus(); input.select();
    let done = false;
    const commit = (save) => {
      if (done) return; done = true;
      if (save) {
        window.__modelAlias?.set(actor.model.id, input.value.trim());
        window.__chatUi?.refreshModelLabels?.();
        window.__dispatchUi?.refreshModelLabels?.();
      }
      input.replaceWith(actor.name);
      actor.name.textContent = aliasOf(actor.model); actor.name.title = actor.name.textContent;
      renderTurns(); renderStatusList();
      statusLine.textContent = `形象 ID 已${save ? `改为「${aliasOf(actor.model)}」` : '取消修改'}。`;
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); commit(false); }
    });
    input.addEventListener('blur', () => commit(true));
  }

  function setActorState(id, state, text) {
    const actor = actors.get(id);
    if (!actor) return;
    const oldZone = zoneOf(actor.el.dataset.state);
    actor.el.dataset.state = state;
    actor.el.setAttribute('aria-label', `${aliasOf(actor.model)}，${STATE_LABEL[state] || state}；回车选中，Shift+F10 打开设置`);
    actor.stateEl.textContent = STATE_LABEL[state] || state;
    applyActorVisual(actor);
    if ((state === 'done' || state === 'failed') && text) {
      actor.bubble.hidden = false;
      actor.bubble.textContent = text.length > 26 ? text.slice(0, 26) + '…' : text;
    } else { actor.bubble.hidden = true; actor.bubble.textContent = ''; }
    updateStatusRow(actor);
    if (zoneOf(state) !== oldZone) applyEcosystem();  // 只在跨区时才重排，避免日志轮询来回跳
  }

  // 位置写成 transform 的位移，不走 left/top：left/top 是布局属性，每帧触发重排重绘，
  // 角色走动 + 连线每帧改 d 一起压主线程，看起来就是「抖 / 滑 / 卡」。
  // transform 由合成器处理，过渡只重绘角色本身。
  function setActorPos(el, x, y) {
    if (!el) return;
    const w = floor.clientWidth || 800, h = floor.clientHeight || 400;
    el.style.setProperty('--ax', (x * w).toFixed(1) + 'px');
    el.style.setProperty('--ay', (y * h).toFixed(1) + 'px');
  }

  function actorCenter(actor) {
    const fr = floor.getBoundingClientRect();
    const ar = actor.el.getBoundingClientRect();
    return { x: ar.left - fr.left + ar.width / 2, y: ar.top - fr.top + ar.height / 2 };
  }

  // ---- 生态分区：工作区 / 摸鱼角同时存在，角色按真实状态归位 ----
  // 无重叠布局：按画布宽度算出每行能放几个 156px 节点，工作区占左半、摸鱼角占右半，
  // 放不下时自动换行或借用另一侧空位。位置变化会播放行走动作，配合 CSS 过渡看起来是走过去。
  function applyEcosystem(force) {
    if (!autoPlace && !force) return;
    const W = floor.clientWidth || 800;
    const NODE = 156, GAP = 18;
    const cols = Math.max(1, Math.min(4, Math.floor((W - 24) / (NODE + GAP))));
    const leftCols = Math.max(1, Math.floor(cols / 2));
    const rightCols = Math.max(1, cols - leftCols);
    const free = [...actors.values()].filter((a) => !a.manualPos);
    const work = free.filter((a) => zoneOf(a.el.dataset.state) === 'work');
    const rest = free.filter((a) => zoneOf(a.el.dataset.state) !== 'work');
    const discussing = running;
    // 未开始交流时均匀铺满整行；开始后按状态分到左右半区。
    const left = discussing ? work : free;
    const right = discussing ? rest : [];
    const rows = Math.max(1, Math.min(3, Math.ceil(Math.max(
      left.length / Math.max(1, discussing ? leftCols : cols),
      right.length / Math.max(1, rightCols),
    ))));
    const slots = { left: [], right: [] };
    for (let r = 0; r < rows; r += 1) {
      const lc = discussing ? leftCols : cols;
      for (let c = 0; c < lc; c += 1) slots.left.push({ c, r, total: lc, side: 'left' });
      if (discussing) for (let c = 0; c < rightCols; c += 1) slots.right.push({ c, r, total: rightCols, side: 'right' });
    }
    const take = (list, primary, fallback) => {
      list.forEach((a) => {
        const slot = primary.length ? primary.shift() : (fallback.length ? fallback.shift() : null);
        if (!slot) return;
        const x0 = slot.side === 'left' ? (discussing ? 0.06 : 0.10) : 0.58;
        const x1 = slot.side === 'left' ? (discussing ? 0.48 : 0.90) : 0.94;
        const x = slot.total === 1 ? (x0 + x1) / 2 : x0 + (x1 - x0) * slot.c / (slot.total - 1);
        // 角色落在画布中段：既不空一大片，也不被底部对话框压住头像和名字。
        const y = rows === 1 ? 0.44 : 0.30 + slot.r * (0.28 / (rows - 1));
        const dist = Math.hypot(a.pos.x - x, a.pos.y - y);
        const moved = dist > 0.02;
        // 走路时长跟距离挂钩：近距离 0.34s，远距离 0.86s，避免"瞬移"或"滑冰"。
        a.el.style.setProperty('--walk', Math.round(340 + Math.min(0.72, dist) * 700) + 'ms');
        a.pos = { x, y };
        setActorPos(a.el, x, y);
        a.zone = zoneOf(a.el.dataset.state);
        if (moved && discussing) {
          const walkMs = Number((a.el.style.getPropertyValue('--walk') || '').replace('ms', '')) || 450;
          setVisual(a, x < a.pos.x ? 'moveLeft' : 'moveRight', walkMs);
        }
      });
    };
    // 分区跟着真实占用走：没人在生成时整块画布就是休息区，不摆「工作区」的架子；
    // 只有真有人开始生成，才划出左右两区。否则会出现「工作区 · 空闲」里站满待机角色。
    if (floor) {
      const busy = work.length > 0;
      floor.dataset.busy = busy ? '1' : '0';
      const workHint = floor.querySelector('.zone-work small');
      if (workHint) workHint.textContent = busy ? '生成中 / 正在输出' : '空闲';
      // 没人在生成时整块是休息区，标签就不该继续叫「工作区」。
      const workName = floor.querySelector('.zone-work .zone-name');
      if (workName) workName.textContent = busy ? '工作区' : '休息中';
    }

    take(left, slots.left, slots.right);
    if (discussing) take(right, slots.right, slots.left);
    lastLinkSig = '';
    // 位置变化不该重建结构：让 structSig 判定，几何交给 updateLinkGeometry + followLayout。
    // 之前这里用 drawLinks(true)，跨区时每轮 8+ 次销毁重建 animateMotion，光点归零重放 = 闪烁。
    drawLinks();
    followLayout(520);
  }

  // 连线：只有「结构」变化（边数 / 当前轮 / 选中 / 显隐 / 尺寸）才重建 SVG；
  // 拖拽或角色走动时只改已有 path 的 d，绝不重建 DOM —— 否则 SMIL 光点每帧从头播放，
  // 看起来就是闪烁 + 卡顿。
  let lastStructSig = '';
  let linkNodes = [];
  let followRaf = 0, followUntil = 0;

  function structSig(w, h) {
    return [w, h, edges.length, activeTurn, selectedId || '',
      ...[...actors.values()].map((a) => `${a.model.id}:${a.el.hidden ? 1 : 0}`)].join('|');
  }

  function edgeGeom(edge) {
    const from = actors.get(edge.from), to = actors.get(edge.to);
    if (!from || !to || from.el.hidden || to.el.hidden) return null;
    const a = actorCenter(from), b = actorCenter(to);
    const mx = (a.x + b.x) / 2;
    const my = Math.min(a.y, b.y) - Math.min(74, Math.abs(b.x - a.x) * 0.16 + 26);
    return { d: `M ${a.x} ${a.y - 30} Q ${mx} ${my} ${b.x} ${b.y - 30}`, mx, my };
  }

  function updateLinkGeometry() {
    if (!linksSvg) return;
    edges.forEach((edge, i) => {
      const nodes = linkNodes[i];
      if (!nodes) return;
      const g = edgeGeom(edge);
      if (!g) return;
      if (nodes.path) nodes.path.setAttribute('d', g.d);
      if (nodes.tag) { nodes.tag.setAttribute('x', String(g.mx)); nodes.tag.setAttribute('y', String(g.my - 6)); }
      if (nodes.motion) nodes.motion.setAttribute('path', g.d);
    });
  }

  // 角色按 CSS 过渡「走」过去的这半秒，连线要跟着走，否则线与人对不上。
  function stopFollow() {
    if (followRaf) cancelAnimationFrame(followRaf);
    followRaf = 0; followUntil = 0;
  }
  function followLayout(ms) {
    if (motionReduced()) { updateLinkGeometry(); return; }
    followUntil = Date.now() + (ms || 520);
    if (followRaf) return;
    const tick = () => {
      followRaf = 0;
      if (Date.now() > followUntil || page.hidden || document.hidden) return;
      updateLinkGeometry();
      followRaf = requestAnimationFrame(tick);
    };
    followRaf = requestAnimationFrame(tick);
  }

  function applyFacing() {
    for (const [id, actor] of actors) {
      const live = edges.find((e) => e.turn === activeTurn && e.to === id);
      let facing = 'right';
      if (live) {
        const src = actors.get(live.from);
        if (src) facing = actorCenter(src).x < actorCenter(actor).x ? 'left' : 'right';
      }
      applyActorVisual(actor, facing);
    }
  }

  function drawLinks(force) {
    if (!linksSvg) return;
    const w = floor.clientWidth, h = floor.clientHeight;
    if (!w || !h) return;
    const posSig = [...actors.values()]
      .map((a) => `${a.model.id}:${a.pos.x.toFixed(3)},${a.pos.y.toFixed(3)}`).join('|');
    const ss = structSig(w, h);
    const rebuild = force || ss !== lastStructSig;
    if (!rebuild && posSig === lastLinkSig) return;
    lastLinkSig = posSig;
    // 结构未变：只改几何。朝向只在结构变化时算，避免每帧读 rect 触发强制布局。
    if (!rebuild) { updateLinkGeometry(); return; }
    lastStructSig = ss;
    linksSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    linksSvg.replaceChildren();
    linkNodes = [];
    const defs = document.createElementNS(SVG_NS, 'defs');
    const marker = document.createElementNS(SVG_NS, 'marker');
    marker.setAttribute('id', 'collab-arrow'); marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '9'); marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '5'); marker.setAttribute('markerHeight', '5');
    marker.setAttribute('orient', 'auto-start-reverse');
    const tip = document.createElementNS(SVG_NS, 'path');
    tip.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z'); tip.setAttribute('class', 'collab-arrow-tip');
    marker.append(tip); defs.append(marker); linksSvg.append(defs);
    edges.forEach((edge, i) => {
      const g = edgeGeom(edge);
      if (!g) return;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', g.d); path.setAttribute('class', 'collab-link');
      path.setAttribute('data-edge-index', String(i));
      path.setAttribute('marker-end', 'url(#collab-arrow)');
      const live = edge.turn === activeTurn;
      if (live) path.classList.add('is-active');
      if (selectedId && edge.from !== selectedId && edge.to !== selectedId) path.classList.add('is-dim');
      if (selectedId && (edge.from === selectedId || edge.to === selectedId)) path.classList.add('is-selected');
      const from = actors.get(edge.from), to = actors.get(edge.to);
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = `${aliasOf(from.model)} → ${aliasOf(to.model)}：第 ${edge.turn + 1} 条参考了这条发言`;
      path.append(title); linksSvg.append(path);
      const nodes = { path, tag: null, motion: null };
      linkNodes[i] = nodes;
      const tag = document.createElementNS(SVG_NS, 'text');
      tag.setAttribute('x', String(g.mx)); tag.setAttribute('y', String(g.my - 6));
      tag.setAttribute('class', 'collab-edge-tag'); tag.setAttribute('text-anchor', 'middle');
      tag.setAttribute('data-edge-index', String(i));
      tag.textContent = edge.kind === 'broadcast' ? '1v多' : edge.kind === 'ack' ? '回执' : '1v1';
      linksSvg.append(tag); nodes.tag = tag;
      if (live) {
        const dot = document.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('r', '4'); dot.setAttribute('class', 'collab-pulse');
        const motion = document.createElementNS(SVG_NS, 'animateMotion');
        motion.setAttribute('dur', '1.5s'); motion.setAttribute('repeatCount', 'indefinite');
        motion.setAttribute('path', g.d); motion.setAttribute('data-edge-index', String(i));
        dot.append(motion); linksSvg.append(dot); nodes.motion = motion;
      }
    });
    applyFacing();
  }

  function armDialogueTimer(ms) {
    if (dialogueTimer) clearTimeout(dialogueTimer);
    dialogueTimer = setTimeout(() => { dialogueTimer = null; if (dialogueBox) dialogueBox.hidden = true; }, ms);
  }
  function showDialogue(msg) {
    if (!dialogueBox) return;
    lastMessage = msg;
    const name = $('stage-dialogue-name'), text = $('stage-dialogue-text'), target = $('stage-dialogue-target');
    if (name) name.textContent = KIND_LABEL[msg.kind] + ' · ' + msg.fromName;
    if (text) text.textContent = msg.text.length > 120 ? msg.text.slice(0, 120) + '…' : msg.text;
    if (target) {
      target.textContent = msg.kind === 'task' ? '→ 全体参与模型'
        : msg.kind === 'ack' ? '→ 上级（回执）'
        : msg.kind === 'broadcast' ? '→ 前面 ' + msg.refs.length + ' 位（广播）'
        : '→ ' + (msg.toName || '对方');
    }
    dialogueBox.hidden = false;
    dialogueBox.dataset.kind = msg.kind;
    if (dialogueTimer) clearTimeout(dialogueTimer);
    dialogueTimer = null;
    if (!dialoguePinned) armDialogueTimer(8000);
  }

  function pushMessage(msg) {
    messages.push(Object.assign({ seq: messages.length + 1 }, msg));
    // 内存与磁盘都只留最近 40 条：只裁写盘不裁内存会让列表越用越慢。
    if (messages.length > TURN_LIMIT) messages = messages.slice(-TURN_LIMIT);
    try { write(MESSAGE_KEY, JSON.stringify(messages)); } catch {}
    appendTurn(messages[messages.length - 1]);
    showDialogue(msg);
  }
  function resetDialogue() {
    if (dialogueTimer) clearTimeout(dialogueTimer);
    dialogueTimer = null;
    lastMessage = null;
    if (dialogueBox) dialogueBox.hidden = true;
  }

  function clearMessages() {
    messages = [];
    try { localStorage.removeItem(MESSAGE_KEY); } catch {}
    renderTurns();
    resetDialogue();
    clearArmed = 0;
    statusLine.textContent = '本机交流历史已清空（不可恢复）。';
  }
  function restoreMessages() {
    try {
      const saved = JSON.parse(read(MESSAGE_KEY));
      if (Array.isArray(saved)) messages = saved.filter((m) => m && typeof m.text === 'string').slice(-40);
    } catch { messages = []; }
    // 历史只进列表；启动时不再把上一条对话弹出来常驻画布。
    if (messages.length) renderTurns();
  }

  function buildTurnNode(msg) {
    const li = document.createElement('li');
    li.className = 'collab-turn' + (selectedId === msg.from ? ' is-selected' : '');
    li.dataset.modelId = msg.from;
    li.dataset.kind = msg.kind;
    const idx = document.createElement('span'); idx.className = 'turn-idx';
    idx.textContent = String(msg.seq).padStart(2, '0');
    const body = document.createElement('div'); body.className = 'turn-body';
    const head = document.createElement('div'); head.className = 'turn-head';
    const name = document.createElement('strong'); name.textContent = msg.fromName; name.title = name.textContent;
    const ref = document.createElement('span'); ref.className = 'turn-ref';
    ref.textContent = '参考 ' + (msg.refs ? msg.refs.length : 0) + ' 条';
    head.append(name, ref);
    const kind = document.createElement('div'); kind.className = 'turn-kind';
    kind.textContent = KIND_LABEL[msg.kind] + ' · ' +
      (msg.kind === 'task' ? '→ 全体' : msg.kind === 'ack' ? '→ 上级' : msg.kind === 'broadcast' ? '→ 前面 ' + msg.refs.length + ' 位' : '→ ' + (msg.toName || '对方'));
    const text = document.createElement('p'); text.className = 'turn-text';
    text.textContent = msg.text || '（没有有效输出）'; text.title = msg.text || '';
    body.append(head, kind, text); li.append(idx, body);
    li.addEventListener('click', () => {
      if (msg.from !== 'host') selectActor(msg.from);
      showDialogue(msg);
    });
    return li;
  }

  function renderTurns() {
    if (!turnsList) return;
    turnsList.replaceChildren();
    if (!messages.length) {
      const empty = document.createElement('li'); empty.className = 'collab-empty';
      empty.textContent = '开始一轮讨论后，这里按顺序列出交付任务、1v1 交流与 1v多 广播。';
      turnsList.append(empty);
      if (turnCount) turnCount.textContent = '还没有交流';
      return;
    }
    if (turnCount) turnCount.textContent = `${messages.length} 条交流`;
    for (const msg of messages) turnsList.append(buildTurnNode(msg));
  }

  // 增量追加：每来一条只建一个节点，不重建整张 40 条的列表（选中时不重建）。
  function appendTurn(msg) {
    if (!turnsList) return;
    const empty = turnsList.querySelector('.collab-empty');
    if (empty) empty.remove();
    turnsList.append(buildTurnNode(msg));
    while (turnsList.children.length > TURN_LIMIT) turnsList.firstElementChild.remove();
    if (turnCount) turnCount.textContent = `${messages.length} 条交流`;
  }
  function syncTurnSelection() {
    if (!turnsList) return;
    for (const li of turnsList.children) {
      li.classList.toggle('is-selected', Boolean(selectedId) && li.dataset.modelId === selectedId);
    }
  }

  // 状态列表按 id 复用节点：日志轮询时只改文字，不重建 GIF（重建会闪）。
  function ensureStatusRow(actor) {
    let row = statusRows.get(actor.model.id);
    if (row && row.isConnected) return row;
    row = document.createElement('div');
    row.className = 'status-row'; row.dataset.modelId = actor.model.id;
    const thumb = document.createElement('div'); thumb.className = 'status-thumb';
    const info = document.createElement('div'); info.className = 'status-info';
    const name = document.createElement('div'); name.className = 'status-name';
    const state = document.createElement('div'); state.className = 'status-meta';
    info.append(name, state); row.append(thumb, info);
    row.addEventListener('click', () => selectActor(actor.model.id));
    statusRows.set(actor.model.id, row);
    return row;
  }
  function updateStatusRow(actor) {
    if (!statusList) return;
    const row = ensureStatusRow(actor);
    const choice = currentPet(actor.model);
    const thumb = row.firstElementChild;
    if (choice.indexOf('roster:') === 0 && AVATARS) {
      const src = `url("${AVATARS.R}${choice.slice(7)}.webp")`;
      let box = thumb.querySelector('.thumb-sprite');
      if (!box) {
        thumb.replaceChildren();
        box = document.createElement('span'); box.className = 'thumb-sprite'; thumb.append(box);
      }
      if (box.style.backgroundImage !== src) box.style.backgroundImage = src;
    } else {
      const glyph = choice.indexOf('emoji:') === 0 ? choice.slice(6) : '◈';
      if (thumb.textContent !== glyph) thumb.textContent = glyph;
    }
    const info = row.lastElementChild;
    info.firstElementChild.textContent = aliasOf(actor.model);
    info.firstElementChild.title = aliasOf(actor.model);
    const turnIndex = round.findIndex((t) => t.id === actor.model.id);
    info.lastElementChild.textContent = (STATE_LABEL[actor.el.dataset.state] || '待机')
      + (turnIndex >= 0 ? ` · 第 ${turnIndex + 1} 条` : '')
      + (actor.manualPos ? ' · 已固定' : '');
    row.dataset.state = actor.el.dataset.state;
    row.classList.toggle('is-selected', selectedId === actor.model.id);
  }
  function renderStatusList() {
    if (!statusList) return;
    const live = new Set([...actors.keys()]);
    for (const [id, row] of statusRows) {
      if (!live.has(id)) { row.remove(); statusRows.delete(id); }
    }
    for (const actor of actors.values()) {
      const row = ensureStatusRow(actor);
      if (row.parentElement !== statusList) statusList.append(row);
      updateStatusRow(actor);
    }
    if (actorCount) actorCount.textContent = `${actors.size} 个`;
  }

  function selectActor(id) {
    selectedId = selectedId === id ? null : id;
    for (const [key, actor] of actors) actor.el.classList.toggle('is-selected', key === selectedId);
    syncTurnSelection();
    for (const actor of actors.values()) updateStatusRow(actor);
    lastLinkSig = ''; drawLinks(true);
    if (!running && selectedId) {
      const actor = actors.get(selectedId);
      const last = messages.filter((m) => m.from === selectedId).pop();
      statusLine.textContent = last
        ? `${aliasOf(actor.model)}：最近一条「${KIND_LABEL[last.kind] || '交流'}」，引用了前面 ${(last.refs || []).length} 条；引用连线与右侧记录可对照查看。`
        : `${aliasOf(actor.model)}：还没有参与过交流。`;
    }
  }

  function poke(actor) {
    if (!AVATARS) return;
    if (actor.pokeTimer) clearTimeout(actor.pokeTimer);
    setVisual(actor, 'poke', 1700);
    actor.pokeBubble.textContent = POKE_LINES[Math.floor(Math.random() * POKE_LINES.length)];
    actor.pokeBubble.hidden = false;
    actor.pokeTimer = setTimeout(() => { actor.pokeBubble.hidden = true; actor.pokeTimer = null; }, 1700);
  }

  // 待机节拍：隔几秒随机让一个空闲角色招个手 / 蹦一下。
  // 只挑 waiting / done 且没有临时动作的角色，不打断正在生成的那位；
  // 用一条全局定时器而不是每个角色一个，避免切页后定时器堆积。
  function idlePoke() {
    if (!actors.size) return null;
    const pool = [...actors.values()].filter((a) => {
      const st = a.el.dataset.state;
      return (st === 'waiting' || st === 'done') && !a.visualState;
    });
    if (!pool.length) return null;
    const a = pool[Math.floor(Math.random() * pool.length)];
    const kind = Math.random() < 0.72 ? 'wave' : 'poke';
    setVisual(a, kind, 900);
    return kind;
  }

  // 降低动效开启时整页保持静止：连待机小动作也停，这样「还闪不闪」才是干净的判断。
  function motionReduced() {
    return document.documentElement.dataset.reduceMotion === '1';
  }
  function scheduleIdleBeat() {
    if (idleBeatTimer) clearTimeout(idleBeatTimer);
    idleBeatTimer = null;
    if (page.hidden || motionReduced()) return;
    idleBeatTimer = setTimeout(() => {
      idleBeatTimer = null;
      if (!page.hidden && !running && !motionReduced()) idlePoke();
      scheduleIdleBeat();
    }, 4200 + Math.random() * 6200);
  }

  function makeDraggable(actor) {
    const el = actor.el;
    let start = null, moved = false, lastDragEnd = 0;
    const skip = '.stage-actor-name, .stage-name-input, .outfit-picker';
    el.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || running || event.target.closest(skip)) return;
      start = { x: event.clientX, y: event.clientY, pos: savedPos(actor.model.id) || actor.pos };
      moved = false;
      try { el.setPointerCapture(event.pointerId); } catch {}
      el.classList.add('is-dragging');
    });
    el.addEventListener('pointermove', (event) => {
      if (!start) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      if (!moved) { moved = true; setVisual(actor, 'drag'); }
      const rect = floor.getBoundingClientRect();
      const x = Math.min(0.94, Math.max(0.06, start.pos.x + dx / rect.width));
      const y = Math.min(0.86, Math.max(0.14, start.pos.y + dy / rect.height));
      actor.pos = { x, y };
      setActorPos(el, x, y);
      drawLinks();  // 结构未变，只改 d，不重建 SVG
    });
    const end = () => {
      if (!start) return;
      start = null; el.classList.remove('is-dragging');
      if (moved) {
        actor.manualPos = true;
        write(posKey(actor.model.id), JSON.stringify(actor.pos));
        clearVisual(actor); updateStatusRow(actor);
        drawLinks(); lastDragEnd = Date.now();
      }
      moved = false;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('click', (event) => {
      if (Date.now() - lastDragEnd < 250) return;
      if (moved || event.target.closest(skip)) return;
      selectActor(actor.model.id);
    });
    el.addEventListener('keydown', (event) => {
      // 改名输入框的 Enter 会冒泡到这里；只处理角色本身获得焦点时的按键。
      if (event.target !== el) return;
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectActor(actor.model.id); }
      else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault();
        const r = el.getBoundingClientRect();
        openContextMenu(actor, r.left + 24, r.top + 24, true);
      }
    });
    el.addEventListener('dblclick', (event) => { event.preventDefault(); poke(actor); });
    el.addEventListener('contextmenu', (event) => {
      event.preventDefault(); event.stopPropagation();
      openContextMenu(actor, event.clientX, event.clientY);
    });
  }

  function buildStage() {
    if (running) {
      statusLine.textContent = '本轮讨论进行中，先点「停止本轮」再改参与模型。';
      return;
    }
    stopFollow();
    const picked = checkedIds();
    for (const node of floor.querySelectorAll('.stage-actor')) node.remove();
    // statusRows 被清空后，旧 DOM 行已无人引用，必须先从列表里删掉，否则会越堆越多。
    if (statusList) statusList.replaceChildren();
    actors.clear(); statusRows.clear();
    // 交流历史是跨轮的本机记录：重建画布只清本轮状态，不清历史。
    // 同时从历史的 refs 反推引用边，否则「有 N 条交流」却一条连线都没有，点记录还会说「参考了 N 条」。
    round = []; edges = []; activeTurn = -1; lastLinkSig = '';
    lastStructSig = ''; linkNodes = []; stopFollow();
    resetDialogue();
    const start = messages.findLastIndex ? messages.findLastIndex((m) => m.kind === 'task') : -1;
    messages.slice(Math.max(0, start)).forEach((m, i) => {
      if (m.kind === 'task') return;
      for (const from of (m.refs || [])) edges.push({ from, to: m.from, turn: i, kind: m.kind });
      round.push({ id: m.from, name: m.fromName, refs: m.refs || [], text: m.text });
    });
    for (const id of picked) {
      const model = models.find((m) => m.id === id);
      if (!model) continue;
      const el = document.createElement('div');
      el.className = 'stage-actor'; el.dataset.modelId = id; el.dataset.state = 'waiting';
      el.tabIndex = 0; el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `${aliasOf(model)}，待机；回车选中，Shift+F10 打开设置`);
      const avatar = document.createElement('div'); avatar.className = 'stage-actor-avatar';
      const name = document.createElement('div'); name.className = 'stage-actor-name';
      name.textContent = aliasOf(model); name.title = aliasOf(model);
      const stateEl = document.createElement('div'); stateEl.className = 'stage-actor-state'; stateEl.textContent = '待机';
      const meta = document.createElement('div'); meta.className = 'actor-meta'; meta.textContent = '';
      const bubble = document.createElement('div'); bubble.className = 'stage-actor-bubble'; bubble.hidden = true;
      const pokeBubble = document.createElement('div'); pokeBubble.className = 'actor-poke-bubble'; pokeBubble.hidden = true;
      el.append(pokeBubble, avatar, name, stateEl, meta, bubble);
      floor.append(el);
      const saved = savedPos(id);
      const actor = { model, el, avatar, name, stateEl, meta, bubble, pokeBubble,
        pokeTimer: null, visualState: null, visualTimer: null, picker: null,
        pos: saved || { x: 0.5, y: 0.38 }, manualPos: Boolean(saved), zone: 'rest' };
      setActorPos(el, actor.pos.x, actor.pos.y);
      // 首帧定位完成后再开启过渡，避免「从左上角滑入」。
      requestAnimationFrame(() => el.classList.add('is-placed'));
      actors.set(id, actor);
      name.addEventListener('click', (e) => { e.stopPropagation(); editName(actor); });
      renderAvatar(actor); makeDraggable(actor);
    }
    if (selectedId && !actors.has(selectedId)) selectedId = null;
    for (const [key, actor] of actors) actor.el.classList.toggle('is-selected', key === selectedId);
    pickedHint.textContent = picked.length ? `在线参与 ${picked.length} 个` : '还没有在线模型参与';
    renderTurns(); renderStatusList(); applyPetMode();
    applyEcosystem(true);
  }

  function applyPetMode() {
    const on = Boolean(petToggle && petToggle.checked);
    floor.classList.toggle('pet-mode', on);
    document.body.classList.toggle('collab-pet-on', on);
    const ids = [...actors.keys()];
    for (const [id, actor] of actors) actor.el.hidden = on && ids.length > 1 && id !== ids[0];
    if (on) {
      stopFollow();
      if (linksSvg) linksSvg.replaceChildren();
      linkNodes = []; lastStructSig = '';
    }
    else { lastLinkSig = ''; requestAnimationFrame(() => drawLinks(true)); }
  }

  function renderOffline(list) {
    if (!offlineBox) return;
    offlineBox.replaceChildren();
    if (!list.length) { offlineBox.hidden = true; return; }
    offlineBox.hidden = false;
    const details = document.createElement('details'); details.className = 'offline-details';
    const summary = document.createElement('summary');
    summary.textContent = `离线 / 未连接 ${list.length} 个 · 不参与本轮`;
    details.append(summary);
    const wrap = document.createElement('div'); wrap.className = 'offline-list';
    for (const m of list) {
      const row = document.createElement('div'); row.className = 'offline-row';
      const name = document.createElement('span'); name.textContent = aliasOf(m); name.title = aliasOf(m);
      const btn = document.createElement('button'); btn.type = 'button';
      btn.textContent = '查看'; btn.title = '跳到「模型与额度」查看连接状态与启用方式';
      btn.addEventListener('click', () => {
        document.querySelector('#nav-panel')?.click();
        statusLine.textContent = `「${aliasOf(m)}」当前未连接。本机没有一键唤醒能力：请在「模型与额度」启用连接后，回这里点「刷新模型」重新检测。`;
      });
      row.append(name, btn); wrap.append(row);
    }
    details.append(wrap); offlineBox.append(details);
  }

  async function loadModels() {
    const btn = $('stage-refresh');
    if (btn) btn.disabled = true;
    const before = new Set(checkedIds());
    modelPick.replaceChildren();
    const loading = document.createElement('span');
    loading.className = 'hint'; loading.textContent = '正在读取模型…';
    modelPick.append(loading);
    try {
      const reply = await window.workbench.dispatchModels();
      if (!reply || !reply.ok) throw new Error((reply && reply.error) || '读取失败');
      models = reply.data.models || [];
      const online = models.filter(isOnline);
      const offline = models.filter((m) => !isOnline(m));
      modelPick.replaceChildren();
      for (const m of online) {
        const label = document.createElement('label'); label.className = 'model-pick';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = m.id;
        const dot = document.createElement('i'); dot.className = 'online-dot'; dot.title = '在线 / 已激活';
        const text = document.createElement('span'); text.textContent = aliasOf(m); text.title = aliasOf(m);
        label.append(cb, dot, text); modelPick.append(label);
        cb.addEventListener('change', buildStage);
      }
      if (!online.length) {
        const empty = document.createElement('span'); empty.className = 'hint';
        empty.textContent = '没有在线模型：先到「模型与额度」启用连接，再点「刷新模型」重新检测。';
        modelPick.append(empty);
      }
      const boxes = [...modelPick.querySelectorAll('input[type="checkbox"]')];
      const kept = boxes.filter((o) => before.has(o.value));
      if (kept.length) kept.forEach((o) => { o.checked = true; });
      else boxes.slice(0, 4).forEach((o) => { o.checked = true; });
      renderOffline(offline);
      buildStage();
      statusLine.textContent = `在线 ${online.length} 个、未连接 ${offline.length} 个；已参与 ${checkedIds().length} 个。未连接模型不会被派发。`;
    } catch (error) {
      modelPick.replaceChildren();
      const fail = document.createElement('span'); fail.className = 'hint'; fail.textContent = '读取失败';
      modelPick.append(fail);
      statusLine.textContent = `读取模型失败：${error.message}。请检查「模型与额度」里的连接是否可用，再点「刷新模型」。`;
    } finally { if (btn) btn.disabled = false; }
  }

  async function runTurn(model, prompt, onState) {
    const state = await window.workbench.getState();
    // 停止可能落在 getState / dispatchSend 的前置 await 窗口里，此时 abortTurn 还没赋值；
    // 每个 await 之后都复查一次，避免白等 180 秒兜底。
    if (stopRequested) return null;
    const project = (state && state.project) || '';
    if (!project) { statusLine.textContent = '还没有选择项目：先在「运行与连接」页选择项目。'; return null; }
    let reply;
    try { reply = await window.workbench.dispatchSend({ prompt, modelId: model.id, kind: 'chat', project }); }
    catch { onState('failed'); return null; }
    if (stopRequested || !reply || !reply.ok) { onState('failed'); return null; }
    const taskId = reply.data.id;
    onState('thinking');
    let latest = '';
    return await new Promise((resolve) => {
      let logTimer = null, statusTimer = null, timeout = null, done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        if (logTimer) clearInterval(logTimer);
        if (statusTimer) clearInterval(statusTimer);
        if (timeout) clearTimeout(timeout);
        if (abortTurn === finish) abortTurn = null;
        resolve(value);
      };
      abortTurn = finish;
      // 上一轮 A07 的教训：拿不到终态不能一直转圈，最多等 3 分钟就如实报「状态未明」。
      timeout = setTimeout(() => { onState('failed'); finish(null); }, 180000);
      logTimer = setInterval(async () => {
        if (stopRequested) { finish(null); return; }
        try {
          const live = await window.workbench.dispatchLog(taskId);
          if (live && live.ok) {
            const text = String(live.data.answer || '').trim();
            if (text && text !== latest) { latest = text; onState('speaking'); }
          }
        } catch {}
      }, 600);
      statusTimer = setInterval(async () => {
        if (stopRequested) { finish(null); return; }
        try {
          const s = await window.workbench.dispatchStatus(taskId);
          if (!s || !s.ok) return;
          const task = s.data.task;
          const st = String(task ? (task.status || task.phase) : '').toLowerCase();
          const ans = String(s.data.answer || latest || '').trim();
          if (TERMINAL.includes(st)) finish(((st === 'completed' || st === 'accepted') && ans) ? ans : null);
        } catch {}
      }, 2000);
    });
  }

  async function askAll() {
    if (running) return;
    if (consentBox && !consentBox.checked) {
      statusLine.textContent = '先勾选确认：这一轮会真的调用在线模型，并清空上一轮交流记录。';
      return;
    }
    const list = [...actors.values()];
    if (!list.length) { statusLine.textContent = '先让至少一个在线模型参与。'; return; }
    const q = question.value.trim();
    if (!q) { statusLine.textContent = '先写一句问题。'; question.focus(); return; }
    running = true; stopRequested = false;
    setPickerDisabled(true);
    askBtn.disabled = true; askBtn.hidden = true; if (stopBtn) stopBtn.hidden = false;
    round = []; messages = []; edges = []; activeTurn = -1; selectedId = null; lastLinkSig = '';
    resetDialogue();
    try { localStorage.removeItem(MESSAGE_KEY); } catch {}  // 新一轮从空历史开始，内存与磁盘保持一致
    for (const actor of list) {
      setActorState(actor.model.id, 'waiting');
      actor.el.classList.remove('is-selected');
      actor.meta.textContent = '等待中';
    }
    renderTurns(); renderStatusList(); applyEcosystem(true);
    pushMessage({ from: 'host', fromName: '上级 / 你', kind: 'task', to: 'all', refs: [], text: q });
    const spoken = [];
    try {
      for (let i = 0; i < list.length; i += 1) {
        if (stopRequested) break;
        const actor = list[i];
        const refs = spoken.map((s) => s.id);
        statusLine.textContent = `${i + 1}/${list.length} · ${aliasOf(actor.model)} 正在生成（参考前面 ${refs.length} 条）`;
        actor.meta.textContent = `第 ${i + 1} 条 · 参考 ${refs.length} 条`;
        activeTurn = i;
        const kind = refs.length === 0 ? 'ack' : (refs.length === 1 ? 'chat' : 'broadcast');
        for (const from of refs) edges.push({ from, to: actor.model.id, turn: i, kind });
        for (const from of refs) { const src = actors.get(from); if (src) setVisual(src, 'poke', 1500); }
        lastLinkSig = ''; drawLinks(true);
        const prompt = window.__chatMulti.buildDiscussionPrompt({ question: q, spoken });
        const answer = await runTurn(actor.model, prompt, (state) => setActorState(actor.model.id, state));
        if (stopRequested) break;
        const text = answer || '（没有有效输出）';
        spoken.push({ modelName: aliasOf(actor.model), id: actor.model.id, text });
        round.push({ id: actor.model.id, name: aliasOf(actor.model), refs, text: answer || '' });
        const toId = refs.length ? refs[refs.length - 1] : 'host';
        const toName = refs.length ? aliasOf(actors.get(toId)?.model || { name: toId }) : '上级';
        setActorState(actor.model.id, answer ? 'done' : 'failed', text);
        pushMessage({ from: actor.model.id, fromName: aliasOf(actor.model), kind,
          to: toId, toName, refs: refs.slice(), text: answer || '（没有有效输出）' });
        lastLinkSig = ''; drawLinks(true);
      }
      activeTurn = -1; lastLinkSig = ''; drawLinks(true);
      statusLine.textContent = stopRequested
        ? `已停止：完成 ${spoken.length}/${list.length} 位。本轮已产生的交流保留在本机；上一轮记录在点「开始讨论」时已清空。`
        : `本轮结束：${spoken.length}/${list.length} 位有输出。点一条记录看它参考了谁。`;
    } finally {
      running = false; stopRequested = false; abortTurn = null;
      setPickerDisabled(false);
      askBtn.disabled = false; askBtn.hidden = false; if (stopBtn) stopBtn.hidden = true;
    }
  }

  // ---- 对话框：默认看完就淡出，鼠标悬停暂停，点一下立即收起 ----
  if (dialogueBox) {
    dialogueBox.title = '说完 8 秒自动收起；悬停暂停；点一下立即收起；右键角色可设为保持显示';
    dialogueBox.addEventListener('mouseenter', () => {
      if (dialogueTimer) clearTimeout(dialogueTimer);
      dialogueTimer = null;
    });
    dialogueBox.addEventListener('mouseleave', () => {
      if (!dialoguePinned && !dialogueBox.hidden) armDialogueTimer(2500);
    });
    dialogueBox.addEventListener('click', () => {
      if (dialogueTimer) clearTimeout(dialogueTimer);
      dialogueTimer = null;
      dialogueBox.hidden = true;
    });
  }

  // ---- 绑定 ----
  document.addEventListener('click', (event) => {
    if (event.target.closest('.stage-context-menu, .outfit-picker')) return;
    closeContextMenu();
  });
  if (contextMenu) {
    contextMenu.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const items = [...contextMenu.querySelectorAll('.ctx-outfits .outfit, [data-action]')];
      const i = items.indexOf(document.activeElement);
      if (!items.length) return;
      event.preventDefault();
      items[(i + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    });
    contextMenu.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-action]');
      if (btn) { event.stopPropagation(); handleContextAction(btn.dataset.action); }
    });
  }
  floor.addEventListener('contextmenu', (event) => {
    if (event.target.closest('.stage-actor')) return;
    event.preventDefault();
    closeContextMenu();
    statusLine.textContent = '在角色上点右键可换形象、改显示名称、固定位置、切换自动归位，或去「模型与额度」查看连接。';
  });
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const wasInMenu = contextMenu && contextMenu.contains(document.activeElement);
    const returnTo = wasInMenu && contextActor ? contextActor.el : null;
    closeContextMenu();
    if (returnTo) returnTo.focus();
  });
  window.addEventListener('resize', () => {
    applyEcosystem(true);
    lastLinkSig = ''; drawLinks(true);
  });
  if ($('stage-auto-place')) $('stage-auto-place').addEventListener('change', (event) => {
    autoPlace = Boolean(event.target.checked);
    if (autoPlace) applyEcosystem(true);
    statusLine.textContent = `自动归位已${autoPlace ? '打开' : '关闭'}。`;
  });
  if ($('stage-pet-open')) $('stage-pet-open').addEventListener('click', async () => {
    const reply = await window.workbench.petOpen?.();
    statusLine.textContent = reply && reply.ok
      ? '桌宠已悬浮到桌面：可拖动、锁定、置顶、发表情、连模型聊一句。'
      : `打开桌宠失败：${(reply && reply.error) || '未接入'}`;
  });
  if ($('stage-refresh')) $('stage-refresh').addEventListener('click', loadModels);
  if (petToggle) petToggle.addEventListener('change', applyPetMode);
  // 「降低动效」切换后立刻停掉或恢复待机节拍，不用重开页面。
  for (const box of document.querySelectorAll('[data-motion-toggle]')) {
    box.addEventListener('change', () => {
      if (box.checked) {
        if (idleBeatTimer) { clearTimeout(idleBeatTimer); idleBeatTimer = null; }
        stopFollow();
      } else if (!page.hidden) scheduleIdleBeat();
    });
  }
  if (consentBox) consentBox.addEventListener('change', () => {
    askBtn.disabled = !consentBox.checked;
    if (!consentBox.checked) statusLine.textContent = '未勾选确认时不会派发任何模型。';
  });
  askBtn.addEventListener('click', askAll);
  if (stopBtn) stopBtn.addEventListener('click', () => {
    stopRequested = true;
    if (abortTurn) abortTurn(null);
    statusLine.textContent = '正在停止本轮…本轮已产生的交流会保留。';
  });
  question.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); askAll(); } });

  function refreshView() {
    for (const actor of actors.values()) {
      actor.name.textContent = aliasOf(actor.model);
      actor.name.title = actor.name.textContent;
    }
    renderTurns(); renderStatusList();
    lastLinkSig = ''; requestAnimationFrame(() => drawLinks(true));
  }
  function show() {
    for (const id of PAGE_IDS) { const el = $(id); if (el) el.hidden = id !== 'stage-page'; }
    window.__chatUi?.hidePage?.();
    window.__modelsUi?.hide?.();
    for (const b of document.querySelectorAll('.nav-button')) b.classList.toggle('active', b.id === 'nav-stage');
    if (!models.length) loadModels();
    else {
      refreshView();
      // 页面从 hidden 变可见时才有真实宽度，按当前尺寸重算一次位置。
      requestAnimationFrame(() => applyEcosystem(true));
    }
    // 首屏走 loadModels 的分支也必须启动待机节拍，否则角色永远站得笔直。
    scheduleIdleBeat();
  }
  function hide() {
    page.hidden = true;
    $('nav-stage')?.classList.remove('active');
    closeContextMenu();
    stopFollow();
    if (idleBeatTimer) { clearTimeout(idleBeatTimer); idleBeatTimer = null; }
    if (!dialoguePinned) resetDialogue();
  }

  $('nav-stage').addEventListener('click', show);
  for (const id of ['nav-memory', 'nav-chat', 'nav-tasks', 'nav-designer', 'nav-panel']) {
    const b = $(id); if (b) b.addEventListener('click', hide);
  }

  restoreMessages();
  window.__stageUi = { show, hide, refresh: loadModels, drawLinks, buildStage, refreshView, applyEcosystem, clearMessages, idlePoke };
})();
