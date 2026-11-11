/* 设施详情：点家具头顶的代号牌打开，锚在牌子上、标题条可拖动。
   这里只显示已经存在的事实（设施编号、本机时间、此刻谁坐在这里、模型真实状态），
   不凭空生成任何数值——没有真实来源的数字画出来就是假的。
   操作也全部转交给 stage-ui 已有的能力，不在本文件里另做一套状态。 */
(() => {
  const panel = document.getElementById('facility-panel');
  if (!panel) return;

  const DAYPART_LABEL = { morning: '清晨', day: '白天', dusk: '傍晚', night: '夜里' };
  const USE = {
    desk: '生成中的模型坐这里',
    rack: '工作位，紧挨机柜',
    cafe: '待机 / 已发言的模型在这',
    sofa: '待机 / 已发言的模型在这',
    plant: '装饰位，没有座位',
  };

  let propId = null;
  let dragging = false;
  let dragOrigin = null;

  const wrap = () => panel.parentElement;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

  function daypart() {
    const h = new Date().getHours();
    if (h >= 5 && h < 9) return 'morning';
    if (h >= 9 && h < 17) return 'day';
    if (h >= 17 && h < 20) return 'dusk';
    return 'night';
  }

  function clockLine() {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return `本机 ${hh}:${mm} · ${DAYPART_LABEL[daypart()]}`;
  }

  function button(label, action, actorId) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'facility-act';
    b.dataset.action = action;
    b.dataset.actorId = actorId;
    b.textContent = label;
    return b;
  }

  function renderBody() {
    const body = panel.querySelector('.facility-body');
    if (!body || !propId) return;
    body.replaceChildren();

    const info = window.__stageUi?.facilityInfo?.(propId);
    if (!info || !info.prop) return;
    const clock = panel.querySelector('.facility-clock');
    if (clock) clock.textContent = clockLine();

    const use = document.createElement('p');
    use.className = 'facility-use';
    use.textContent = USE[info.prop.type] || '协作舱设施';
    body.append(use);

    const title = document.createElement('p');
    title.className = 'facility-section-title';
    title.textContent = info.occupants.length
      ? `当前坐着 ${info.occupants.length} 位 / 共 ${info.seatCount} 个座位`
      : '当前没有人在这';
    body.append(title);

    if (!info.occupants.length) {
      const empty = document.createElement('p');
      empty.className = 'facility-empty';
      empty.textContent = '讨论开始后按状态归位。';
      body.append(empty);
      return;
    }

    for (const person of info.occupants) {
      const row = document.createElement('div');
      row.className = 'facility-person';
      row.dataset.actorId = person.id;
      const name = document.createElement('span');
      name.className = 'facility-person-name';
      name.textContent = person.name;
      name.title = person.name;
      const state = document.createElement('span');
      state.className = 'facility-person-state';
      state.dataset.state = person.state;
      state.textContent = person.stateLabel;
      row.append(name, state);
      const acts = document.createElement('div');
      acts.className = 'facility-acts';
      acts.append(
        button('选中', 'select', person.id),
        button('换形象', 'library', person.id),
        button('戳一下', 'poke', person.id),
      );
      body.append(row, acts);
    }
  }

  function place(plate) {
    const host = wrap();
    const wr = host.getBoundingClientRect();
    const pr = plate.getBoundingClientRect();
    const w = panel.offsetWidth || 240;
    const h = panel.offsetHeight || 190;
    const left = pr.left - wr.left + pr.width / 2 - w / 2;
    // 铭牌都在画布上沿，头顶放不下整块面板。贴到画布顶部的墙区（34px 避开两块
    // 分区标签），不要落到铭牌下方——那里是角色，盖住身体比盖住墙难看得多。
    // 水平仍跟着被点的铭牌走，保留「这块面板属于这台设施」的指向感。
    let top = pr.top - wr.top - h - 10;
    if (top < 34) top = 34;
    panel.style.left = Math.round(clamp(left, 6, wr.width - w - 6)) + 'px';
    panel.style.top = Math.round(clamp(top, 6, wr.height - h - 6)) + 'px';
  }

  function markPlate(on) {
    for (const el of document.querySelectorAll('.room-plate.is-open')) el.classList.remove('is-open');
    if (on && propId) {
      const el = document.querySelector(`.room-plate[data-prop-id="${CSS.escape(propId)}"]`);
      if (el) el.classList.add('is-open');
    }
  }

  function open(id, plate) {
    const info = window.__stageUi?.facilityInfo?.(id);
    if (!info || !info.prop) return;
    propId = id;
    panel.replaceChildren();

    const head = document.createElement('div');
    head.className = 'facility-head';
    const grip = document.createElement('span');
    grip.className = 'facility-grip';
    grip.textContent = '⠿';
    const name = document.createElement('span');
    name.className = 'facility-name';
    name.textContent = `${info.prop.code} · ${info.prop.name}`;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'facility-close';
    close.textContent = '×';
    close.title = '关闭（Esc）';
    close.setAttribute('aria-label', '关闭设施详情');
    close.addEventListener('click', closePanel);
    head.append(grip, name, close);

    const clock = document.createElement('p');
    clock.className = 'facility-clock';
    const body = document.createElement('div');
    body.className = 'facility-body';
    panel.append(head, clock, body);
    head.title = '点别的铭牌可换设施 · 拖这里挪位置 · Esc 关闭';

    head.addEventListener('pointerdown', startDrag);
    panel.hidden = false;
    markPlate(true);
    renderBody();
    place(plate);
  }

  function closePanel() {
    panel.hidden = true;
    propId = null;
    dragging = false;
    dragOrigin = null;
    markPlate(false);
  }

  function onAction(event) {
    const btn = event.target.closest('button[data-action]');
    if (!btn) return;
    event.stopPropagation();
    window.__stageUi?.actorAction?.(btn.dataset.actorId, btn.dataset.action);
    renderBody();
  }

  function startDrag(event) {
    if (event.target.closest('.facility-close')) return;
    const host = wrap();
    const hr = host.getBoundingClientRect();
    const pr = panel.getBoundingClientRect();
    dragging = true;
    dragOrigin = {
      x: event.clientX, y: event.clientY,
      left: pr.left - hr.left, top: pr.top - hr.top,
      maxX: hr.width - pr.width - 6, maxY: hr.height - pr.height - 6,
    };
    panel.classList.add('is-dragging');
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
  }
  function moveDrag(event) {
    if (!dragging || !dragOrigin) return;
    const d = dragOrigin;
    panel.style.left = Math.round(clamp(d.left + event.clientX - d.x, 6, d.maxX)) + 'px';
    panel.style.top = Math.round(clamp(d.top + event.clientY - d.y, 6, d.maxY)) + 'px';
  }
  function stopDrag() {
    dragging = false;
    dragOrigin = null;
    panel.classList.remove('is-dragging');
  }
  // 面板本身只初始化一次，事件监听也只挂一次；open() 只换内部 DOM，
  // 否则每开一次就多一层 click 监听，点一下会重复派发动作。
  panel.addEventListener('click', onAction);
  panel.addEventListener('pointermove', moveDrag);
  panel.addEventListener('pointerup', stopDrag);
  panel.addEventListener('pointercancel', stopDrag);

  window.__facilityPanel = {
    open,
    close: closePanel,
    refresh: () => { if (!panel.hidden && propId) renderBody(); },
    refreshClock: () => {
      if (panel.hidden) return;
      const clock = panel.querySelector('.facility-clock');
      if (clock) clock.textContent = clockLine();
    },
    get current() { return propId; },
    daypart,
  };
})();
