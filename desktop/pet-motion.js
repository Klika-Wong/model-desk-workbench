/* 桌宠动作状态机：把「输入」翻译成已有的 9 行 spritesheet 动作 + 朝向。
 *
 * 借鉴的交互模式（没有复制对方代码或美术）：
 *   - ayangweb/BongoCat，Apache-2.0：键鼠输入驱动动作、动作冷却回落、离线无采集。
 *   - vishnuace/CatPet，MIT：光标跟随/转身、快速移动追光、闲置久了打盹。
 * 角色素材仍是 assets/characters/roster（llm-pet，仅非商业、需署名），见 THIRD_PARTY.md。
 *
 * 这里只做纯逻辑、不碰 DOM，方便 node --test 直接跑；DOM 应用在 pet-ui.js。
 * 不读全局键盘钩子、不联网、不加依赖：只处理桌宠窗口自己收得到的事件。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.__petMotion = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const DEFAULTS = {
    huntSpeed: 0.9,      // px/ms：光标划得多快算「追光」
    faceDeadzone: 14,    // px：光标离角色中心多近不转身，避免抖动
    sleepAfter: 15000,   // ms 无任何输入 → 打盹
  };
  // 临时动作的存活时间；到期自动回基础态。数值大的优先级高，能盖掉数值小的。
  const HOLD = { hunt: 650, type: 700, tap: 900, emote: 1800 };
  const PRIORITY = { hunt: 1, type: 2, tap: 3, emote: 4 };
  const ROW = { hunt: 'jump', type: 'work', tap: 'wave', emote: null, drag: 'moveRight' };

  function create(options) {
    const cfg = Object.assign({}, DEFAULTS, options || {});
    const now = cfg.now || (() => Date.now());
    let active = null;       // { row, kind, until }
    let facing = 'right';
    let dragging = false;
    let reduced = false;
    let lastInput = now();
    let lastPointer = null;  // { x, t }

    function set(kind, row, t, ms) {
      const p = PRIORITY[kind] || 0;
      if (active && active.until > t && (PRIORITY[active.kind] || 0) > p) return;
      active = { row, kind, until: t + (ms || HOLD[kind] || 600) };
    }

    function pointer(p, t) {
      if (typeof p.x !== 'number') return;
      // 转身只翻 scaleX，不切动作行：moveLeft/moveRight 是「走路」，
      // 用来表现看一眼会像角色自己跑起来了。
      if (typeof p.centerX === 'number' && Math.abs(p.x - p.centerX) > cfg.faceDeadzone) {
        facing = p.x < p.centerX ? 'left' : 'right';
      }
      let speed = 0;
      if (lastPointer && t > lastPointer.t) speed = Math.abs(p.x - lastPointer.x) / (t - lastPointer.t);
      lastPointer = { x: p.x, t };
      lastInput = t;
      if (speed >= cfg.huntSpeed) set('hunt', ROW.hunt, t);
    }

    function poke(kind, detail) {
      const t = now();
      if (kind === 'pointer') return pointer(detail || {}, t);
      if (kind === 'drag-start') { dragging = true; lastInput = t; active = null; return; }
      if (kind === 'drag-end') { dragging = false; lastInput = t; return; }
      if (kind === 'reduced') { reduced = Boolean(detail); return; }
      lastInput = t;
      const row = kind === 'emote' ? (detail && detail.row) : ROW[kind];
      if (!row || !Object.prototype.hasOwnProperty.call(HOLD, kind)) return;
      set(kind, row, t, kind === 'emote' && detail && detail.ms);
    }

    // 返回「此刻应该显示什么」。调用方只在结果变化时写 DOM。
    function tick() {
      const t = now();
      if (reduced) return { row: 'idle', facing: 'right' };
      if (dragging) return { row: ROW.drag, facing };
      if (active && active.until > t) return { row: active.row, facing };
      active = null;
      return { row: t - lastInput >= cfg.sleepAfter ? 'wait' : 'idle', facing };
    }

    function snapshot() {
      return { row: tick().row, facing, dragging, reduced, active: active && active.kind, sinceInput: now() - lastInput };
    }

    return { poke, tick, snapshot };
  }

  return { create, DEFAULTS, HOLD, ROW };
});
