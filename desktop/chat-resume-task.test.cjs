'use strict';

// 重开后恢复任务跟踪的接线回归断言。
// 「任务跟踪」的闭环要求是：只查询原任务状态、绝不重新派发。node 环境没有 DOM，
// 这里读真实源码守住这条边界；真实窗口里的行为由 verify:ui 的
// chat-resume-tracked-task-readonly 断言。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ui = fs.readFileSync(path.join(__dirname, 'chat-ui.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8');

function slice(from, to) {
  const start = ui.indexOf(from);
  const end = ui.indexOf(to, start + 1);
  assert.ok(start >= 0 && end > start, `源码里找不到 ${from} → ${to} 这一段`);
  return ui.slice(start, end);
}

const resume = slice('async function resumeTrackedTask', 'const spaceId = () =>');

test('恢复跟踪只查状态，不含任何派发调用', () => {
  assert.match(resume, /dispatchStatus\(taskId\)/, '恢复时应查询原任务状态');
  assert.doesNotMatch(resume, /dispatchSend/, '恢复跟踪绝不能重新派发任务');
  assert.doesNotMatch(resume, /scheduleLogPoll|poll\(/, '恢复不挂常驻轮询，避免重开后无限后台查询');
});

test('载入对话后只有拿到存下来的任务 ID 才进入恢复分支', () => {
  const load = slice('async function switchConversation', 'async function resumeTrackedTask');
  assert.match(load, /const trackedId = reply\.data\.pendingTaskId;/, '应从磁盘快照读取跟踪 ID');
  const read = load.indexOf('const trackedId = reply.data.pendingTaskId;');
  const call = load.indexOf('resumeTrackedTask(trackedId, revision)');
  assert.ok(read >= 0 && call > read, '先读出 ID 再调用恢复');
  assert.match(load, /if \(trackedId\) resumeTrackedTask/, '没有 ID 时不应进入恢复分支');
});

test('持久化把未终态任务 ID 一起存，没有就清掉', () => {
  assert.match(ui, /chatSave\(snapshot, project, pendingTask\)/, '存盘应带上当前未终态任务 ID');
});

test('主进程与 preload 把任务 ID 透传给存储层', () => {
  assert.match(main, /ipcMain\.handle\('chat:save', \(event, messages, project, pendingTaskId\)/,
    'chat:save 应接收任务 ID');
  assert.match(main, /chatStore\.save\(chatFile\(project\), messages, pendingTaskId\)/,
    '任务 ID 应传给存储层');
  assert.match(preload, /chatSave: \(messages, project, pendingTaskId\)/,
    'preload 应接受并转发任务 ID');
});

test('终态且有回答才补历史，非终态不补', () => {
  const terminal = resume.indexOf('const terminal =');
  const guard = resume.indexOf('if (!terminal)');
  const push = resume.indexOf("messages.push({ role: 'assistant'");
  assert.ok(terminal >= 0 && guard > terminal && push > guard,
    `补历史必须晚于终态判断：terminal=${terminal} guard=${guard} push=${push}`);
  assert.match(resume, /!failed && answer/, '只有成功且非空回答才补进历史');
});
