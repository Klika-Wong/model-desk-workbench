/* 协作视图：把「谁参考了谁」画成看得见的关系，角色会朝向、会传递、会反应。
   只做展示与派发编排；状态来自真实派发，不替模型编内容。 */
(() => {
  const $ = (id) => document.getElementById(id);
  const page = $('stage-page');
  const modelPick = $('stage-models');
  const floor = $('stage-floor');
  const linksSvg = $('stage-links');
  const turnsList = $('stage-turns');
  const turnCount = $('stage-turn-count');
  const statusList = $('stage-status-list');
  const actorCount = $('stage-actor-count');
  const sceneLabel = $('stage-scene-label');
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
  const SCENE_LABEL = { discuss: '讨论中', work: '工作中', slack: '摸鱼中' };
  const SVG_NS = 'http://www.w3.org/2000/svg';

  let models = [];
  let actors = new Map();
  let running = false;
  let selectedId = null;
  let round = [];
  let edges = [];
  let activeTurn = -1;
  let scene = 'discuss';

  const aliasOf = (model) => (window.__modelAlias ? window.__modelAlias.of(model) : (model.name || model.id));
  const petKey = (id) => 'pet-avatar:' + id;
  const posKey = (id) => 'collab-pos:' + id;
  const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, value); } catch {} };

  function currentPet(model) {
    return read(petKey(model.id)) || (AVATARS ? AVATARS.defaultChoice(model) : 'character');
  }
  function setPet(id, value) { write(petKey(id), value); }
  function checkedIds() {
    return [...modelPick.querySelectorAll('input[type="checkbox"]:checked')].map((i) => i.value);
  }

  function savedPos(id) {
    try {
      const raw = read(posKey(id));
      if (!raw) return null;
      const v = JSON.parse(raw);
      if (typeof v.x === 'number' && typeof v.y === 'number') {
        return { x: Math.min(0.93, Math.max(0.07, v.x)), y: Math.min(0.86, Math.max(0.14, v.y)) };
      }
    } catch {}
    return null;
  }

  function renderAvatar(actor, state, facing) {
    if (!AVATARS) { actor.avatar.textContent = '🐳'; return; }
    AVATARS.mount(actor.avatar, actor.model, currentPet(actor.model), {
      imgClass: 'avatar-figure', state: state || actor.el.dataset.state || 'waiting', scene, facing,
    });
  }

  function outfitChip(choice, cur, actor, picker) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'outfit' + (choice.value === cur ? ' is-active' : '');
    btn.title = choice.label;
    btn.dataset.value = choice.value;
    if (choice.thumb) {
      const img = document.createElement('img');
      img.src = choice.thumb; img.alt = '';
      btn.append(img);
    } else btn.textContent = choice.glyph || '·';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setPet(actor.model.id, choice.value);
      renderAvatar(actor);
      refreshOutfits(actor);
      renderStatusList();
      if (picker) { picker.remove(); actor.picker = null; }
    });
    return btn;
  }

  function refreshOutfits(actor) {
    if (!AVATARS || !actor.outfits) return;
    const choices = AVATARS.choicesFor(actor.model);
    const cur = currentPet(actor.model);
    actor.outfits.replaceChildren();
    for (const choice of choices.filter((c) => c.own).slice(0, 2)) {
      actor.outfits.append(outfitChip(choice, cur, actor, null));
    }
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'outfit-more';
    more.textContent = '＋';
    more.title = '打开形象库（' + choices.length + ' 个可选）';
    more.addEventListener('click', (e) => { e.stopPropagation(); toggleOutfitPicker(actor, choices, cur); });
    actor.outfits.append(more);
  }

  function toggleOutfitPicker(actor, choices, cur) {
    if (actor.picker) { actor.picker.remove(); actor.picker = null; return; }
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
        const img = document.createElement('img');
        img.src = choice.thumb; img.alt = '';
        item.append(img);
      } else {
        const glyph = document.createElement('span');
        glyph.className = 'outfit-glyph';
        glyph.textContent = choice.glyph || '·';
        item.append(glyph);
      }
      const cap = document.createElement('span');
      cap.textContent = choice.label;
      item.append(cap);
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        setPet(actor.model.id, choice.value);
        renderAvatar(actor);
        refreshOutfits(actor);
        renderStatusList();
        picker.remove(); actor.picker = null;
      });
      grid.append(item);
    }
    picker.append(grid);
    const foot = document.createElement('p');
    foot.className = 'hint';
    foot.textContent = '手绘 Q 版来自 llm-pet（ZipZipPipe，仅非商业 · 需署名）';
    picker.append(foot);
    actor.el.append(picker);
    actor.picker = picker;
  }

  function editName(actor) {
    const input = document.createElement('input');
    input.className = 'stage-name-input';
    input.value = aliasOf(actor.model);
    input.maxLength = 40;
    actor.name.replaceWith(input);
    input.focus(); input.select();
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
      actor.name.title = actor.name.textContent;
      renderTurns(); renderStatusList();
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
    AVATARS?.updateState(actor.avatar, currentPet(actor.model), state, scene);
    if ((state === 'done' || state === 'failed') && text) {
      actor.bubble.hidden = false;
      actor.bubble.textContent = text.length > 26 ? text.slice(0, 26) + '…' : text;
    } else { actor.bubble.hidden = true; actor.bubble.textContent = ''; }
    renderStatusList();
  }

  function actorCenter(actor) {
    const fr = floor.getBoundingClientRect();
    const ar = actor.el.getBoundingClientRect();
    return { x: ar.left - fr.left + ar.width / 2, y: ar.top - fr.top + ar.height / 2 };
  }

  function drawLinks() {
    if (!linksSvg) return;
    const w = floor.clientWidth, h = floor.clientHeight;
    if (!w || !h) return;
    linksSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    linksSvg.replaceChildren();
    const defs = document.createElementNS(SVG_NS, 'defs');
    const marker = document.createElementNS(SVG_NS, 'marker');
    marker.setAttribute('id', 'collab-arrow');
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '9'); marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '5'); marker.setAttribute('markerHeight', '5');
    marker.setAttribute('orient', 'auto-start-reverse');
    const tip = document.createElementNS(SVG_NS, 'path');
    tip.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
    tip.setAttribute('class', 'collab-arrow-tip');
    marker.append(tip); defs.append(marker); linksSvg.append(defs);
    for (const edge of edges) {
      const from = actors.get(edge.from), to = actors.get(edge.to);
      if (!from || !to || from.el.hidden || to.el.hidden) continue;
      const a = actorCenter(from), b = actorCenter(to);
      const mx = (a.x + b.x) / 2;
      const my = Math.min(a.y, b.y) - Math.min(74, Math.abs(b.x - a.x) * 0.16 + 26);
      const d = `M ${a.x} ${a.y - 30} Q ${mx} ${my} ${b.x} ${b.y - 30}`;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', 'collab-link');
      path.setAttribute('marker-end', 'url(#collab-arrow)');
      const live = edge.turn === activeTurn;
      if (live) path.classList.add('is-active');
      if (selectedId && edge.from !== selectedId && edge.to !== selectedId) path.classList.add('is-dim');
      if (selectedId && (edge.from === selectedId || edge.to === selectedId)) path.classList.add('is-selected');
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = `${aliasOf(from.model)} → ${aliasOf(to.model)}：第 ${edge.turn + 1} 条参考了这条发言`;
      path.append(title); linksSvg.append(path);
      if (live) {
        const dot = document.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('r', '4'); dot.setAttribute('class', 'collab-pulse');
        const motion = document.createElementNS(SVG_NS, 'animateMotion');
        motion.setAttribute('dur', '1.5s'); motion.setAttribute('repeatCount', 'indefinite');
        motion.setAttribute('path', d);
        dot.append(motion); linksSvg.append(dot);
      }
    }
    for (const [id, actor] of actors) {
      const live = edges.find((e) => e.turn === activeTurn && e.to === id);
      let facing = 'right';
      if (live) {
        const src = actors.get(live.from);
        if (src) facing = actorCenter(src).x < actorCenter(actor).x ? 'left' : 'right';
      }
      AVATARS?.updateState(actor.avatar, currentPet(actor.model), actor.el.dataset.state || 'waiting', scene, facing);
    }
  }

  function renderTurns() {
    if (!turnsList) return;
    turnsList.replaceChildren();
    if (!round.length) {
      const empty = document.createElement('li');
      empty.className = 'collab-empty';
      empty.textContent = '开始一轮讨论后，这里按顺序记下每条参考了谁、说了什么。';
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
      idx.className = 'turn-idx'; idx.textContent = String(i + 1).padStart(2, '0');
      const body = document.createElement('div'); body.className = 'turn-body';
      const head = document.createElement('div'); head.className = 'turn-head';
      const name = document.createElement('strong');
      name.textContent = aliasOf(actors.get(turn.id)?.model || { id: turn.id, name: turn.name });
      name.title = name.textContent;
      const ref = document.createElement('span'); ref.className = 'turn-ref';
      ref.textContent = turn.refs.length ? `参考 ${turn.refs.length} 条` : '首条 · 无参考';
      head.append(name, ref);
      const text = document.createElement('p'); text.className = 'turn-text';
      text.textContent = turn.text || '（没有有效输出）'; text.title = turn.text || '';
      body.append(head, text); li.append(idx, body);
      li.addEventListener('click', () => selectActor(turn.id));
      turnsList.append(li);
    });
  }

  function renderStatusList() {
    if (!statusList) return;
    statusList.replaceChildren();
    for (const actor of actors.values()) {
      const row = document.createElement('div');
      row.className = 'status-row' + (selectedId === actor.model.id ? ' is-selected' : '');
      row.dataset.modelId = actor.model.id;
      row.dataset.state = actor.el.dataset.state;
      const thumb = document.createElement('div'); thumb.className = 'status-thumb';
      const choice = currentPet(actor.model);
      if (choice.indexOf('roster:') === 0 && AVATARS) {
        const img = document.createElement('img');
        img.src = AVATARS.R + choice.slice(7) + '.gif'; img.alt = '';
        thumb.append(img);
      } else thumb.textContent = choice.indexOf('emoji:') === 0 ? choice.slice(6) : '◈';
      const info = document.createElement('div'); info.className = 'status-info';
      const name = document.createElement('div'); name.className = 'status-name';
      name.textContent = aliasOf(actor.model); name.title = name.textContent;
      const state = document.createElement('div'); state.className = 'status-meta';
      const turnIndex = round.findIndex((t) => t.id === actor.model.id);
      state.textContent = (STATE_LABEL[actor.el.dataset.state] || '待机') + (turnIndex >= 0 ? ` · 第 ${turnIndex + 1} 条` : '');
      info.append(name, state); row.append(thumb, info);
      row.addEventListener('click', () => selectActor(actor.model.id));
      statusList.append(row);
    }
    if (actorCount) actorCount.textContent = `${actors.size} 个`;
  }

  function selectActor(id) {
    selectedId = selectedId === id ? null : id;
    for (const [key, actor] of actors) {
      actor.el.classList.toggle('is-selected', key === selectedId);
      if (actor.picker) { actor.picker.remove(); actor.picker = null; }
    }
    renderTurns(); renderStatusList(); drawLinks();
    if (!running && selectedId) {
      const actor = actors.get(selectedId);
      const turnIndex = round.findIndex((t) => t.id === selectedId);
      statusLine.textContent = turnIndex >= 0
        ? `${aliasOf(actor.model)}：本轮第 ${turnIndex + 1} 条，参考了前面 ${round[turnIndex].refs.length} 条。`
        : `${aliasOf(actor.model)}：本轮还没有发言。`;
    }
  }

  function poke(actor) {
    if (!AVATARS) return;
    if (actor.pokeTimer) clearTimeout(actor.pokeTimer);
    const state = actor.el.dataset.state || 'waiting';
    AVATARS.updateState(actor.avatar, currentPet(actor.model), 'poke', scene);
    actor.avatar.dataset.avatarState = 'poke';
    actor.pokeBubble.textContent = POKE_LINES[Math.floor(Math.random() * POKE_LINES.length)];
    actor.pokeBubble.hidden = false;
    actor.pokeTimer = setTimeout(() => {
      actor.pokeBubble.hidden = true;
      AVATARS.updateState(actor.avatar, currentPet(actor.model), state, scene);
      actor.avatar.dataset.avatarState = state;
      actor.pokeTimer = null;
    }, 1700);
  }

  function makeDraggable(actor) {
    const el = actor.el;
    let start = null, moved = false, lastDragEnd = 0;
    const skip = '.stage-actor-name, .stage-name-input, .actor-outfits, .outfit-picker';
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
      if (!moved) { moved = true; AVATARS?.updateState(actor.avatar, currentPet(actor.model), 'drag', scene); }
      const rect = floor.getBoundingClientRect();
      const x = Math.min(0.93, Math.max(0.07, start.pos.x + dx / rect.width));
      const y = Math.min(0.86, Math.max(0.14, start.pos.y + dy / rect.height));
      actor.pos = { x, y };
      el.style.left = (x * 100) + '%'; el.style.top = (y * 100) + '%';
      drawLinks();
    });
    const end = () => {
      if (!start) return;
      start = null; el.classList.remove('is-dragging');
      if (moved) {
        write(posKey(actor.model.id), JSON.stringify(actor.pos));
        AVATARS?.updateState(actor.avatar, currentPet(actor.model), el.dataset.state || 'waiting', scene);
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
    el.addEventListener('dblclick', (event) => { event.preventDefault(); poke(actor); });
  }

  function buildStage() {
    const picked = checkedIds();
    for (const node of floor.querySelectorAll('.stage-actor')) node.remove();
    actors.clear(); round = []; edges = []; activeTurn = -1;
    const n = picked.length;
    picked.forEach((id, i) => {
      const model = models.find((m) => m.id === id);
      if (!model) return;
      const el = document.createElement('div');
      el.className = 'stage-actor';
      el.dataset.modelId = id; el.dataset.state = 'waiting';
      const avatar = document.createElement('div'); avatar.className = 'stage-actor-avatar';
      const name = document.createElement('div'); name.className = 'stage-actor-name';
      name.textContent = aliasOf(model); name.title = aliasOf(model);
      const stateEl = document.createElement('div'); stateEl.className = 'stage-actor-state'; stateEl.textContent = '待机';
      const meta = document.createElement('div'); meta.className = 'actor-meta'; meta.textContent = `第 ${i + 1} 位`;
      const outfits = document.createElement('div'); outfits.className = 'actor-outfits';
      const bubble = document.createElement('div'); bubble.className = 'stage-actor-bubble'; bubble.hidden = true;
      const pokeBubble = document.createElement('div'); pokeBubble.className = 'actor-poke-bubble'; pokeBubble.hidden = true;
      el.append(pokeBubble, avatar, name, stateEl, meta, outfits, bubble);
      floor.append(el);
      const actor = { model, el, avatar, name, stateEl, meta, outfits, bubble, pokeBubble,
        pokeTimer: null, reactTimer: null, picker: null, pos: null };
      actor.pos = savedPos(id) || { x: (i + 0.5) / n, y: 0.38 };
      el.style.left = (actor.pos.x * 100) + '%'; el.style.top = (actor.pos.y * 100) + '%';
      actors.set(id, actor);
      name.addEventListener('click', (e) => { e.stopPropagation(); editName(actor); });
      renderAvatar(actor); refreshOutfits(actor); makeDraggable(actor);
    });
    if (selectedId && !actors.has(selectedId)) selectedId = null;
    for (const [key, actor] of actors) actor.el.classList.toggle('is-selected', key === selectedId);
    pickedHint.textContent = picked.length ? `已选 ${picked.length} 个` : '还没勾选模型';
    renderTurns(); renderStatusList(); applyPetMode();
    requestAnimationFrame(drawLinks);
  }

  function setScene(next) {
    if (!SCENE_LABEL[next]) return;
    scene = next;
    floor.dataset.scene = next;
    if (sceneLabel) sceneLabel.textContent = SCENE_LABEL[next];
    for (const b of document.querySelectorAll('#stage-scenes button')) b.classList.toggle('active', b.dataset.scene === next);
    for (const actor of actors.values()) {
      AVATARS?.updateState(actor.avatar, currentPet(actor.model), actor.el.dataset.state || 'waiting', scene);
    }
    statusLine.textContent = `场景：${SCENE_LABEL[next]}。只改变角色的动作与背景，不改变真实任务状态。`;
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
    modelPick.replaceChildren();
    const loading = document.createElement('span');
    loading.className = 'hint'; loading.textContent = '正在读取模型…';
    modelPick.append(loading);
    const before = new Set(checkedIds());
    try {
      const reply = await window.workbench.dispatchModels();
      if (!reply || !reply.ok) throw new Error((reply && reply.error) || '读取失败');
      models = reply.data.models || [];
      modelPick.replaceChildren();
      for (const m of models) {
        const label = document.createElement('label'); label.className = 'model-pick';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = m.id;
        const text = document.createElement('span'); text.textContent = aliasOf(m); text.title = aliasOf(m);
        label.append(cb, text); modelPick.append(label);
        cb.addEventListener('change', buildStage);
      }
      const boxes = [...modelPick.querySelectorAll('input[type="checkbox"]')];
      const kept = boxes.filter((o) => before.has(o.value));
      if (kept.length) kept.forEach((o) => { o.checked = true; });
      else boxes.slice(0, 4).forEach((o) => { o.checked = true; });
      buildStage();
      statusLine.textContent = `已读取 ${models.length} 个模型，默认选中 ${checkedIds().length} 个。`;
    } catch (error) {
      modelPick.replaceChildren();
      const fail = document.createElement('span'); fail.className = 'hint'; fail.textContent = '读取失败';
      modelPick.append(fail);
      statusLine.textContent = `读取模型失败：${error.message}`;
    } finally { if (btn) btn.disabled = false; }
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
      let logTimer = null, statusTimer = null;
      const finish = (value) => {
        if (logTimer) clearInterval(logTimer);
        if (statusTimer) clearInterval(statusTimer);
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
          if (TERMINAL.includes(st)) finish(((st === 'completed' || st === 'accepted') && ans) ? ans : null);
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
    running = true; askBtn.disabled = true;
    round = []; edges = []; activeTurn = -1; selectedId = null;
    for (const actor of list) {
      setActorState(actor.model.id, 'waiting');
      actor.el.classList.remove('is-selected');
      actor.meta.textContent = '等待中';
    }
    renderTurns(); renderStatusList(); drawLinks();
    const spoken = [];
    try {
      for (let i = 0; i < list.length; i += 1) {
        const actor = list[i];
        const refs = spoken.map((s) => s.id);
        statusLine.textContent = `${i + 1}/${list.length} · ${aliasOf(actor.model)} 正在生成（参考前面 ${refs.length} 条）`;
        actor.meta.textContent = `第 ${i + 1} 条 · 参考 ${refs.length} 条`;
        activeTurn = i;
        for (const from of refs) edges.push({ from, to: actor.model.id, turn: i });
        // 发言被引用的人会招手 / 跳跃，对应「它的话正在被使用」。
        for (const from of refs) {
          const src = actors.get(from);
          if (!src) continue;
          AVATARS?.updateState(src.avatar, currentPet(src.model), 'poke', scene);
          clearTimeout(src.reactTimer);
          src.reactTimer = setTimeout(() => {
            AVATARS?.updateState(src.avatar, currentPet(src.model), src.el.dataset.state || 'waiting', scene);
            src.reactTimer = null;
          }, 1500);
        }
        drawLinks();
        const prompt = window.__chatMulti.buildDiscussionPrompt({ question: q, spoken });
        const answer = await runTurn(actor.model, prompt, (state) => setActorState(actor.model.id, state));
        const text = answer || '（没有有效输出）';
        spoken.push({ modelName: aliasOf(actor.model), id: actor.model.id, text });
        round.push({ id: actor.model.id, name: aliasOf(actor.model), refs, text: answer || '' });
        setActorState(actor.model.id, answer ? 'done' : 'failed', text);
        renderTurns(); drawLinks();
      }
      activeTurn = -1; drawLinks();
      statusLine.textContent = `本轮结束：${spoken.length}/${list.length} 位有输出。点一条记录看它参考了谁。`;
    } finally { running = false; askBtn.disabled = false; }
  }

  if ($('stage-pet-open')) $('stage-pet-open').addEventListener('click', async () => {
    const reply = await window.workbench.petOpen?.();
    statusLine.textContent = reply && reply.ok
      ? '桌宠已悬浮到桌面：可拖动、锁定、置顶、发表情、连模型聊一句。'
      : `打开桌宠失败：${(reply && reply.error) || '未接入'}`;
  });
  if ($('stage-refresh')) $('stage-refresh').addEventListener('click', loadModels);
  if (petToggle) petToggle.addEventListener('change', applyPetMode);
  askBtn.addEventListener('click', askAll);
  question.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); askAll(); } });
  window.addEventListener('resize', drawLinks);
  for (const b of document.querySelectorAll('#stage-scenes button')) {
    b.addEventListener('click', () => setScene(b.dataset.scene));
  }

  function refreshView() {
    for (const actor of actors.values()) {
      actor.name.textContent = aliasOf(actor.model);
      actor.name.title = actor.name.textContent;
    }
    renderTurns(); renderStatusList();
    requestAnimationFrame(drawLinks);
  }
  function show() {
    for (const id of PAGE_IDS) { const el = $(id); if (el) el.hidden = id !== 'stage-page'; }
    window.__chatUi?.hidePage?.();
    window.__modelsUi?.hide?.();
    for (const b of document.querySelectorAll('.nav-button')) b.classList.toggle('active', b.id === 'nav-stage');
    if (!models.length) loadModels(); else refreshView();
  }
  function hide() { page.hidden = true; $('nav-stage')?.classList.remove('active'); }

  $('nav-stage').addEventListener('click', show);
  for (const id of ['nav-memory', 'nav-chat', 'nav-tasks', 'nav-designer', 'nav-panel']) {
    const b = $(id); if (b) b.addEventListener('click', hide);
  }

  window.__stageUi = { show, hide, refresh: loadModels, drawLinks, buildStage, refreshView, setScene };
})();
