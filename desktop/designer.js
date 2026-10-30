(() => {
  const $ = (id) => document.getElementById(id);
  const NODE_W = 190;
  const NODE_H = 64;
  const labels = { private: '私人', project: '项目', shared: '公共' };
  const clone = (v) => structuredClone(v);
  const element = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  const say = (text) => { $('designer-message').textContent = text; };
  async function result(p) { const r = await p; if (!r.ok) throw Error(r.error); return r.data; }
  function act(id, fn) { $(id).addEventListener('click', async () => { if (busy) { say('正在处理上一步，请稍候。'); return; } busy = true; try { await fn(); } catch (e) { say(e.message); } finally { busy = false; } }); }

  let saved = null;
  let nodes = [];
  let edges = [];
  let selected = null;
  let selection = new Set();
  let undo = [];
  let redo = [];
  let preview = null;
  let currentSpaceId = null;
  let busy = false;
  let zoom = 1;
  let panX = 40;
  let panY = 40;
  let drag = null;
  let connectFrom = null;
  let tool = 'select';
  let spaceDown = false;

  const vp = $('designer-canvas');
  const dirty = () => saved && (JSON.stringify(nodes) !== JSON.stringify(saved.nodes) || JSON.stringify(edges) !== JSON.stringify(saved.edges));
  const nodeById = (id) => nodes.find((n) => n.id === id);
  const vpRect = () => vp.getBoundingClientRect();

  function syncZoom() { vp.style.setProperty('--designer-zoom', String(zoom)); $('designer-zoom-reset').textContent = `${Math.round(zoom * 100)}%`; }
  function updateStageTransform() { const s = vp.querySelector('.diagram-stage'); if (s) s.style.transform = `translate(${panX}px,${panY}px) scale(${zoom})`; }
  function updateEdges() {
    const svg = vp.querySelector('.diagram-edges'); if (!svg) return;
    const ns = 'http://www.w3.org/2000/svg';
    for (const l of [...svg.querySelectorAll('line')]) l.remove();
    for (const e of edges) {
      const a = nodeById(e.from); const b = nodeById(e.to); if (!a || !b) continue;
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('class', 'diagram-edge');
      line.setAttribute('x1', a.x + NODE_W / 2); line.setAttribute('y1', a.y + NODE_H / 2);
      line.setAttribute('x2', b.x + NODE_W / 2); line.setAttribute('y2', b.y + NODE_H / 2);
      svg.append(line);
    }
  }
  function reflectSelection() { for (const el of vp.querySelectorAll('.diagram-node')) { const on = selection.has(el.dataset.id) || el.dataset.id === selected; el.classList.toggle('selected', on); } }
  function fitView() {
    if (!nodes.length) return;
    const r = vpRect(); if (!r.width || !r.height) return;
    const minX = Math.min(...nodes.map((n) => n.x)); const minY = Math.min(...nodes.map((n) => n.y));
    const maxX = Math.max(...nodes.map((n) => n.x + NODE_W)); const maxY = Math.max(...nodes.map((n) => n.y + NODE_H));
    const bw = Math.max(1, maxX - minX); const bh = Math.max(1, maxY - minY);
    const scale = Math.max(0.5, Math.min(1, Math.min((r.width - 60) / bw, (r.height - 60) / bh)));
    zoom = Math.round(scale * 10) / 10;
    panX = Math.round((r.width - bw * zoom) / 2 - minX * zoom);
    panY = Math.round((r.height - bh * zoom) / 2 - minY * zoom);
  }
  function setTool(t) {
    tool = t === 'hand' ? 'hand' : 'select';
    vp.classList.toggle('tool-hand', tool === 'hand');
    $('designer-tool-select').classList.toggle('active', tool === 'select');
    $('designer-tool-hand').classList.toggle('active', tool === 'hand');
    $('designer-tool-select').setAttribute('aria-pressed', String(tool === 'select'));
    $('designer-tool-hand').setAttribute('aria-pressed', String(tool === 'hand'));
  }

  function render() {
    if (!saved) return;
    // 旧架构文件可能没有 history 字段；缺了就当空历史，别让整页渲染失败。
    if (!Array.isArray(saved.history)) saved.history = [];
    $('designer-version').textContent = `已保存 v${saved.revision}${dirty() ? ' · 草稿未保存' : ''}`;
    $('designer-undo').disabled = !undo.length;
    $('designer-redo').disabled = !redo.length;
    $('designer-history').disabled = !saved.history.length;
    $('designer-save').disabled = !dirty();
    if (selected && !nodeById(selected)) selected = null;
    const hs = $('designer-history-select');
    hs.replaceChildren();
    for (const h of saved.history) hs.add(new Option(`v${h.revision}`, String(h.revision)));
    if (saved.history.length) hs.value = String(saved.history.at(-1).revision);

    syncZoom();
    const stage = element('div', undefined, 'diagram-stage');
    stage.style.transform = `translate(${panX}px,${panY}px) scale(${zoom})`;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'diagram-edges');
    svg.setAttribute('width', '6000');
    svg.setAttribute('height', '4000');
    for (const e of edges) {
      const a = nodeById(e.from); const b = nodeById(e.to);
      if (!a || !b) continue;
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('class', 'diagram-edge');
      line.setAttribute('x1', a.x + NODE_W / 2); line.setAttribute('y1', a.y + NODE_H / 2);
      line.setAttribute('x2', b.x + NODE_W / 2); line.setAttribute('y2', b.y + NODE_H / 2);
      svg.append(line);
    }
    stage.append(svg);
    for (const n of nodes) {
      const on = selection.has(n.id) || selected === n.id;
      const card = element('button', undefined, `diagram-node ${n.scope}${on ? ' selected' : ''}`);
      card.type = 'button';
      card.dataset.id = n.id;
      card.style.left = `${n.x}px`;
      card.style.top = `${n.y}px`;
      card.append(element('strong', n.name), element('small', `${labels[n.scope]} · ${n.budget.toLocaleString()} 字符`));
      stage.append(card);
    }
    const marquee = element('div', undefined, 'marquee');
    marquee.hidden = true;
    vp.replaceChildren(stage, marquee);

    const n = nodeById(selected);
    $('designer-selection').textContent = n ? `编辑：${n.name}` : '点击或右键节点查看详情';
    for (const id of ['designer-name', 'designer-scope', 'designer-budget', 'designer-apply', 'designer-delete']) $(id).disabled = !n;
    if (n) { $('designer-name').value = n.name; $('designer-scope').value = n.scope; $('designer-budget').value = n.budget; }
    const deg = n ? edges.filter((e) => e.from === n.id || e.to === n.id).length : 0;
    $('designer-links').textContent = n ? `连线数：${deg}（右键可发起新连线）` : '';
  }

  function commit(nextNodes, nextEdges, message) {
    undo.push({ nodes: clone(nodes), edges: clone(edges) });
    if (undo.length > 50) undo.shift();
    redo = [];
    nodes = nextNodes; edges = nextEdges; preview = null;
    render();
    if (message) say(message);
  }

  function deleteNode(id) {
    const nextNodes = nodes.filter((n) => n.id !== id);
    if (!nextNodes.length) throw Error('至少保留一个节点。');
    const nextEdges = edges.filter((e) => e.from !== id && e.to !== id);
    selection.delete(id);
    if (selected === id) selected = nextNodes[0] ? nextNodes[0].id : null;
    commit(nextNodes, nextEdges, '已删除节点及其连线（尚未保存）。');
  }

  // ---- context menu ----
  function closeMenu() { $('designer-menu').hidden = true; }
  function openMenu(x, y, id) {
    const menu = $('designer-menu');
    menu.replaceChildren();
    menu.append(element('div', nodeById(id) ? nodeById(id).name : '节点', 'menu-title'));
    const item = (label, fn) => { const b = element('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', () => { closeMenu(); try { fn(); } catch (e) { say(e.message); } }); menu.append(b); };
    item('查看详情', () => { selected = id; selection = new Set([id]); render(); say('已选中节点，右侧属性面板可查看与编辑详情。'); });
    item('从这里连线…', () => { connectFrom = id; say('已进入连线模式：点击目标节点完成连线。'); });
    item('删除节点', () => deleteNode(id));
    menu.hidden = false;
    const w = menu.offsetWidth || 150; const h = menu.offsetHeight || 130;
    menu.style.left = `${Math.min(x, innerWidth - w - 8)}px`;
    menu.style.top = `${Math.min(y, innerHeight - h - 8)}px`;
  }

  // ---- canvas pointer interactions ----
  vp.addEventListener('pointerdown', (e) => {
    closeMenu();
    if (e.button === 1 || tool === 'hand' || spaceDown) { drag = { type: 'pan', sx: e.clientX, sy: e.clientY, opx: panX, opy: panY }; vp.classList.add('panning'); try { vp.setPointerCapture(e.pointerId); } catch {} return; }
    if (e.button !== 0) return;
    const card = e.target.closest('.diagram-node');
    if (card) {
      e.preventDefault();
      const id = card.dataset.id; const n = nodeById(id); if (!n) return;
      if (connectFrom) {
        if (connectFrom === id) { say('不能连向自身。'); connectFrom = null; return; }
        const key = [connectFrom, id].sort().join('|');
        if (edges.some((edge) => [edge.from, edge.to].sort().join('|') === key)) { say('这两个节点已经连过了。'); connectFrom = null; return; }
        commit(nodes, [...edges, { from: connectFrom, to: id }], '已连接两个节点（尚未保存）。');
        connectFrom = null;
        return;
      }
      if (e.shiftKey) { if (selection.has(id)) selection.delete(id); else selection.add(id); selected = id; reflectSelection(); render(); return; }
      selection = new Set([id]); selected = id; reflectSelection();
      drag = { type: 'node', id, el: card, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y, moved: false, before: { nodes: clone(nodes), edges: clone(edges) } };
      try { vp.setPointerCapture(e.pointerId); } catch {}
    } else {
      drag = { type: 'marquee', sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY, additive: e.shiftKey, base: new Set(selection) };
      try { vp.setPointerCapture(e.pointerId); } catch {}
    }
  });

  vp.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.type === 'pan') { panX = drag.opx + (e.clientX - drag.sx); panY = drag.opy + (e.clientY - drag.sy); updateStageTransform(); return; }
    if (drag.type === 'node') {
      const n = nodeById(drag.id); if (!n) return;
      if (Math.abs(e.clientX - drag.sx) > 2 || Math.abs(e.clientY - drag.sy) > 2) drag.moved = true;
      n.x = Math.round(drag.ox + (e.clientX - drag.sx) / zoom);
      n.y = Math.round(drag.oy + (e.clientY - drag.sy) / zoom);
      if (drag.el) { drag.el.style.left = `${n.x}px`; drag.el.style.top = `${n.y}px`; }
      updateEdges();
      return;
    }
    if (drag.type === 'marquee') { drag.cx = e.clientX; drag.cy = e.clientY; drawMarquee(); }
  });

  function drawMarquee() {
    const m = vp.querySelector('.marquee'); if (!m) return;
    const r = vpRect();
    m.hidden = false;
    m.style.left = `${Math.min(drag.sx, drag.cx) - r.left}px`;
    m.style.top = `${Math.min(drag.sy, drag.cy) - r.top}px`;
    m.style.width = `${Math.abs(drag.cx - drag.sx)}px`;
    m.style.height = `${Math.abs(drag.cy - drag.sy)}px`;
  }

  vp.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const d = drag; drag = null; vp.classList.remove('panning');
    try { vp.releasePointerCapture(e.pointerId); } catch {}
    if (d.type === 'node') {
      if (d.moved) { undo.push(d.before); if (undo.length > 50) undo.shift(); redo = []; preview = null; render(); say('已移动节点（尚未保存）。'); }
      else { selection = new Set([d.id]); selected = d.id; render(); }
    } else if (d.type === 'marquee') {
      const r = vpRect();
      const c1 = { x: (Math.min(d.sx, d.cx) - r.left - panX) / zoom, y: (Math.min(d.sy, d.cy) - r.top - panY) / zoom };
      const c2 = { x: (Math.max(d.sx, d.cx) - r.left - panX) / zoom, y: (Math.max(d.sy, d.cy) - r.top - panY) / zoom };
      const hit = new Set(d.additive ? d.base : []);
      for (const n of nodes) if (n.x < c2.x && n.x + NODE_W > c1.x && n.y < c2.y && n.y + NODE_H > c1.y) hit.add(n.id);
      selection = hit; selected = [...hit][0] || selected; render();
      if (hit.size) say(`已框选 ${hit.size} 个节点；可右键或删除。`);
    }
  });
  vp.addEventListener('pointercancel', () => { drag = null; vp.classList.remove('panning'); });

  vp.addEventListener('contextmenu', (e) => {
    const card = e.target.closest('.diagram-node');
    if (!card) return;
    e.preventDefault();
    const id = card.dataset.id;
    selected = id; selection = new Set([id]); render();
    openMenu(e.clientX, e.clientY, id);
  });

  vp.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const r = vpRect(); const mx = e.clientX - r.left; const my = e.clientY - r.top; const before = zoom;
      zoom = Math.max(0.5, Math.min(1.6, Math.round((zoom + (e.deltaY < 0 ? 0.1 : -0.1)) * 10) / 10));
      panX = mx - (mx - panX) * (zoom / before);
      panY = my - (my - panY) * (zoom / before);
      render();
    } else {
      e.preventDefault();
      panX -= e.deltaX; panY -= e.deltaY; updateStageTransform();
    }
  }, { passive: false });

  document.addEventListener('pointerdown', (e) => { const menu = $('designer-menu'); if (!menu.hidden && !menu.contains(e.target)) closeMenu(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(); connectFrom = null; } });

  // ---- toolbar ----
  $('designer-zoom-in').addEventListener('click', () => { zoom = Math.min(1.6, Math.round((zoom + 0.1) * 10) / 10); render(); });
  $('designer-zoom-out').addEventListener('click', () => { zoom = Math.max(0.5, Math.round((zoom - 0.1) * 10) / 10); render(); });
  $('designer-zoom-reset').addEventListener('click', () => { zoom = 1; render(); });
  $('designer-tool-select').addEventListener('click', () => setTool('select'));
  $('designer-tool-hand').addEventListener('click', () => setTool('hand'));
  setTool('select');

  act('designer-arrange', () => {
    const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
    const next = nodes.map((n, i) => ({ ...n, x: 80 + (i % cols) * 250, y: 80 + Math.floor(i / cols) * 120 }));
    commit(next, edges, '已整理为分散网格（尚未保存）。');
  });
  act('designer-fit', () => { fitView(); render(); say('已适配视图，显示全部节点。'); });

  document.addEventListener('keydown', (e) => {
    if ($('designer-page').hidden) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    // 有弹窗在前台时不接管键盘：否则 Esc 关弹窗时按到 Delete 会把节点删掉。
    if (document.querySelector('dialog[open]')) return;
    if (e.code === 'Space') { if (['BUTTON', 'SUMMARY', 'A'].includes(e.target.tagName)) return; if (!spaceDown) { spaceDown = true; vp.classList.add('tool-hand'); } e.preventDefault(); return; }
    if (e.key === 'v' || e.key === 'V') { setTool('select'); return; }
    if (e.key === 'h' || e.key === 'H') { setTool('hand'); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); try { deleteNode(selected); } catch (err) { say(err.message); } return; }
    if (e.ctrlKey && e.key === '0') { e.preventDefault(); zoom = 1; render(); }
  });
  document.addEventListener('keyup', (e) => { if (e.code === 'Space') { spaceDown = false; vp.classList.remove('tool-hand'); } });

  act('designer-add', () => {
    const r = vpRect();
    const cx = Math.round((r.width / 2 - panX) / zoom) - NODE_W / 2;
    const cy = Math.round((r.height / 2 - panY) / zoom) - NODE_H / 2;
    const id = crypto.randomUUID();
    commit([...nodes, { id, name: '新分区', scope: 'private', budget: 2000, x: cx, y: cy }], edges, '已新增节点（尚未保存）。');
    selected = id; selection = new Set([id]); render();
  });
  act('designer-apply', () => {
    const n = nodeById(selected); if (!n) throw Error('请先选择一个节点。');
    commit(nodes.map((x) => (x.id === selected ? { ...x, name: $('designer-name').value.trim(), scope: $('designer-scope').value, budget: Number($('designer-budget').value) } : x)), edges, '已更新节点（尚未保存）。');
  });
  act('designer-delete', () => { if (!selected) throw Error('请先选择一个节点。'); deleteNode(selected); });
  act('designer-undo', () => { if (!undo.length) return; redo.push({ nodes: clone(nodes), edges: clone(edges) }); const s = undo.pop(); nodes = s.nodes; edges = s.edges; render(); });
  act('designer-redo', () => { if (!redo.length) return; undo.push({ nodes: clone(nodes), edges: clone(edges) }); const s = redo.pop(); nodes = s.nodes; edges = s.edges; render(); });

  act('nav-designer', async () => {
    // 先把画布页切出来：加载失败时错误信息写在 #designer-message 里，
    // 页面若还藏着，用户只会看到"点了没反应"。
    $('memory-page').hidden = true; $('tasks-page').hidden = true; $('designer-page').hidden = false;
    window.__chatUi?.hidePage?.();
    for (const id of ['nav-memory', 'nav-tasks']) $(id).classList.remove('active');
    $('nav-designer').classList.add('active');
    if (!saved) {
      const snap = await result(window.workbench.memorySnapshot());
      const sel = $('designer-space');
      sel.replaceChildren(...snap.spaces.map((s) => new Option(s.name, s.id)));
      currentSpaceId = snap.spaces[0] ? snap.spaces[0].id : null;
      sel.value = currentSpaceId;
      saved = await result(window.workbench.architectureRead(currentSpaceId));
      nodes = clone(saved.nodes); edges = clone(saved.edges || []);
      selected = nodes[0] ? nodes[0].id : null; selection = new Set(selected ? [selected] : []);
      panX = 40; panY = 40; zoom = 1; undo = []; redo = []; render();
    }
  });

  $('designer-space').addEventListener('change', async () => {
    const nextId = $('designer-space').value;
    if (!nextId || nextId === currentSpaceId) return;
    if (dirty() && !window.confirm('切换空间将放弃当前未保存草稿，继续吗？')) { $('designer-space').value = currentSpaceId; return; }
    try {
      currentSpaceId = nextId;
      saved = await result(window.workbench.architectureRead(currentSpaceId));
      nodes = clone(saved.nodes); edges = clone(saved.edges || []);
      selected = nodes[0] ? nodes[0].id : null; selection = new Set(selected ? [selected] : []);
      undo = []; redo = []; preview = null; render();
      say('已切换到该空间的架构；各空间独立保存。');
    } catch (e) { say(e.message); $('designer-space').value = currentSpaceId; }
  });

  act('designer-history', () => {
    const h = saved.history.find((x) => String(x.revision) === $('designer-history-select').value);
    if (!h) throw Error('暂无可恢复的历史版本。');
    commit(clone(h.nodes), clone(h.edges || []), '已载入历史版本为草稿；预览并保存后生效。');
  });
  act('designer-reload', async () => {
    if (dirty() && !window.confirm('重新读取将放弃当前未保存草稿，继续吗？')) return;
    saved = await result(window.workbench.architectureRead(currentSpaceId));
    nodes = clone(saved.nodes); edges = clone(saved.edges || []);
    undo = []; redo = []; selected = nodes[0] ? nodes[0].id : null; selection = new Set(selected ? [selected] : []); render();
    say('已重新读取保存结构。');
  });

  act('designer-trial', async () => {
    const report = await result(window.workbench.architectureTrial({ nodes, edges }));
    const box = $('designer-results');
    box.replaceChildren(element('p', `${report.nodeCount} 个节点 · ${report.edgeCount} 条连线 · ${report.warnings.length} 项建议`));
    for (const w of report.warnings) box.append(element('p', w.text, 'trial-warning'));
    box.append(element('p', report.note, 'hint'));
  });

  function diff() {
    const lines = [];
    const oldNodes = saved.nodes || []; const oldEdges = saved.edges || [];
    for (const n of nodes) {
      const old = oldNodes.find((x) => x.id === n.id);
      if (!old) { lines.push(`新增节点：${n.name}`); continue; }
      const c = [];
      if (old.name !== n.name) c.push('名称');
      if (old.scope !== n.scope) c.push('范围');
      if (old.budget !== n.budget) c.push('预算');
      if (old.x !== n.x || old.y !== n.y) c.push('位置');
      if (c.length) lines.push(`修改：${n.name}（${c.join('、')}）`);
    }
    for (const n of oldNodes) if (!nodes.some((x) => x.id === n.id)) lines.push(`删除节点：${n.name}`);
    const key = (e) => [e.from, e.to].sort().join('|');
    const oldSet = new Set(oldEdges.map(key)); const newSet = new Set(edges.map(key));
    for (const e of edges) if (!oldSet.has(key(e))) lines.push(`新增连线：${nodeById(e.from) ? nodeById(e.from).name : e.from} — ${nodeById(e.to) ? nodeById(e.to).name : e.to}`);
    for (const e of oldEdges) if (!newSet.has(key(e))) lines.push(`删除连线：${e.from} — ${e.to}`);
    return lines.join('\n') || '没有结构变化。';
  }

  act('designer-save', async () => {
    const report = await result(window.workbench.architectureTrial({ nodes, edges }));
    preview = JSON.stringify({ nodes, edges });
    const warn = report.warnings.length ? report.warnings.map((w) => w.text).join('\n') : '试运行无建议。';
    $('designer-diff').textContent = `${diff()}\n\n${warn}`;
    $('designer-preview').showModal();
  });
  act('designer-confirm', async () => {
    if (preview !== JSON.stringify({ nodes, edges })) throw Error('草稿已变化，请重新预览。');
    saved = await result(window.workbench.architectureSave(currentSpaceId, { nodes, edges }, saved.revision));
    nodes = clone(saved.nodes); edges = clone(saved.edges || []);
    undo = []; redo = []; preview = null;
    $('designer-preview').close(); render();
    say('画布已保存到本机副本。原记忆目录和旧条目分类未修改。');
  });
  act('designer-preview-close', () => $('designer-preview').close());

  act('designer-ai', () => { $('designer-ai-export').value = JSON.stringify({ nodes, edges }, null, 2); $('designer-ai-error').textContent = ''; $('designer-ai-dialog').showModal(); });
  act('designer-ai-close', () => $('designer-ai-dialog').close());
  act('designer-copy', async () => { await result(window.workbench.architectureCopy({ nodes, edges })); $('designer-ai-error').textContent = '已复制；请自行选择 AI，检查后粘贴。'; });
  act('designer-import', async () => {
    try {
      const imported = JSON.parse($('designer-ai-input').value);
      if (!imported || typeof imported !== 'object' || Array.isArray(imported) || Object.keys(imported).some((k) => !['nodes', 'edges'].includes(k))) throw Error('仅接受包含 nodes 的 JSON。');
      if (!Array.isArray(imported.nodes)) throw Error('JSON 需要 nodes 数组。');
      const next = { nodes: imported.nodes, edges: Array.isArray(imported.edges) ? imported.edges : [] };
      await result(window.workbench.architectureTrial(next));
      commit(clone(next.nodes), clone(next.edges), 'AI 建议已载入草稿，尚未保存；请试运行并预览差异。');
      $('designer-ai-dialog').close();
    } catch (e) { $('designer-ai-error').textContent = e.message; }
  });

  syncZoom();
  window.addEventListener('beforeunload', (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });
})();
