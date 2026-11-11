/* 设施详情的接线与「不造假」检查：面板只能读已有事实，不能自己造指标或状态。
   真实点击、拖动、关闭由 `npm run verify:ui` 在 Electron 里跑。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const html = read('index.html');
const panel = read('facility-panel.js');
const stage = read('stage-ui.js');
const css = read('room.css');

test('面板脚本与容器都接进了页面，且初始不显示', () => {
  assert.match(html, /<script src="facility-panel\.js"><\/script>/);
  assert.match(html, /<div id="facility-panel"[^>]*hidden/);
  assert.ok(html.indexOf('facility-panel.js') > html.indexOf('room.js'), '面板脚本要排在房间布局之后');
  assert.doesNotMatch(html, /onclick\s*=|onpointerdown\s*=/i, 'CSP 是 script-src self，不能写内联 handler');
  assert.match(panel, /addEventListener\('click', onAction\)/);
});

test('面板文案里没有凭空捏造的经营指标', () => {
  assert.doesNotMatch(panel, /%/);
  assert.doesNotMatch(panel, /效率|产出|心情|收益|产能|龙门币/);
  assert.doesNotMatch(panel, /Math\.random|setInterval/);
  // 只从本机时钟和已算好的座位归属取数据
  assert.match(panel, /new Date\(\)\.getHours\(\)/);
  assert.match(panel, /window\.__stageUi\?\.facilityInfo\?\./);
});

test('面板的操作转交 stage-ui 已有能力，不另写一套状态', () => {
  assert.match(panel, /window\.__stageUi\?\.actorAction\?\./);
  assert.doesNotMatch(panel, /setActorState|classList\.add\('is-selected'\)|__avatars/);
  assert.match(stage, /function actorAction\(id, action\)/);
  assert.match(stage, /function facilityInfo\(id\)/);
  assert.match(stage, /facilityInfo, actorAction, daypartOf/);
  // 座位归属必须来自 applyEcosystem 的真实结果，不能在面板里重算
  assert.match(stage, /lastSeats = seated/);
});

test('铭牌可点、四个时段都有色温，头顶状态条不从透明动画起步', () => {
  assert.match(css, /\.room-plate \{ pointer-events: auto; cursor: pointer; \}/);
  for (const part of ['morning', 'day', 'dusk', 'night']) {
    assert.match(css, new RegExp(`#stage-floor\\[data-daypart="${part}"\\]::after`));
  }
  assert.match(stage, /className = 'actor-activity'/);
  assert.match(css, /\.actor-activity::before \{[\s\S]*?opacity: 0;/);
  // 隐藏窗口不推进 CSS 动画；waiting 必须是静态透明，而不是 opacity:0 起步的入场动画
  assert.doesNotMatch(css, /data-state="waiting"[^\n]*actor-activity[^\n]*animation/);
});
