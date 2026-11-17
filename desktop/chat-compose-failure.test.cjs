'use strict';

// 多视角 compose 失败后不能留下孤立消息的接线回归断言。
// node 环境没有 DOM，这里读真实源码守住「写历史 / 清输入发生在 composePrompt 成功后」这一顺序；
// 真正点发送的失败路径由 verify:ui 在 Electron 里跑（chat-multi-compose-failure-keeps-draft）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ui = fs.readFileSync(path.join(__dirname, 'chat-ui.js'), 'utf8');

function slice(from, to) {
  const start = ui.indexOf(from);
  const end = ui.indexOf(to, start + 1);
  assert.ok(start >= 0 && end > start, `源码里找不到 ${from} → ${to} 这一段`);
  return ui.slice(start, end);
}

const send = slice('async function sendMulti', '// ---------- 讨论场景');

test('sendMulti 里 composePrompt 先于写历史和清空输入', () => {
  const compose = send.indexOf('await composePrompt(');
  const push = send.indexOf('messages.push({ role: \'user\', text })');
  const clear = send.indexOf("input.value = ''");
  const persist = send.indexOf('persist();');
  assert.ok(compose >= 0 && push > compose && clear > compose && persist > compose,
    `写历史/清输入必须晚于 composePrompt：compose=${compose} push=${push} clear=${clear} persist=${persist}`);
});

test('写历史与建分支卡在 try 内，compose 抛错会被 catch 接住', () => {
  const tryAt = send.indexOf('try {');
  const push = send.indexOf("messages.push({ role: 'user', text })");
  const card = send.indexOf('log.append(wrap)');
  const catchAt = send.indexOf('} catch (error) {');
  assert.ok(tryAt >= 0 && push > tryAt && card > tryAt && catchAt > card,
    `写历史/建卡应在 try 内且在 catch 之前：try=${tryAt} push=${push} card=${card} catch=${catchAt}`);
  assert.match(send, /say\(`多视角发送失败：\$\{error\.message\}`, true\)/,
    'compose 失败应给出如实报错');
});

test('停止/切页复查仍在 compose 之后，且早于写历史', () => {
  const compose = send.indexOf('await composePrompt(');
  const guard = send.indexOf('if (gen !== multiGeneration) return;');
  const push = send.indexOf("messages.push({ role: 'user', text })");
  assert.ok(guard > compose && guard < push,
    `停止复查应在 compose 后、写历史前：compose=${compose} guard=${guard} push=${push}`);
});

test('finally 复位组状态，失败后发送按钮能恢复', () => {
  assert.match(send, /finally \{[\s\S]*multiGroupRunning = false;[\s\S]*multiTaskIds\.clear\(\);[\s\S]*refresh\(\);[\s\S]*\}/,
    'finally 必须复位组运行状态并刷新按钮');
});
