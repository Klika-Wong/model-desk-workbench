/* 协作舱：把画布变成一间有家具的房间。
   结构 = 后墙 + 地板 + 若干 props；props 与角色共用同一条「接地线深度轴」，
   所以角色走到桌子后面会被挡住。
   布局来自 assets/rooms/office.js（window.__ROOM_LAYOUT）。
   不用 fetch 读 json：主窗口是 file:// 且 CSP 为 connect-src 'none'，读不到。 */
(() => {
  const FLOOR_H = 436;

  const DEFAULT_ROOM = {
    id: 'office-01', name: '协作舱', wallRatio: 0.24,
    props: [
      { id: 'desk-a', type: 'desk', code: 'PC-01', name: '工位', plateSide: 'right', x: 0.18, y: 0.42, w: 158, seats: [{ x: 0.18, y: 0.53, role: 'work' }] },
      { id: 'desk-b', type: 'desk', code: 'PC-02', name: '工位', plateSide: 'right', x: 0.38, y: 0.42, w: 158, flip: true, seats: [{ x: 0.38, y: 0.53, role: 'work' }] },
      { id: 'plant-a', type: 'plant', code: 'GRN-01', name: '绿植', plateSide: 'right', x: 0.515, y: 0.375, w: 62 },
      { id: 'rack', type: 'rack', code: 'SRV-01', name: '机柜', plateSide: 'center', x: 0.055, y: 0.585, w: 80, seats: [{ x: 0.135, y: 0.655, role: 'work' }] },
      { id: 'cafe', type: 'cafe', code: 'BRW-01', name: '咖啡台', plateSide: 'left', x: 0.66, y: 0.44, w: 122, seats: [{ x: 0.66, y: 0.55, role: 'rest' }] },
      { id: 'sofa', type: 'sofa', code: 'LNG-01', name: '休息位', plateSide: 'left', x: 0.855, y: 0.60, w: 180,
        seats: [{ x: 0.845, y: 0.69, role: 'rest' }, { x: 0.905, y: 0.665, role: 'rest' }] },
    ],
    fallbackSeats: [
      { x: 0.07, y: 0.70, role: 'any' },
      { x: 0.23, y: 0.70, role: 'any' },
      { x: 0.39, y: 0.70, role: 'any' },
      { x: 0.55, y: 0.70, role: 'any' },
      { x: 0.71, y: 0.70, role: 'any' },
      { x: 0.87, y: 0.70, role: 'any' },
    ],
  };

  let room = DEFAULT_ROOM;
  let host = null;
  let pendingUsage = {};

  // ---- 等轴基础件 ----
  function faces(cx, cy, w, d, h) {
    const hw = w / 2, hd = d / 2;
    return {
      top: [cx, cy - hd, cx + hw, cy, cx, cy + hd, cx - hw, cy].join(' '),
      left: [cx - hw, cy, cx, cy + hd, cx, cy + hd + h, cx - hw, cy + h].join(' '),
      right: [cx, cy + hd, cx + hw, cy, cx + hw, cy + h, cx, cy + hd + h].join(' '),
    };
  }
  function box(cx, cy, w, d, h, cls) {
    const f = faces(cx, cy, w, d, h);
    const c = cls ? ` ${cls}` : '';
    return `<polygon class="rp-left${c}" points="${f.left}"/>`
      + `<polygon class="rp-right${c}" points="${f.right}"/>`
      + `<polygon class="rp-top${c}" points="${f.top}"/>`;
  }
  const shadow = (cx, cy, rx, ry) => `<ellipse class="rp-shadow" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/>`;

  function deskSvg() {
    return `<svg viewBox="0 0 158 158" width="158" height="158" aria-hidden="true">
      ${shadow(79, 150, 60, 8)}
      <rect class="rp-metal" x="72" y="56" width="14" height="22"/>
      <ellipse class="rp-metal" cx="79" cy="78" rx="18" ry="6"/>
      <rect class="rp-screen" x="49" y="20" width="60" height="38" rx="3.5"/>
      <rect class="rp-screen-glow" x="53" y="24" width="52" height="9" rx="2"/>
      <rect class="rp-screen-glow" x="53" y="38" width="36" height="5" rx="2"/>
      ${box(79, 96, 150, 56, 34)}
      <polygon class="rp-dark" points="79,101 110,110 79,119 48,110"/>
    </svg>`;
  }

  function rackSvg() {
    // 灯点延迟写在 CSS 的 nth-of-type 里：CSP 禁止 style 属性内联
    const leds = [[52, 100], [63, 96], [69, 110], [58, 114], [52, 128], [63, 124]]
      .map(([x, y]) => `<circle class="rp-led" cx="${x}" cy="${y}" r="2.3"/>`).join('');
    return `<svg viewBox="0 0 80 162" width="80" height="162" aria-hidden="true">
      ${shadow(40, 155, 34, 6)}
      ${box(40, 54, 72, 30, 88)}
      <path class="rp-slit" d="M46 82 L72 72 M46 90 L72 80 M46 98 L72 88"/>
      <rect class="rp-panel" x="47" y="102" width="24" height="34" rx="2"/>
      ${leds}
    </svg>`;
  }

  function cafeSvg() {
    return `<svg viewBox="0 0 124 138" width="124" height="138" aria-hidden="true">
      ${shadow(62, 130, 38, 7)}
      <rect class="rp-metal" x="57" y="84" width="10" height="42"/>
      <ellipse class="rp-dark" cx="62" cy="126" rx="26" ry="7"/>
      <ellipse class="rp-dark" cx="62" cy="92" rx="52" ry="18"/>
      <ellipse class="rp-top" cx="62" cy="82" rx="52" ry="18"/>
      <ellipse class="rp-cup" cx="46" cy="72" rx="10" ry="4.5"/>
      <rect class="rp-cup" x="37" y="62" width="18" height="11" rx="2.5"/>
      <path class="rp-steam" d="M43 56 q5 -7 0 -12"/>
      <ellipse class="rp-cup" cx="78" cy="70" rx="9" ry="4"/>
      <rect class="rp-cup" x="70" y="61" width="16" height="10" rx="2.5"/>
    </svg>`;
  }

  function sofaSvg() {
    /* 经典等轴家具画法：坐垫是一个大盒，靠背 = 从坐垫后缘升起的两块围合板，
       扶手 = 贴在坐垫两端的小翼板。之前用多个独立盒子拼，在这种投影下
       全都读成斜插的刀片。 */
    return `<svg viewBox="0 0 182 158" width="182" height="158" aria-hidden="true">
      ${shadow(91, 146, 78, 8)}
      <polygon class="sk-backL" points="16,84 91,56 91,22 16,50"/>
      <polygon class="sk-backR" points="91,56 166,84 166,50 91,22"/>
      <polygon class="sk-arm" points="16,84 32,78 32,48 16,54"/>
      <polygon class="sk-arm" points="166,84 150,78 150,48 166,54"/>
      ${box(91, 84, 150, 56, 26, 'sk-seat')}
      <polygon class="rp-top-lit" points="91,60 158,84 91,108 24,84"/>
      <ellipse class="rp-cushion" cx="61" cy="82" rx="27" ry="12"/>
      <ellipse class="rp-cushion" cx="121" cy="82" rx="27" ry="12"/>
    </svg>`;
  }

  function plantSvg() {
    return `<svg viewBox="0 0 64 104" width="64" height="104" aria-hidden="true">
      ${shadow(32, 98, 18, 5)}
      <path class="rp-leaf" d="M32 74 C20 64 14 50 18 38 C28 44 33 58 32 72"/>
      <path class="rp-leaf" d="M33 74 C45 64 51 50 47 38 C37 44 32 58 33 72"/>
      <path class="rp-leaf" d="M32 76 C32 62 36 50 44 44 C46 58 40 70 33 76"/>
      ${box(32, 80, 34, 16, 20)}
    </svg>`;
  }

  const RENDER = { desk: deskSvg, rack: rackSvg, cafe: cafeSvg, sofa: sofaSvg, plant: plantSvg };

  function buildProp(prop) {
    const el = document.createElement('div');
    el.className = 'room-prop';
    el.dataset.type = prop.type;
    el.dataset.propId = prop.id;
    el.style.left = (prop.x * 100).toFixed(2) + '%';
    el.style.top = (prop.y * 100).toFixed(2) + '%';
    el.style.width = prop.w + 'px';
    el.style.zIndex = String(20 + Math.round(prop.y * FLOOR_H));
    const draw = RENDER[prop.type];
    el.innerHTML = draw ? draw() : '';
    if (prop.flip) el.classList.add('is-flipped');
    return el;
  }

  /* 设施 ID：像游戏里角色头顶的代号牌，挂在家具上方而不是贴地板。
     独立 UI 图层、恒定 z=470（家具 ≤456）：编号始终可见，又不会像贴地时那样
     压住站在设施前的角色脚部。之前的 PC-01 消失是铭牌作为家具子元素参与
     深度排序被更近的 SVG 盖住，独立图层那次已修好，这里只改位置。 */
  // .room-prop 用 translate(-50%,-100%) 定位：y% 是家具的「底沿」，
  // 所以头顶 = y% - (SVG 盒子顶 → 实际绘图顶 bbox.y → 8px 引线间隙)。
  // 数值由 --dump-dom 实测 getBBox() 反推，不是目测：desk 顶 45 / rack 132 /
  // cafe 98 / sofa 126 / plant 98（相对 436px 房间）。改 SVG 时要同步重测。
  const HEAD_ANCHOR = { desk: 146, rack: 131, cafe: 102, sofa: 144, plant: 74 };
  function buildPlate(prop) {
    if (!prop.code) return null;
    const plate = document.createElement('span');
    plate.className = 'room-plate';
    plate.dataset.propId = prop.id;
    plate.dataset.used = '0';
    plate.dataset.side = prop.plateSide || 'center';
    plate.innerHTML = `<i></i>${prop.code}`;
    // plateSide 现在只做几像素的水平避让：靠边/挨得近的家具不让两条 ID 叠在一起。
    const half = prop.plateSide === 'left' ? -10 : prop.plateSide === 'right' ? 10 : 0;
    plate.style.left = `calc(${(prop.x * 100).toFixed(2)}% + ${half}px)`;
    plate.style.top = `calc(${(prop.y * 100).toFixed(2)}% - ${HEAD_ANCHOR[prop.type] ?? 120}px)`;
    plate.style.zIndex = '470';
    return plate;
  }

  function render() {
    if (!host) return;
    host.replaceChildren();
    const wall = document.createElement('div');
    wall.className = 'room-wall';
    // 墙上一块状态屏：既是装饰也是「这间舱室在运行」的信号
    const screen = document.createElement('div');
    screen.className = 'room-screen';
    screen.innerHTML = '<i></i><i></i><i></i><b></b>';
    wall.append(screen);
    const floor = document.createElement('div');
    floor.className = 'room-floor';
    floor.style.top = (room.wallRatio * 100).toFixed(2) + '%';
    host.append(wall, floor);
    for (const prop of room.props || []) host.append(buildProp(prop));
    for (const prop of room.props || []) {
      const plate = buildPlate(prop);
      if (plate) host.append(plate);
    }
    applyUsage(pendingUsage);
  }

  function seats(role) {
    const out = [];
    for (const prop of room.props || []) {
      for (const seat of prop.seats || []) {
        if (!role || role === 'any' || seat.role === role) out.push({ x: seat.x, y: seat.y, propId: prop.id });
      }
    }
    for (const seat of room.fallbackSeats || []) {
      if (!role || role === 'any' || seat.role === role || seat.role === 'any') out.push({ x: seat.x, y: seat.y, propId: null });
    }
    return out;
  }

  // 接地线 → z-index。角色与家具用同一公式，深度关系才对得上。
  function depthZ(yNorm) { return 20 + Math.round(yNorm * FLOOR_H); }

  // 设施占用：usage 形如 { 'desk-a': 1 }。有人坐上去铭牌才亮灯。
  // stage-ui 的首次 applyEcosystem 可能早于 DOMContentLoaded（房间还没 mount），
  // 所以先缓存，render 时补画一次，避免首屏铭牌全灭。
  function applyUsage(usage) {
    if (!host) return;
    for (const plate of host.querySelectorAll('.room-plate')) {
      plate.dataset.used = usage && usage[plate.dataset.propId] ? '1' : '0';
    }
  }
  function setUsage(usage) {
    pendingUsage = usage || {};
    applyUsage(pendingUsage);
  }

  function mount() {
    const injected = window.__ROOM_LAYOUT;
    if (injected && Array.isArray(injected.props)) room = injected;
    host = document.getElementById('stage-room');
    render();
  }

  window.__room = {
    get layout() { return room; },
    seats,
    depthZ,
    setUsage,
    refresh: render,
    mount,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
