'use strict';

// Local memory storage for the desktop shell prototype.
// This module performs application-level data validation only. It is not an
// OS sandbox and it does not authenticate agents or external callers.

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const KINDS = ['project', 'shared', 'special'];
const STATUSES = ['candidate', 'published', 'retracted'];

const LIMITS = {
  id: { min: 1, max: 64 },
  spaceName: { min: 1, max: 40 },
  capacityChars: { min: 500, max: 200000 },
  contextChars: { min: 100, max: 20000 },
  section: { min: 1, max: 24 },
  title: { min: 1, max: 120 },
  body: { min: 1, max: 100000 },
  source: { min: 0, max: 200 },
  sections: { min: 1, max: 12 },
};

const DEFAULT_CAPACITY_CHARS = 12000;
const DEFAULT_CONTEXT_CHARS = 2000;
const DEFAULT_SECTIONS = ['目标与约束', '当前进度', '决定与依据', '待办备忘'];

const SPACE_FIELDS = ['id', 'name', 'kind', 'capacityChars', 'contextChars', 'sections', 'entries'];
const ENTRY_FIELDS = ['id', 'title', 'body', 'section', 'source', 'status', 'version', 'createdAt', 'updatedAt', 'retractReason', 'retractedAt'];
const REQUIRED_ENTRY_FIELDS = ['id', 'title', 'body', 'section', 'source', 'status', 'version', 'createdAt', 'updatedAt'];
const SPACE_PATCH_FIELDS = ['name', 'capacityChars', 'contextChars', 'sections'];
const ENTRY_PATCH_FIELDS = ['title', 'body', 'section', 'source'];

const COMMAND_FIELDS = {
  createSpace: ['expectedRevision', 'type', 'name', 'kind'],
  updateSpace: ['expectedRevision', 'type', 'spaceId', 'patch'],
  addEntry: ['expectedRevision', 'type', 'spaceId', 'title', 'body', 'section', 'source'],
  updateEntry: ['expectedRevision', 'type', 'spaceId', 'entryId', 'patch'],
  publishEntry: ['expectedRevision', 'type', 'spaceId', 'entryId'],
  retractEntry: ['expectedRevision', 'type', 'spaceId', 'entryId', 'reason'],
};

function fail(message, code = 'INVALID_COMMAND') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function assertPlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw fail(`${label}必须是对象。`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw fail(`${label}必须是普通对象。`);
  }
}

function assertExactKeys(value, allowed, label) {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw fail(`${label}包含不允许的字段「${key}」。`);
  }
}

function assertRequiredKeys(value, required, label) {
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw fail(`${label}缺少必填字段「${key}」。`);
  }
}

function charLength(text) {
  return [...text].length;
}

function readText(value, label, { min, max }) {
  if (typeof value !== 'string') throw fail(`${label}必须是文本。`);
  const text = value.trim();
  const length = charLength(text);
  if (length < min) throw fail(`${label}不能为空。`);
  if (length > max) throw fail(`${label}长度不能超过 ${max} 个字符。`);
  return text;
}

function readInteger(value, label, { min, max }) {
  if (!Number.isInteger(value)) throw fail(`${label}必须是整数。`);
  if (value < min || value > max) throw fail(`${label}必须在 ${min} 到 ${max} 之间。`);
  return value;
}

function readSections(value) {
  if (!Array.isArray(value)) throw fail('栏目列表必须是数组。');
  if (value.length < LIMITS.sections.min || value.length > LIMITS.sections.max) {
    throw fail(`栏目数量必须在 ${LIMITS.sections.min} 到 ${LIMITS.sections.max} 个之间。`);
  }
  const names = value.map((item, index) => readText(item, `第 ${index + 1} 个栏目名称`, LIMITS.section));
  if (new Set(names).size !== names.length) throw fail('栏目名称不能重复。');
  return names;
}

function totalBodyChars(space) {
  return space.entries.reduce((sum, entry) => sum + charLength(entry.body), 0);
}

function makeSpaceRecord({ id, name, kind }) {
  return {
    id,
    name,
    kind,
    capacityChars: DEFAULT_CAPACITY_CHARS,
    contextChars: DEFAULT_CONTEXT_CHARS,
    sections: [...DEFAULT_SECTIONS],
    entries: [],
  };
}

function seedState() {
  // Fixed demo spaces. They never read any real project or personal material.
  return {
    revision: 0,
    spaces: [
      makeSpaceRecord({ id: 'project-a', name: '示例项目 A', kind: 'project' }),
      makeSpaceRecord({ id: 'project-b', name: '示例项目 B', kind: 'project' }),
      makeSpaceRecord({ id: 'shared', name: '本机公共池', kind: 'shared' }),
    ],
  };
}

function validateEntryRecord(entry, sections, spaceId, entryIds) {
  assertPlainObject(entry, '记忆条目');
  const label = typeof entry.id === 'string' ? `记忆条目「${entry.id}」` : '记忆条目';
  assertExactKeys(entry, ENTRY_FIELDS, label);
  assertRequiredKeys(entry, REQUIRED_ENTRY_FIELDS, label);
  const id = readText(entry.id, '记忆条目 id', LIMITS.id);
  if (entryIds.has(id)) throw new Error(`记忆条目 id「${id}」重复。`);
  entryIds.add(id);
  readText(entry.title, '记忆标题', LIMITS.title);
  readText(entry.body, '记忆正文', LIMITS.body);
  readText(entry.source, '来源引用', LIMITS.source);
  const section = readText(entry.section, '记忆栏目', LIMITS.section);
  if (!sections.includes(section)) {
    throw new Error(`空间「${spaceId}」中的记忆条目「${id}」使用了不存在的栏目「${section}」。`);
  }
  if (!STATUSES.includes(entry.status)) {
    throw new Error(`记忆条目「${id}」的状态「${String(entry.status)}」无效。`);
  }
  if (!Number.isInteger(entry.version) || entry.version < 1) {
    throw new Error(`记忆条目「${id}」的 version 必须是大于 0 的整数。`);
  }
  for (const field of ['createdAt', 'updatedAt']) {
    const value = entry[field];
    if (typeof value !== 'string' || value.trim() === '' || Number.isNaN(Date.parse(value))) {
      throw new Error(`记忆条目「${id}」的 ${field} 不是有效时间。`);
    }
  }
  // Retraction audit fields are optional (older entries predate them) but, when
  // present, must be well-formed.
  if (Object.hasOwn(entry, 'retractReason')) {
    readText(entry.retractReason, '撤回原因', { min: 1, max: 200 });
  }
  if (Object.hasOwn(entry, 'retractedAt')) {
    if (typeof entry.retractedAt !== 'string' || entry.retractedAt.trim() === '' || Number.isNaN(Date.parse(entry.retractedAt))) {
      throw new Error(`记忆条目「${id}」的 retractedAt 不是有效时间。`);
    }
  }
}

function validateSpaceRecord(space, spaceIds, entryIds) {
  assertPlainObject(space, '空间');
  assertExactKeys(space, SPACE_FIELDS, '空间');
  assertRequiredKeys(space, SPACE_FIELDS, '空间');
  const id = readText(space.id, '空间 id', LIMITS.id);
  if (spaceIds.has(id)) throw new Error(`空间 id「${id}」重复。`);
  spaceIds.add(id);
  readText(space.name, '空间名称', LIMITS.spaceName);
  if (!KINDS.includes(space.kind)) throw new Error(`空间「${id}」的类型「${String(space.kind)}」无效。`);
  readInteger(space.capacityChars, `空间「${id}」的总容量`, LIMITS.capacityChars);
  readInteger(space.contextChars, `空间「${id}」的上下文预算`, LIMITS.contextChars);
  if (space.contextChars > space.capacityChars) {
    throw new Error(`空间「${id}」的上下文预算大于总容量。`);
  }
  const sections = readSections(space.sections);
  if (!Array.isArray(space.entries)) throw new Error(`空间「${id}」的 entries 必须是数组。`);
  let used = 0;
  for (const entry of space.entries) {
    validateEntryRecord(entry, sections, id, entryIds);
    used += charLength(entry.body.trim());
  }
  if (used > space.capacityChars) {
    throw new Error(`空间「${id}」的记忆正文总字符数 ${used} 超过容量 ${space.capacityChars}。`);
  }
}

function validateDocument(document) {
  assertPlainObject(document, '记忆数据');
  assertExactKeys(document, ['revision', 'spaces'], '记忆数据');
  assertRequiredKeys(document, ['revision', 'spaces'], '记忆数据');
  if (!Number.isInteger(document.revision) || document.revision < 0) {
    throw new Error('revision 必须是非负整数。');
  }
  if (!Array.isArray(document.spaces) || document.spaces.length === 0) {
    throw new Error('spaces 必须是非空数组。');
  }
  const spaceIds = new Set();
  const entryIds = new Set();
  for (const space of document.spaces) validateSpaceRecord(space, spaceIds, entryIds);
}

class MemoryStore {
  #filePath;

  #revision;

  #spaces;

  constructor(filePath) {
    if (typeof filePath !== 'string' || filePath.trim() === '') {
      throw fail('记忆存储需要有效的文件路径。', 'INVALID_PATH');
    }
    this.#filePath = path.resolve(filePath);
    const loaded = this.#load();
    this.#revision = loaded.revision;
    this.#spaces = loaded.spaces;
  }

  snapshot() {
    return {
      revision: this.#revision,
      spaces: structuredClone(this.#spaces),
    };
  }

  execute(command) {
    const next = this.#prepare(command);
    this.#persist(next);
    this.#revision = next.revision;
    this.#spaces = next.spaces;
    return this.snapshot();
  }

  preview(command) {
    return this.#prepare(command);
  }

  #prepare(command) {
    assertPlainObject(command, '指令');
    assertRequiredKeys(command, ['expectedRevision', 'type'], '指令');
    const expectedRevision = command.expectedRevision;
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw fail('expectedRevision 必须是非负整数。');
    }
    if (expectedRevision !== this.#revision) {
      throw fail(
        `版本冲突：当前修订号为 ${this.#revision}，指令期望 ${expectedRevision}。请刷新后重试。`,
        'REVISION_CONFLICT',
      );
    }
    if (typeof command.type !== 'string' || !Object.hasOwn(COMMAND_FIELDS, command.type)) {
      throw fail(`未知操作「${String(command.type)}」。`, 'UNKNOWN_OPERATION');
    }
    const allowedFields = COMMAND_FIELDS[command.type];
    assertExactKeys(command, allowedFields, '指令');
    if (command.type === 'createSpace') {
      assertRequiredKeys(command, ['name', 'kind'], '指令');
    } else {
      assertRequiredKeys(command, ['spaceId'], '指令');
    }

    const next = structuredClone({ revision: this.#revision, spaces: this.#spaces });
    switch (command.type) {
      case 'createSpace':
        this.#createSpace(command, next);
        break;
      case 'updateSpace':
        this.#updateSpace(command, next);
        break;
      case 'addEntry':
        this.#addEntry(command, next);
        break;
      case 'updateEntry':
        this.#updateEntry(command, next);
        break;
      case 'publishEntry':
        this.#publishEntry(command, next);
        break;
      case 'retractEntry':
        this.#retractEntry(command, next);
        break;
      default:
        throw fail(`未知操作「${command.type}」。`, 'UNKNOWN_OPERATION');
    }

    next.revision = this.#revision + 1;
    return next;
  }

  #load() {
    let text;
    try {
      text = fs.readFileSync(this.#filePath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw fail(`无法读取记忆数据文件「${this.#filePath}」：${error.message}`, 'READ_FAILED');
      }
      const seeded = seedState();
      this.#persist(seeded);
      return seeded;
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw fail(
        `记忆数据文件已损坏（JSON 解析失败），未做任何覆盖：「${this.#filePath}」。`,
        'CORRUPT_FILE',
      );
    }
    try {
      validateDocument(parsed);
    } catch (error) {
      throw fail(
        `记忆数据文件结构无效，未做任何覆盖：「${this.#filePath}」；${error.message}`,
        'CORRUPT_FILE',
      );
    }
    return parsed;
  }

  #persist(state) {
    const directory = path.dirname(this.#filePath);
    const tempPath = path.join(
      directory,
      `.${path.basename(this.#filePath)}.${process.pid}.${randomUUID()}.tmp`,
    );
    const payload = `${JSON.stringify(state, null, 2)}\n`;
    try {
      const handle = fs.openSync(tempPath, 'wx', 0o600);
      try {
        fs.writeFileSync(handle, payload, 'utf8');
        fs.fsyncSync(handle);
      } finally {
        fs.closeSync(handle);
      }
      fs.renameSync(tempPath, this.#filePath);
    } catch (error) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // The temp file may never have been created; nothing to clean up.
      }
      throw fail(`记忆数据写入失败，内存状态未改变：${error.message}`, 'WRITE_FAILED');
    }
  }

  #findSpace(state, spaceId) {
    if (typeof spaceId !== 'string' || spaceId.trim() === '') {
      throw fail('spaceId 必须是非空文本。');
    }
    const space = state.spaces.find((item) => item.id === spaceId);
    if (!space) throw fail(`未找到空间「${spaceId}」。`, 'SPACE_NOT_FOUND');
    return space;
  }

  #findEntry(space, entryId) {
    if (typeof entryId !== 'string' || entryId.trim() === '') {
      throw fail('entryId 必须是非空文本。');
    }
    const entry = space.entries.find((item) => item.id === entryId);
    if (!entry) {
      throw fail('未找到该记忆条目，或该条目不属于当前空间。', 'ENTRY_NOT_FOUND');
    }
    return entry;
  }

  #createSpace(command, state) {
    const name = readText(command.name, '空间名称', LIMITS.spaceName);
    if (typeof command.kind !== 'string' || !KINDS.includes(command.kind)) {
      throw fail(`空间类型必须是 ${KINDS.join(' / ')} 之一。`);
    }
    state.spaces.push(makeSpaceRecord({ id: randomUUID(), name, kind: command.kind }));
  }

  #updateSpace(command, state) {
    const space = this.#findSpace(state, command.spaceId);
    const patch = command.patch;
    assertPlainObject(patch, '空间更新 patch');
    assertExactKeys(patch, SPACE_PATCH_FIELDS, '空间更新 patch');
    if (Object.keys(patch).length === 0) throw fail('空间更新 patch 不能为空。');

    let name = space.name;
    let capacityChars = space.capacityChars;
    let contextChars = space.contextChars;
    let sections = space.sections;

    if (Object.hasOwn(patch, 'name')) name = readText(patch.name, '空间名称', LIMITS.spaceName);
    if (Object.hasOwn(patch, 'capacityChars')) {
      capacityChars = readInteger(patch.capacityChars, '总容量', LIMITS.capacityChars);
    }
    if (Object.hasOwn(patch, 'contextChars')) {
      contextChars = readInteger(patch.contextChars, '上下文预算', LIMITS.contextChars);
    }
    if (Object.hasOwn(patch, 'sections')) sections = readSections(patch.sections);

    const usedChars = totalBodyChars(space);
    if (capacityChars < usedChars) {
      throw fail(
        `总容量不能小于已有记忆正文的字符总数（当前 ${usedChars} 字符），请先精简条目。`,
        'CAPACITY_TOO_SMALL',
      );
    }
    if (contextChars > capacityChars) {
      throw fail(`上下文预算不能大于总容量（${capacityChars} 字符）。`);
    }

    if (Object.hasOwn(patch, 'sections')) {
      for (const entry of space.entries) {
        if (!sections.includes(entry.section)) {
          const affected = space.entries.filter((item) => item.section === entry.section).length;
          throw fail(
            `栏目「${entry.section}」仍有 ${affected} 条记忆使用，请先移动这些条目，再删除或改名该栏目。`,
            'SECTION_IN_USE',
          );
        }
      }
    }

    space.name = name;
    space.capacityChars = capacityChars;
    space.contextChars = contextChars;
    space.sections = sections;
  }

  #addEntry(command, state) {
    const space = this.#findSpace(state, command.spaceId);
    const title = readText(command.title, '记忆标题', LIMITS.title);
    const body = readText(command.body, '记忆正文', LIMITS.body);
    const section = readText(command.section, '栏目标识', LIMITS.section);
    const source = readText(command.source, '来源引用', LIMITS.source);

    if (!space.sections.includes(section)) {
      throw fail(`栏目「${section}」不在该空间的栏目列表中。`, 'UNKNOWN_SECTION');
    }

    const usedChars = totalBodyChars(space);
    const incomingChars = charLength(body);
    if (usedChars + incomingChars > space.capacityChars) {
      throw fail(
        `容量不足：已有正文 ${usedChars} 字符，新增 ${incomingChars} 字符，超过上限 ${space.capacityChars} 字符。`,
        'CAPACITY_EXCEEDED',
      );
    }

    const now = new Date().toISOString();
    space.entries.push({
      id: randomUUID(),
      title,
      body,
      section,
      source,
      status: 'candidate',
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  #updateEntry(command, state) {
    const space = this.#findSpace(state, command.spaceId);
    const entry = this.#findEntry(space, command.entryId);
    if (entry.status === 'retracted') {
      throw fail('已撤回的记忆不能修改。', 'ENTRY_RETRACTED');
    }
    const patch = command.patch;
    assertPlainObject(patch, '条目更新 patch');
    assertExactKeys(patch, ENTRY_PATCH_FIELDS, '条目更新 patch');
    if (Object.keys(patch).length === 0) throw fail('条目更新 patch 不能为空。');

    let title = entry.title;
    let body = entry.body;
    let section = entry.section;
    let source = entry.source;

    if (Object.hasOwn(patch, 'title')) title = readText(patch.title, '记忆标题', LIMITS.title);
    if (Object.hasOwn(patch, 'body')) body = readText(patch.body, '记忆正文', LIMITS.body);
    if (Object.hasOwn(patch, 'section')) section = readText(patch.section, '栏目标识', LIMITS.section);
    if (Object.hasOwn(patch, 'source')) source = readText(patch.source, '来源引用', LIMITS.source);

    if (!space.sections.includes(section)) {
      throw fail(`栏目「${section}」不在该空间的栏目列表中。`, 'UNKNOWN_SECTION');
    }

    const usedChars = totalBodyChars(space) - charLength(entry.body) + charLength(body);
    if (usedChars > space.capacityChars) {
      throw fail(
        `修改后正文总字符数为 ${usedChars}，超过容量上限 ${space.capacityChars} 字符。`,
        'CAPACITY_EXCEEDED',
      );
    }

    entry.title = title;
    entry.body = body;
    entry.section = section;
    entry.source = source;
    entry.version += 1;
    entry.updatedAt = new Date().toISOString();
    if (entry.status === 'published') entry.status = 'candidate';
  }

  #publishEntry(command, state) {
    const space = this.#findSpace(state, command.spaceId);
    const entry = this.#findEntry(space, command.entryId);
    if (entry.status === 'published') throw fail('该记忆已经发布，无需重复发布。', 'ALREADY_PUBLISHED');
    if (entry.status === 'retracted') throw fail('已撤回的记忆不能发布。', 'ENTRY_RETRACTED');
    if (!entry.source.trim()) throw fail('请先填写来源或核实依据，再确认发布。', 'SOURCE_REQUIRED');
    entry.status = 'published';
    entry.version += 1;
    entry.updatedAt = new Date().toISOString();
  }

  #retractEntry(command, state) {
    const space = this.#findSpace(state, command.spaceId);
    const entry = this.#findEntry(space, command.entryId);
    if (entry.status === 'retracted') throw fail('该记忆已经撤回，不会再次生效。', 'ALREADY_RETRACTED');
    const reason = readText(command.reason, '撤回原因', { min: 1, max: 200 });
    const now = new Date().toISOString();
    entry.status = 'retracted';
    entry.retractReason = reason;
    entry.retractedAt = now;
    entry.version += 1;
    entry.updatedAt = now;
  }
}

module.exports = { MemoryStore };
