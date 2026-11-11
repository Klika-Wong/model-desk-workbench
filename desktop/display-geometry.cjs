'use strict';

// 窗口几何的纯计算：主进程与单测共用，不 require electron。
// 所有坐标、workArea、窗口尺寸都是 DIP，和 Electron 的 screen API 口径一致。
// 这里的规则只有两条：在任一块屏上还看得见就别搬；实在看不见就做最小平移。

function workAreaOf(display) {
  const a = display && display.workArea;
  if (!a || !Number.isFinite(a.x) || !Number.isFinite(a.y)
    || !Number.isFinite(a.width) || !Number.isFinite(a.height)
    || a.width <= 0 || a.height <= 0) return null;
  return { x: a.x, y: a.y, width: a.width, height: a.height };
}

function intersects(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
}

// 只要和任一块屏的工作区有交集就算可见。之前只比对主屏 workArea，
// 于是「桌宠拖到副屏 → 重启」会被判成越界、强行拉回主屏右下角。
function visibleOnAnyDisplay(bounds, displays) {
  return (displays || []).some((display) => {
    const area = workAreaOf(display);
    return area ? intersects(bounds, area) : false;
  });
}

// 选救援用的显示器：还有重叠时选重叠面积最大的；完全在外面时选离得最近的。
// 拔掉外接屏后贴回主屏靠近原位置的一侧，比直接跳到主屏右下角更容易找。
function nearestDisplay(bounds, displays) {
  let best = null;
  let bestScore = -Infinity;
  for (const display of displays || []) {
    const area = workAreaOf(display);
    if (!area) continue;
    const ow = Math.max(0, Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x));
    const oh = Math.max(0, Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y));
    const overlap = ow * oh;
    const dx = Math.max(area.x - (bounds.x + bounds.width), bounds.x - (area.x + area.width), 0);
    const dy = Math.max(area.y - (bounds.y + bounds.height), bounds.y - (area.y + area.height), 0);
    const score = overlap > 0 ? 1e9 + overlap : -Math.hypot(dx, dy);
    if (score > bestScore) { bestScore = score; best = area; }
  }
  return best;
}

// 把窗口完整夹进目标屏的工作区；窗口比工作区还大时贴左上，至少保证左上角可见。
function clampToDisplays(bounds, displays) {
  const area = nearestDisplay(bounds, displays);
  if (!area) return null;
  const maxX = Math.max(area.x, area.x + area.width - bounds.width);
  const maxY = Math.max(area.y, area.y + area.height - bounds.height);
  return {
    x: Math.round(Math.min(Math.max(bounds.x, area.x), maxX)),
    y: Math.round(Math.min(Math.max(bounds.y, area.y), maxY)),
    area,
  };
}

// 主窗口固定尺寸可能大于工作区（小屏、125%/150% 缩放、任务栏占用）。
// 收缩尺寸的同时也要收缩 minWidth/minHeight，否则 Electron 仍会把窗口撑回超屏尺寸。
function fitWindowSize(desired, minimum, area) {
  const availW = Math.max(1, Math.floor(Number(area && area.width) || 0));
  const availH = Math.max(1, Math.floor(Number(area && area.height) || 0));
  const minW = Math.min(Number(minimum.width) || 0, availW);
  const minH = Math.min(Number(minimum.height) || 0, availH);
  return {
    width: Math.min(availW, Math.max(Number(desired.width) || 0, minW)),
    height: Math.min(availH, Math.max(Number(desired.height) || 0, minH)),
    minWidth: minW,
    minHeight: minH,
  };
}

module.exports = { workAreaOf, visibleOnAnyDisplay, nearestDisplay, clampToDisplays, fitWindowSize };
