'use strict';

// 聊天页「多模型组跑起来之后停不下来」的回归断言。
// 这里读的是真实源码而不是复制品：node 环境没有 DOM，所以这一层只能守住接线，
// 真正的点击路径由 verify:ui 在 Electron 里跑。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ui = fs.readFileSync(path.join(__dirname, 'chat-ui.js'), 'utf8');
const multi = fs.readFileSync(path.join(__dirname, 'chat-multi.js'), 'utf8');

function slice(from, to) {
  const start = ui.indexOf(from);
  const end = ui.indexOf(to, start + 1);
  assert.ok(start >= 0 && end > start, `源码里找不到 ${from} → ${to} 这一段`);
  return ui.slice(start, end);
}

const watch = slice('async function watchBranch', 'async function sendMulti');
const discuss = slice('async function runDiscussionTurn', '// 讨论发言的');

test('两处轮询都有本地等待上限，且结束时会清掉定时器', () => {
  for (const [name, block] of [['多视角', watch], ['讨论', discuss]]) {
    assert.match(block, /let waitTimer = null;/, `${name} 没有声明等待定时器`);
    assert.match(block, /if \(waitTimer\) clearTimeout\(waitTimer\);/, `${name} 结束时没清定时器`);
    assert.match(block, /waitTimer = setTimeout\(/, `${name} 没有启动等待上限`);
    assert.match(block, /multi\.WAIT_TIMEOUT_MS/, `${name} 没有共用同一个等待上限`);
    assert.match(block, /multi\.markWaitTimeout\(branch/, `${name} 超时没有收敛分支`);
  }
});

test('超时文案只在纯逻辑模块里定义，界面不另写一套说法', () => {
  assert.match(multi, /等待超过 \$\{minutes\} 分钟仍未拿到终态/);
  assert.match(multi, /任务可能还在执行/);
  assert.match(multi, /markWaitTimeout, groupCancelMessage/, '纯函数必须导出给 UI 与单测共用');
  assert.ok(!/等待超过 3 分钟/.test(ui), '界面里不该硬编码第二份超时文案');
  assert.ok(!/请到「运行与连接」页查看/.test(ui), '界面里不该再写一份超时说明');
});

test('两处 finish 都登记到统一中止集合', () => {
  assert.match(watch, /multiFinishers\.add\(finish\);/);
  assert.match(discuss, /multiFinishers\.add\(finish\);/);
  assert.match(watch, /multiFinishers\.delete\(finish\);/);
  assert.match(discuss, /multiFinishers\.delete\(finish\);/);
  assert.match(ui, /function abortMulti\(\)[\s\S]{0,400}for \(const finish of \[\.\.\.multiFinishers\]\) finish\(\);/);
});

test('停止之后不再继续派发：两处轮询与两组循环都复查 generation', () => {
  assert.match(watch, /if \(gen !== multiGeneration\) return;/);
  assert.match(discuss, /if \(gen !== multiGeneration\) return null;/);
  assert.match(slice('async function sendMulti', '讨论场景：多个 Agent'), /if \(gen !== multiGeneration\) return;/);
  assert.match(slice('async function sendDiscussion', '// 导航'), /if \(gen !== multiGeneration\) break;/);
  assert.match(ui, /watchBranch\(branch, uis\[index\], prompt, gen\)/);
  assert.match(ui, /runDiscussionTurn\(model, prompt, .*labelOverride.*, gen\)/,
    '讨论轮询仍要传 generation（onState 现在多带一个排队文字参数）');
});

test('组运行时显示停止入口，逐个取消已派发任务', () => {
  assert.match(ui, /cancelBtn\.hidden = !pendingTask && !multiGroupRunning;/);
  assert.match(ui, /multiGroupRunning \? '停止这一组任务' : '停止当前任务'/);
  assert.match(ui, /if \(multiGroupRunning\) \{ await cancelGroup\(\); return; \}/);
  const cancel = slice('async function cancelGroup', "\$('chat-cancel').addEventListener");
  assert.match(cancel, /const ids = \[\.\.\.multiTaskIds\];/);
  assert.match(cancel, /window\.workbench\.dispatchCancel\(id\)/);
  assert.match(cancel, /reply && reply\.ok\) ok \+= 1; else failed \+= 1;/);
  assert.match(cancel, /groupCancelMessage\(\{ ok, failed, total: ids\.length \}\)/);
  assert.match(cancel, /abortMulti\(\);/, '取消请求发完后要停掉本地轮询');
});

test('任务 id 集合按轮登记与清空，不靠卡片数量猜', () => {
  assert.match(watch, /multiTaskIds\.add\(branch\.taskId\);/);
  assert.match(discuss, /multiTaskIds\.add\(branch\.taskId\);/);
  assert.match(ui, /function abortMulti\(\)[\s\S]{0,400}multiTaskIds\.clear\(\);/);
  // 两处组流程开始时清空，两处 finally 里再清一次
  assert.equal((ui.match(/multiTaskIds\.clear\(\);/g) || []).length >= 5, true);
});
