'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('./display-geometry.cjs');

const display = (x, y, width, height) => ({ workArea: { x, y, width, height } });
const PRIMARY = display(0, 0, 1920, 1032);
const RIGHT = display(1920, 0, 1600, 900);
const LEFT = display(-1600, -100, 1600, 900);
const PET = { width: 250, height: 300 };
const at = (x, y) => Object.assign({ x, y }, PET);

test('副屏上的位置在双屏配置里算可见，单屏配置里才算越界', () => {
  const onRight = at(2100, 300);
  assert.equal(g.visibleOnAnyDisplay(onRight, [PRIMARY, RIGHT]), true,
    '拖到副屏的位置不能因为不在主屏 workArea 就被判越界');
  assert.equal(g.visibleOnAnyDisplay(at(1800, 300), [PRIMARY]), true,
    '窗口压在主屏右缘时仍看得见，不该搬');
  assert.equal(g.visibleOnAnyDisplay(onRight, [PRIMARY]), false,
    '副屏已拔掉、位置整块落在屏外时才需要救援');
  assert.equal(g.visibleOnAnyDisplay(at(2400, 300), [PRIMARY]), false);
  assert.equal(g.visibleOnAnyDisplay(at(2400, 300), [PRIMARY, RIGHT]), true);
});

test('左侧负坐标显示器同样参与判定', () => {
  assert.equal(g.visibleOnAnyDisplay(at(-1200, 100), [LEFT]), true);
  assert.equal(g.visibleOnAnyDisplay(at(-1200, 100), [PRIMARY]), false);
  assert.equal(g.visibleOnAnyDisplay(at(0, 0), [LEFT]), false, '刚好贴边不算重叠');
});

test('坏掉的显示器数据被忽略，不会让判定抛异常', () => {
  assert.equal(g.visibleOnAnyDisplay(at(100, 100), [null, {}, { workArea: { x: 0 } }, PRIMARY]), true);
  assert.equal(g.visibleOnAnyDisplay(at(100, 100), [null, {}]), false);
  assert.equal(g.clampToDisplays(at(100, 100), [null, {}]), null, '没有可用屏时不硬编位置');
});

test('拔掉副屏后按最小平移夹回主屏，不跳到主屏右下角', () => {
  const rescued = g.clampToDisplays(at(2100, 300), [PRIMARY]);
  assert.deepEqual([rescued.x, rescued.y], [1920 - PET.width, 300],
    '只横向拉回主屏右边缘，纵向位置保持不动');
  assert.equal(g.visibleOnAnyDisplay({ x: rescued.x, y: rescued.y, ...PET }, [PRIMARY]), true,
    '救援后的位置必须完整可见');
});

test('多个显示器时选重叠最多或距离最近的一块', () => {
  // 原来的窗口同时压在主屏右缘和副屏左缘，主屏重叠更多 → 夹回主屏。
  const mostlyPrimary = g.clampToDisplays({ x: 1700, y: 200, width: 400, height: 300 }, [PRIMARY, RIGHT]);
  assert.equal(mostlyPrimary.area.x, 0);
  // 完全在左侧副屏外时，选离得最近的左屏而不是主屏。
  const nearLeft = g.clampToDisplays(at(-2200, 100), [PRIMARY, LEFT]);
  assert.equal(nearLeft.area.x, -1600);
  assert.equal(g.visibleOnAnyDisplay({ x: nearLeft.x, y: nearLeft.y, ...PET }, [PRIMARY, LEFT]), true);
});

test('窗口比工作区还大时贴左上，至少左上角可见', () => {
  const tiny = display(0, 0, 200, 180);
  const rescued = g.clampToDisplays({ x: 900, y: 700, width: 500, height: 400 }, [tiny]);
  assert.deepEqual([rescued.x, rescued.y], [0, 0]);
});

test('主窗口尺寸按工作区收缩，普通桌面保持原有 1380x900', () => {
  assert.deepEqual(g.fitWindowSize({ width: 1380, height: 900 }, { width: 800, height: 700 }, PRIMARY.workArea),
    { width: 1380, height: 900, minWidth: 800, minHeight: 700 });
  assert.deepEqual(g.fitWindowSize({ width: 1380, height: 900 }, { width: 800, height: 700 }, display(0, 0, 1366, 728).workArea),
    { width: 1366, height: 728, minWidth: 800, minHeight: 700 });
  // 比 minWidth 还窄的工作区：连最小尺寸也要夹住，否则窗口仍会被撑出屏幕。
  assert.deepEqual(g.fitWindowSize({ width: 1380, height: 900 }, { width: 800, height: 700 }, display(0, 0, 640, 480).workArea),
    { width: 640, height: 480, minWidth: 640, minHeight: 480 });
});

test('带负原点的副屏工作区，夹取结果仍在屏内', () => {
  const rescued = g.clampToDisplays(at(-3000, -500), [LEFT]);
  assert.equal(rescued.x, LEFT.workArea.x);
  assert.equal(rescued.y, LEFT.workArea.y);
  assert.equal(g.visibleOnAnyDisplay({ x: rescued.x, y: rescued.y, ...PET }, [LEFT]), true);
});
