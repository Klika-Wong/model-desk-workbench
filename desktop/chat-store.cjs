'use strict';

// 对话记录的本机持久化：每项目一份、纯文本、限长。
// 只保存对话本身（谁说了什么），不保存任务 ID 之外的任何系统信息，也不碰记忆库。

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

function projectFile(directory, project) {
  if (typeof project !== 'string' || !path.win32.isAbsolute(project) || project.includes('\0')) {
    throw new Error('对话记录需要明确的项目绝对路径。');
  }
  const identity = path.win32.resolve(project).toLowerCase();
  return path.join(directory, `${createHash('sha256').update(identity).digest('hex')}.json`);
}

const MAX_MESSAGES = 60;
const MAX_CHARS = 200000;
// 重开后要能找回原任务，只存一个任务 ID，不存任何别的系统状态。
// 面板生成的 ID 形如 20261027-214133-97c67a；只收可见安全字符，防止坏值进文件。
const MAX_TASK_ID = 120;
function normalizeTaskId(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  if (!id || id.length > MAX_TASK_ID) return null;
  if (!/^[\w.:-]+$/.test(id)) return null;
  return id;
}

function normalize(message) {
  if (!message || typeof message !== 'object') return null;
  const role = message.role === 'user' || message.role === 'assistant' ? message.role : null;
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  if (!role || !text) return null;
  const row = { role, text };
  if (typeof message.meta === 'string' && message.meta) row.meta = message.meta.slice(0, 500);
  return row;
}

// 从尾部往前保留，超过条数或字数就丢最早的，并报告丢了几条。
function trim(messages, { maxMessages = MAX_MESSAGES, maxChars = MAX_CHARS } = {}) {
  const list = Array.isArray(messages) ? messages.map(normalize).filter(Boolean) : [];
  const kept = [];
  let used = 0;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    const size = message.text.length + message.role.length;
    if (kept.length >= maxMessages) break;
    if (used + size > maxChars) break;
    kept.unshift(message);
    used += size;
  }
  return { messages: kept, dropped: list.length - kept.length };
}

function load(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(raw);
    const source = Array.isArray(data) ? data : data && data.messages;
    const { messages, dropped } = trim(source);
    // 旧文件没有这个字段，按 null 处理；坏值也不当成有效任务 ID。
    const pendingTaskId = normalizeTaskId(data && data.pendingTaskId);
    return { messages, dropped, corrupted: false, pendingTaskId };
  } catch (error) {
    // 文件不存在是正常的；解析失败要明确标出来，不能静默当成空对话。
    return { messages: [], dropped: 0, corrupted: error && error.code !== 'ENOENT' };
  }
}

function save(file, messages, pendingTaskId) {
  // 非数组绝不能落盘：trim() 会把它变成空数组，等于用空对话覆盖历史。
  if (!Array.isArray(messages)) throw new Error('对话记录必须是数组，未写入。');
  const { messages: kept, dropped } = trim(messages);
  const payload = { version: 1, savedAt: new Date().toISOString(), messages: kept };
  const taskId = normalizeTaskId(pendingTaskId);
  if (taskId) payload.pendingTaskId = taskId;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(payload), 'utf8');
  fs.renameSync(temp, file); // 先写临时文件再替换，避免写一半把旧记录弄坏
  return { saved: kept.length, dropped };
}

function clear(file) {
  fs.rmSync(file, { force: true });
  return true;
}

module.exports = { projectFile, trim, load, save, clear, normalizeTaskId, MAX_MESSAGES, MAX_CHARS, MAX_TASK_ID };
