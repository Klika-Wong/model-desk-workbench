/* 协作视图：把「谁参考了谁」画成可点、可拖的关系图。
   形象是会动的拟人角色；这里只做展示与派发编排，不替模型编内容。 */
(() => {
  const $ = (id) => document.getElementById(id);
  const page = $('stage-page');
  const modelPick = $('stage-models');
  const floor = $('stage-floor');
  const linksSvg = $('stage-links');
  const turnsList = $('stage-turns');
  const turnCount = $('stage-turn-count');
  const question = $('stage-question');
  const askBtn = $('stage-ask');
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
  let round = [];       // { id, name, refs: [id], text }
  let edges = [];       // { from, to, turn }
  let activeTurn = -1;

  const aliasOf = (model) => (window.__modelAlias ? window.__modelAlias.of(model) : (model.name || model.id));
  const petKey = (id) => 'pet-avatar:' + id;
  const posKey = (id) => 'collab-pos:' + id;
  const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch {} };

  function currentPet(model) {
    return read(petKey(model.id)) || (AVATARS ? AVATARS.defaultChoice(model) : 'character');
  }

  function savedPos(id) {
    try {
      const raw = read(posKey(id));
      if (!raw) return null;
      const v = JSON.parse(raw);
      if (typeof v.x === 'number' && typeof v.y === 'number') {
        return { x: Math.min(0.94, Math.max(0.06, v.x)), y: Math.min(0.88, Math.max(0.12, v.y)) };
      }
    } catch {}
    return null;
  }

  function renderAvatar(actor, state) {
    if (!AVATARS) { actor.avatar.textContent = '🐳'; return; }
    AVATARS.mount(actor.avatar, actor.model, currentPet(actor.model), { imgClass: 'avatar-figure', state: state || actor.el.dataset.state || 'waiting' });
  }

  function cyclePet(actor) {
    const options = AVATARS ? AVATARS.optionsFor(actor.model) : ['character'];
    const idx = options.indexOf(currentPet(actor.model));
    write(petKey(actor.model.id), options[(idx + 1) % options.length]);
    renderAvatar(actor);
  }

  function editName(actor) {
    const input = document.createElement('input');
    input.className = 'stage-name-input';
    input.value = aliasOf(actor.model);
    input.maxLength = 24;
    actor.name.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const commit = (save) => {
      if (done) return;
      done = true;
      if (save) {
        window.__modelAlias?.set(actor.model.id, input.value.trim());
        window.__chatUi?.refreshModelLabels?.();
        window.__dispatchUi?.refreshModelLabels?.();
      }
      input.replaceWith(actor.name);
      actor.name.textContent = aliasOf(actor.model);
      renderTurns();
      statusLine.textContent = `形象 ID 已${save ? `改为「${aliasOf(actor.model)}」` : '取消修改'}。`;
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(true); }
      else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
    });
    input.addEventListener('blur', () => commit(true));
  }

  function setActorState(id, state, text) {
    const actor = actors.get(id);
    if (!actor) return;
    actor.el.dataset.state = state;
    actor.stateEl.textContent = STATE_LABEL[state] || state;
    const img = actor.avatar.querySelector('img[data-avatar]');
    if (img && AVATARS) {
      const next = AVATARS.stateFile(actor.avatar.dataset.avatarChoice, state);
      if (next && img.getAttribute('src') !== next) img.src = next;
    }
    actor.avatar.dataset.avatarState = state;
    if (state === 'done' || state === 'failed') {
      if (text) {
        actor.bubble.hidden = false;
        actor.bubble.textContent = text.length > 26 ? text.slice(0, 26) + '…' : text;
      }
    } else {
      actor.bubble.hidden = true;
      actor.bubble.textContent = '';
    }
  }

  function actorCenter(actor) {
    const fr = floor.getBoundingClientRect();
    const ar = actor.el.getBoundingClientRect();
    return { x: ar.left - fr.left + ar.width / 2, y: ar.top - fr.top + ar.height / 2 };
  }

  // 连线：从「被参考的发言人」指向「正在生成的发言人」，箭头表示信息流向。
  function drawLinks() {
    if (!linksSvg) return;
    const w = floor.clientWidth;
    const h = floor.clientHeight;
    if (!w || !h) return;
    linksSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    linksSvg.replaceChildren();
    const defs = document.createElementNS(SVG_NS, 'defs');
    const marker = document.createElementNS(SVG_NS, 'marker');
    marker.setAttribute('id', 'collab-arrow');
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '9');
    marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '5');
    marker.setAttribute('markerHeight', '5');
    marker.setAttribute('orient', 'auto-start-reverse');
    const tip = document.createElementNS(SVG_NS, 'path');
    tip.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
    tip.setAttribute('class', 'collab-arrow-tip');
    marker.append(tip);
    defs.append(marker);
    linksSvg.append(defs);
    for (const edge of edges) {
      const from = actors.get(edge.from);
      const to = actors.get(edge.to);
      if (!from || !to || from.el.hidden || to.el.hidden) continue;
      const a = actorCenter(from);
      const b = actorCenter(to);
      const path = document.createElementNS(SVG_NS, 'path');
      const mx = (a.x + b.x) / 2;
      const my = Math.min(a.y, b.y) - Math.min(70, Math.abs(b.x - a.x) * 0.16 + 24);
      path.setAttribute('d', `M ${a.x} ${a.y - 30} Q ${mx} ${my} ${b.x} ${b.y - 30}`);
      path.setAttribute('class', 'collab-link');
      path.setAttribute('marker-end', 'url(#collab-arrow)');
      if (edge.turn === activeTurn) path.classList.add('is-active');
      if (selectedId && edge.from !== selectedId && edge.to !== selectedId) path.classList.add('is-dim');
      if (selectedId && (edge.from === selectedId || edge.to === selectedId)) path.classList.add('is-selected');
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = `${aliasOf(from.model)} → ${aliasOf(to.model)}：第 ${edge.turn + 1} 位参考了这条发言`;
      path.append(title);
      linksSvg.append(path);
    }
  }

  function renderTurns() {
    if (!turnsList) return;
    turnsList.replaceChildren();
    if (!round.length) {
      const empty = document.createElement('li');
      empty.className = 'collab-empty';
      empty.textContent = '开始一轮讨论后，这里按顺序记下每位参考了谁、说了什么。';
      turnsList.append(empty);
      if (turnCount) turnCount.textContent = '还没有发言';
      return;
    }
    if (turnCount) turnCount.textContent = `${round.length} 条发言`;
    round.forEach((turn, i) => {
      const li = document.createElement('li');
      li.className = 'collab-turn' + (selectedId === turn.id ? ' is-selected' : '');
      li.dataset.modelId = turn.id;
      const idx = document.createElement('span');
      idx.className = 'turn-idx';
      idx.textContent = String(i + 1).padStart(2, '0');
      const body = document.createElement('div');
      body.className = 'turn-body';
      const head = document.createElement('div');
      head.className = 'turn-head';
      const name = document.createElement('strong');
      name.textContent = aliasOf(actors.get(turn.id)?.model || { id: turn.id, name: turn.name });
      const ref = document.createElement('span');
      ref.className = 'turn-ref';
      ref.textContent = turn.refs.length ? `参考 ${turn.refs.length} 条` : '首条 · 无参考';
      head.append(name, ref);
      const text = document.createElement('p');
      text.className = 'turn-text';
      text.textContent = turn.text || '（没有有效输出）';
      text.title = turn.text || '';
      body.append(head, text);
      li.append(idx, body);
      li.addEventListener('click', () => selectActor(turn.id));
      turnsList.append(li);
    });
  }

  function selectActor(id) {
    selectedId = selectedId === id ? null : id;
    for (const [key, actor] of actors) actor.el.classList.toggle('is-selected', key === selectedId);
    renderTurns();
    drawLinks();
    if (!running && selectedId) {
      const actor = actors.get(selectedId);
      const turnIndex = round.findIndex((t) => t.id === selectedId);
      const refs = turnIndex >= 0 ? round[turnIndex].refs.length : 0;
      statusLine.textContent = turnIndex >= 0
        ? `${aliasOf(actor.model)}：本轮第 ${turnIndex + 1} 条，参考了前面 ${refs} 条发言。`
        : `${aliasOf(actor.model)}：本轮还没有发言。`;
    }
  }

  function poke(actor) {
    if (!AVATARS) return;
    if (actor.pokeTimer) clearTimeout(actor.pokeTimer);
    const state = actor.el.dataset.state || 'waiting';
    renderAvatar(actor, 'poke');
    actor.avatar.dataset.avatarState = 'poke';
    actor.pokeBubble.textContent = POKE_LINES[Math.floor(Math.random() * POKE_LINES.length)];
    actor.pokeBubble.hidden = false;
    actor.pokeTimer = setTimeout(() => {
      actor.pokeBubble.hidden = true;
      renderAvatar(actor, state);
      actor.pokeTimer = null;
    }, 1700);
  }

  function makeDraggable(actor) {
    const el = actor.el;
    let start = null;
    let moved = false;
    let lastDragEnd = 0;
    el.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || running) return;
      if (event.target.closest('.stage-actor-name, .stage-name-input, .actor-swap')) return;
      start = { x: event.clientX, y: event.clientY, pos: savedPos(actor.model.id) || actor.pos };
      moved = false;
      try { el.setPointerCapture(event.pointerId); } catch {}
      el.classList.add('is-dragging');
    });
    el.addEventListener('pointermove', (event) => {
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 5) return;
      if (!moved) {
        moved = true;
        renderAvatar(actor, 'drag');
        actor.avatar.dataset.avatarState = 'drag';
      }
      const rect = floor.getBoundingClientRect();
      const x = Math.min(0.94, Math.max(0.06, start.pos.x + dx / rect.width));
      const y = Math.min(0.88, Math.max(0.12, start.pos.y + dy / rect.height));
      actor.pos = { x, y };
      el.style.left = (x * 100) + '%';
      el.style.top = (y * 100) + '%';
      drawLinks();
    });
    const end = () => {
      if (!start) return;
      start = null;
      el.classList.remove('is-dragging');
      if (moved) {
        write(posKey(actor.model.id), JSON.stringify(actor.pos));
        renderAvatar(actor, el.dataset.state || 'waiting');
        drawLinks();
        lastDragEnd = Date.now();
      }
      moved = false;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('click', (event) => {
      // 拖完那一下浏览器还会补一个 click，别把它当成"选中"。
      if (Date.now() - lastDragEnd < 250) return;
      if (moved || event.target.closest('.stage-actor-name, .stage-name-input, .actor-swap')) return;
      selectActor(actor.model.id);
    });
    el.addEventListener('dblclick', (event) => {
      event.preventDefault();
      poke(actor);
    });
  }

  function buildStage() {
    const picked = [...modelPick.selectedOptions].map((o) => o.value);
    for (const node of floor.querySelectorAll('.stage-actor')) node.remove();
    actors.clear();
    round = [];
    edges = [];
    activeTurn = -1;
    const n = picked.length;
    picked.forEach((id, i) => {
      const model = models.find((m) => m.id === id);
      if (!model) return;
      const el = document.createElement('div');
      el.className = 'stage-actor';
      el.dataset.modelId = id;
      el.dataset.state = 'waiting';
      const avatar = document.createElement('div');
      avatar.className = 'stage-actor-avatar';
      const swap = document.createElement('button');
      swap.className = 'actor-swap';
      swap.type = 'button';
      swap.textContent = '⇄';
      swap.title = '换一个形象';
      swap.addEventListener('click', (e) => { e.stopPropagation(); cyclePet({ model, el, avatar }); });
      const name = document.createElement('div');
      name.className = 'stage-actor-name';
      name.textContent = aliasOf(model);
      name.title = '点击改 ID';
      const stateEl = document.createElement('div');
      stateEl.className = 'stage-actor-state';
      stateEl.textContent = '待机';
      const meta = document.createElement('div');
      meta.className = 'actor-meta';
      meta.textContent = `第 ${i + 1} 位`;
      const bubble = document.createElement('div');
      bubble.className = 'stage-actor-bubble';
      bubble.hidden = true;
      const pokeBubble = document.createElement('div');
      pokeBubble.className = 'actor-poke-bubble';
      pokeBubble.hidden = true;
      el.append(pokeBubble, swap, avatar, name, stateEl, meta, bubble);
      floor.append(el);
      const actor = { model, el, avatar, name, stateEl, meta, bubble, pokeBubble, pokeTimer: null, pos: null };
      // 默认同一水平线、按等分铺满，避免节点文字互相压住；用户可以自己拖开。
      actor.pos = savedPos(id) || { x: (i + 0.5) / n, y: 0.4 };
      el.style.left = (actor.pos.x * 100) + '%';
      el.style.top = (actor.pos.y * 100) + '%';
      actors.set(id, actor);
      name.addEventListener('click', (e) => { e.stopPropagation(); editName(actor); });
      renderAvatar(actor);
      makeDraggable(actor);
    });
    if (selectedId && !actors.has(selectedId)) selectedId = null;
    for (const [key, actor] of actors) actor.el.classList.toggle('is-selected', key === selectedId);
    pickedHint.textContent = picked.length ? `已选 ${picked.length} 个` : '还没勾选模型';
    renderTurns();
    applyPetMode();
    requestAnimationFrame(drawLinks);
  }

  function applyPetMode() {
    const on = Boolean(petToggle && petToggle.checked);
    floor.classList.toggle('pet-mode', on);
    document.body.classList.toggle('collab-pet-on', on);
    const ids = [...actors.keys()];
    for (const [id, actor] of actors) actor.el.hidden = on && ids.length > 1 && id !== ids[0];
    if (on) { if (linksSvg) linksSvg.replaceChildren(); }
    else requestAnimationFrame(drawLinks);
  }

  async function loadModels() {
    const btn = $('stage-refresh');
    if (btn) btn.disabled = true;
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '正在读取模型…';
    modelPick.replaceChildren(placeholder);
    try {
      const reply = await window.workbench.dispatchModels();
      if (!reply || !reply.ok) throw new Error((reply && reply.error) || '读取失败');
      models = reply.data.models || [];
      const before = new Set([...modelPick.options].filter((o) => o.selected).map((o) => o.value));
      modelPick.replaceChildren();
      for (const m of models) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = aliasOf(m);
        modelPick.append(opt);
      }
      const kept = [...modelPick.options].filter((o) => before.has(o.value));
      if (kept.length) kept.forEach((o) => { o.selected = true; });
      else for (const opt of [...modelPick.options].slice(0, 2)) opt.selected = true;
      buildStage();
      statusLine.textContent = `已读取 ${models.length} 个模型。`;
    } catch (error) {
      modelPick.replaceChildren();
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '读取失败';
      modelPick.append(opt);
      statusLine.textContent = `读取模型失败：${error.message}`;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function runTurn(model, prompt, onState) {
    const state = await window.workbench.getState();
    const project = (state && state.project) || '';
    if (!project) { statusLine.textContent = '还没有选择项目：先在「运行与连接」页选择项目。'; return null; }
    let reply;
    try { reply = await window.workbench.dispatchSend({ prompt, modelId: model.id, kind: 'chat', project }); }
    catch { onState('failed'); return null; }
    if (!reply || !reply.ok) { onState('failed'); return null; }
    const taskId = reply.data.id;
    onState('thinking');
    let latest = '';
    return await new Promise((resolve) => {
      let logTimer = null;
      let statusTimer = null;
      const finish = (value) => {
        if (logTimer) clearInterval(logTimer);
        if (statusTimer) clearInterval(statusTimer);
        logTimer = null; statusTimer = null;
        resolve(value);
      };
      logTimer = setInterval(async () => {
        try {
          const live = await window.workbench.dispatchLog(taskId);
          if (live && live.ok) {
            const text = String(live.data.answer || '').trim();
            if (text && text !== latest) { latest = text; onState('speaking'); }
          }
        } catch {}
      }, 600);
      statusTimer = setInterval(async () => {
        try {
          const s = await window.workbench.dispatchStatus(taskId);
          if (!s || !s.ok) return;
          const task = s.data.task;
          const st = String(task ? (task.status || task.phase) : '').toLowerCase();
          const ans = String(s.data.answer || latest || '').trim();
          if (TERMINAL.includes(st)) {
            const ok = (st === 'completed' || st === 'accepted') && ans;
            finish(ok ? ans : null);
          }
        } catch {}
      }, 2000);
    });
  }

  async function askAll() {
    if (running) return;
    const list = [...actors.values()];
    if (!list.length) { statusLine.textContent = '先勾选至少一个模型。'; return; }
    const q = question.value.trim();
    if (!q) { statusLine.textContent = '先写一句问题。'; question.focus(); return; }
    running = true;
    askBtn.disabled = true;
    round = [];
    edges = [];
    activeTurn = -1;
    selectedId = null;
    for (const actor of list) {
      setActorState(actor.model.id, 'waiting');
      actor.el.classList.remove('is-selected');
      actor.meta.textContent = '等待中';
    }
    renderTurns();
    drawLinks();
    const spoken = [];
    try {
      for (let i = 0; i < list.length; i += 1) {
        const actor = list[i];
        const refs = spoken.map((s) => s.id);
        statusLine.textContent = `${i + 1}/${list.length} · ${aliasOf(actor.model)} 正在生成（参考前面 ${refs.length} 条）`;
        actor.meta.textContent = `第 ${i + 1} 条 · 参考 ${refs.length} 条`;
        activeTurn = i;
        for (const from of refs) edges.push({ from, to: actor.model.id, turn: i });
        drawLinks();
        const prompt = window.__chatMulti.buildDiscussionPrompt({ question: q, spoken });
        const answer = await runTurn(actor.model, prompt, (state) => setActorState(actor.model.id, state));
        const text = answer || '（没有有效输出）';
        spoken.push({ modelName: aliasOf(actor.model), id: actor.model.id, text });
        round.push({ id: actor.model.id, name: aliasOf(actor.model), refs, text: answer || '' });
        setActorState(actor.model.id, answer ? 'done' : 'failed', text);
        renderTurns();
        drawLinks();
      }
      activeTurn = -1;
      drawLinks();
      statusLine.textContent = `本轮结束：${spoken.length}/${list.length} 位有输出。点一条记录看它参考了谁。`;
    } finally {
      running = false;
      askBtn.disabled = false;
    }
  }

  modelPick.addEventListener('change', buildStage);
  if ($('stage-refresh')) $('stage-refresh').addEventListener('click', loadModels);
  if (petToggle) petToggle.addEventListener('change', applyPetMode);
  askBtn.addEventListener('click', askAll);
  question.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); askAll(); } });
  window.addEventListener('resize', drawLinks);

  // 切回本页只刷新名字和连线，不重建节点：本轮讨论记录要留着。
  function refreshView() {
    for (const actor of actors.values()) actor.name.textContent = aliasOf(actor.model);
    renderTurns();
    requestAnimationFrame(drawLinks);
  }

  function show() {
    for (const id of PAGE_IDS) { const el = $(id); if (el) el.hidden = id !== 'stage-page'; }
    window.__chatUi?.hidePage?.();
    window.__modelsUi?.hide?.();
    for (const b of document.querySelectorAll('.nav-button')) b.classList.toggle('active', b.id === 'nav-stage');
    if (!models.length) loadModels();
    else refreshView();
  }
  function hide() {
    page.hidden = true;
    $('nav-stage')?.classList.remove('active');
  }

  $('nav-stage').addEventListener('click', show);
  for (const id of ['nav-memory', 'nav-chat', 'nav-tasks', 'nav-designer', 'nav-panel']) {
    const b = $(id);
    if (b) b.addEventListener('click', hide);
  }

  window.__stageUi = { show, hide, refresh: loadModels, drawLinks, buildStage, refreshView };
})();
