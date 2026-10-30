'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { MemoryStore } = require('./memory-store.cjs');

const DEFAULT_SECTIONS = ['目标与约束', '当前进度', '决定与依据', '待办备忘'];

function removeTestDirectory(directory) {
  const target = path.resolve(directory);
  const tempRoot = path.resolve(os.tmpdir());
  assert.equal(path.dirname(target).toLowerCase(), tempRoot.toLowerCase());
  assert.match(path.basename(target), /^model-desk-memory-[A-Za-z0-9]+$/);
  fs.rmSync(target, { recursive: true, force: true });
}

function createTempStore(t, fileName = 'memory.json') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'model-desk-memory-'));
  t.after(() => removeTestDirectory(directory));
  const filePath = path.join(directory, fileName);
  return { directory, filePath, store: new MemoryStore(filePath) };
}

function revisionOf(store) {
  return store.snapshot().revision;
}

function addEntry(store, spaceId, overrides = {}) {
  return store.execute({
    expectedRevision: revisionOf(store),
    type: 'addEntry',
    spaceId,
    title: '第一条记忆',
    body: '原型阶段的记忆正文。',
    section: '当前进度',
    source: '手工录入',
    ...overrides,
  });
}

function onlyEntry(snapshot, spaceId) {
  const space = snapshot.spaces.find((item) => item.id === spaceId);
  assert.ok(space, `缺少空间 ${spaceId}`);
  assert.equal(space.entries.length, 1);
  return space.entries[0];
}

test('首次构造生成三个空空间、默认容量与栏目，并原子写入磁盘', (t) => {
  const { filePath, store } = createTempStore(t);

  const snapshot = store.snapshot();
  assert.equal(snapshot.revision, 0);
  assert.deepEqual(
    snapshot.spaces.map((space) => [space.id, space.name, space.kind]),
    [
      ['project-a', '示例项目 A', 'project'],
      ['project-b', '示例项目 B', 'project'],
      ['shared', '本机公共池', 'shared'],
    ],
  );
  for (const space of snapshot.spaces) {
    assert.equal(space.capacityChars, 12000);
    assert.equal(space.contextChars, 2000);
    assert.deepEqual(space.sections, DEFAULT_SECTIONS);
    assert.deepEqual(space.entries, []);
  }

  assert.ok(fs.existsSync(filePath), '构造时应持久化初始种子');
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), snapshot);
});

test('snapshot 返回深拷贝，读取不修改修订号也不重写文件', (t) => {
  const { filePath, store } = createTempStore(t);
  addEntry(store, 'project-a');
  const before = fs.readFileSync(filePath, 'utf8');

  const snapshot = store.snapshot();
  snapshot.revision = 999;
  snapshot.spaces[0].name = '被篡改';
  snapshot.spaces[0].sections.push('外部注入');
  snapshot.spaces[0].entries[0].status = 'published';
  snapshot.spaces[0].entries.push({ id: 'fake' });

  const fresh = store.snapshot();
  assert.equal(fresh.revision, 1);
  assert.equal(fresh.spaces[0].name, '示例项目 A');
  assert.deepEqual(fresh.spaces[0].sections, DEFAULT_SECTIONS);
  assert.equal(fresh.spaces[0].entries.length, 1);
  assert.equal(fresh.spaces[0].entries[0].status, 'candidate');
  assert.equal(fs.readFileSync(filePath, 'utf8'), before, 'snapshot 不应写盘');
});

test('重启后恢复空间、容量、栏目与记忆状态', (t) => {
  const { filePath, store } = createTempStore(t);

  let snapshot = store.execute({
    expectedRevision: 0,
    type: 'createSpace',
    name: '专用讨论区',
    kind: 'special',
  });
  const special = snapshot.spaces.find((space) => space.name === '专用讨论区');
  assert.ok(special);
  assert.equal(special.kind, 'special');
  assert.deepEqual(special.sections, DEFAULT_SECTIONS);

  snapshot = store.execute({
    expectedRevision: 1,
    type: 'updateSpace',
    spaceId: special.id,
    patch: { capacityChars: 4000, contextChars: 1200, sections: ['目标与约束', '当前进度'] },
  });
  assert.deepEqual(
    snapshot.spaces.find((space) => space.id === special.id),
    {
      id: special.id,
      name: '专用讨论区',
      kind: 'special',
      capacityChars: 4000,
      contextChars: 1200,
      sections: ['目标与约束', '当前进度'],
      entries: [],
    },
  );

  snapshot = addEntry(store, special.id, { title: '专项结论', body: '只在专用空间保存。' });
  const entry = onlyEntry(snapshot, special.id);
  snapshot = store.execute({
    expectedRevision: snapshot.revision,
    type: 'publishEntry',
    spaceId: special.id,
    entryId: entry.id,
  });
  assert.equal(onlyEntry(snapshot, special.id).status, 'published');

  const reopened = new MemoryStore(filePath);
  assert.deepEqual(reopened.snapshot(), snapshot, '重启后应完整恢复');

  const continued = addEntry(reopened, special.id, { title: '重启后新增' });
  assert.equal(continued.revision, snapshot.revision + 1);
  assert.equal(continued.spaces.find((space) => space.id === special.id).entries.length, 2);
});

test('跨空间 entryId 被拒绝，且原文与原状态保持不变', (t) => {
  const { store } = createTempStore(t);
  const withEntry = addEntry(store, 'project-a');
  const entry = onlyEntry(withEntry, 'project-a');
  const before = store.snapshot();

  for (const command of [
    { type: 'publishEntry', spaceId: 'shared', entryId: entry.id },
    { type: 'retractEntry', spaceId: 'project-b', entryId: entry.id },
    { type: 'updateEntry', spaceId: 'shared', entryId: entry.id, patch: { title: '被改标题' } },
  ]) {
    assert.throws(
      () => store.execute({ ...command, expectedRevision: before.revision }),
      /不属于当前空间/,
    );
    assert.deepEqual(store.snapshot(), before);
  }

  assert.equal(onlyEntry(store.snapshot(), 'project-a').title, '第一条记忆');
  assert.equal(onlyEntry(store.snapshot(), 'project-a').status, 'candidate');
});

test('旧 revision 与非法 expectedRevision 被拒绝', (t) => {
  const { store } = createTempStore(t);
  addEntry(store, 'project-a');
  const before = store.snapshot();

  assert.throws(
    () => store.execute({ expectedRevision: 0, type: 'createSpace', name: '过期写入', kind: 'project' }),
    /版本冲突/,
  );
  assert.deepEqual(store.snapshot(), before);

  for (const expectedRevision of ['1', 1.5, -1, null]) {
    assert.throws(
      () => store.execute({ expectedRevision, type: 'createSpace', name: '非法修订号', kind: 'project' }),
      /expectedRevision 必须是非负整数|版本冲突/,
    );
  }
  assert.deepEqual(store.snapshot(), before);
});

test('未知操作、未知字段与缺失字段被拒绝且不改变状态', (t) => {
  const { store } = createTempStore(t);
  const withEntry = addEntry(store, 'project-a');
  const entry = onlyEntry(withEntry, 'project-a');
  const before = store.snapshot();
  const base = before.revision;

  const cases = [
    [{ type: 'deleteSpace', spaceId: 'project-a' }, /未知操作/],
    [{ type: 'publishEntry', spaceId: 'project-a', entryId: entry.id, force: true }, /不允许的字段「force」/],
    [{ type: 'addEntry', spaceId: 'project-a', title: 't', body: 'b', section: '当前进度', source: 's', status: 'published' }, /不允许的字段「status」/],
    [{ type: 'addEntry', spaceId: 'project-a', title: 't', body: 'b', section: '当前进度', source: 's', extra: 1 }, /不允许的字段「extra」/],
    [{ type: 'updateSpace', spaceId: 'project-a', patch: { kind: 'shared' } }, /不允许的字段「kind」/],
    [{ type: 'updateSpace', spaceId: 'project-a', patch: { id: 'hijack' } }, /不允许的字段「id」/],
    [{ type: 'updateSpace', spaceId: 'project-a', patch: { entries: [] } }, /不允许的字段「entries」/],
    [{ type: 'updateSpace', spaceId: 'project-a', patch: { permissions: ['admin'] } }, /不允许的字段「permissions」/],
    [{ type: 'updateEntry', spaceId: 'project-a', entryId: entry.id, patch: { status: 'published' } }, /不允许的字段「status」/],
    [{ type: 'updateEntry', spaceId: 'project-a', entryId: entry.id, patch: {} }, /patch 不能为空/],
    [{ type: 'updateSpace', spaceId: 'project-a', patch: {} }, /patch 不能为空/],
    [{ type: 'addEntry', title: 't', body: 'b', section: '当前进度', source: 's' }, /缺少必填字段「spaceId」/],
    [{ type: 'createSpace', name: '缺少类型' }, /缺少必填字段「kind」/],
    [{ type: 'createSpace', name: '错误类型', kind: 'admin' }, /空间类型必须是/],
    [{ type: 'updateSpace', spaceId: 'no-such-space', patch: { name: 'x' } }, /未找到空间/],
  ];

  for (const [command, expected] of cases) {
    assert.throws(() => store.execute({ ...command, expectedRevision: base }), expected);
    assert.deepEqual(store.snapshot(), before, `失败后状态不应变化：${command.type}`);
  }
});

test('容量与上下文预算限制在区间内且不能低于已有正文', (t) => {
  const { store } = createTempStore(t);
  const before = store.snapshot();

  for (const patch of [
    { capacityChars: 499 },
    { capacityChars: 200001 },
    { capacityChars: 1200.5 },
    { contextChars: 99 },
    { contextChars: 20001 },
    { contextChars: 3000, capacityChars: 2000 },
  ]) {
    assert.throws(() => store.execute({
      expectedRevision: before.revision,
      type: 'updateSpace',
      spaceId: 'project-a',
      patch,
    }));
    assert.deepEqual(store.snapshot(), before);
  }

  const longBody = '字'.repeat(600);
  const added = addEntry(store, 'project-a', { body: longBody });
  assert.equal(onlyEntry(added, 'project-a').body, longBody);

  assert.throws(() => store.execute({
    expectedRevision: added.revision,
    type: 'updateSpace',
    spaceId: 'project-a',
    patch: { capacityChars: 500, contextChars: 500 },
  }), /不能小于已有记忆正文/);

  const tightened = store.execute({
    expectedRevision: added.revision,
    type: 'updateSpace',
    spaceId: 'project-a',
    patch: { capacityChars: 600, contextChars: 500 },
  });
  const space = tightened.spaces.find((item) => item.id === 'project-a');
  assert.equal(space.capacityChars, 600);
  assert.equal(space.contextChars, 500);

  assert.throws(
    () => addEntry(store, 'project-a', { body: '溢出' }),
    /容量不足/,
  );
  assert.throws(
    () => addEntry(store, 'project-a', { body: '字'.repeat(12001) }),
    /容量不足|长度不能超过/,
  );
  assert.equal(store.snapshot().revision, tightened.revision);
});

test('栏目数量、重复、空名与长度受限，被引用栏目需先移动条目', (t) => {
  const { store } = createTempStore(t);

  const invalidSections = [
    [],
    ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm'],
    ['重复', '重复'],
    ['有效', '  '],
    ['有效', '名'.repeat(25)],
    [123],
  ];
  for (const sections of invalidSections) {
    assert.throws(() => store.execute({
      expectedRevision: revisionOf(store),
      type: 'updateSpace',
      spaceId: 'shared',
      patch: { sections },
    }));
  }
  assert.deepEqual(store.snapshot().spaces[2].sections, DEFAULT_SECTIONS);

  const withEntry = addEntry(store, 'shared');
  const entry = onlyEntry(withEntry, 'shared');
  const before = store.snapshot();

  for (const sections of [
    ['目标与约束', '决定与依据', '待办备忘'],
    ['目标与约束', '进展', '决定与依据', '待办备忘'],
  ]) {
    assert.throws(() => store.execute({
      expectedRevision: before.revision,
      type: 'updateSpace',
      spaceId: 'shared',
      patch: { sections },
    }), /请先移动这些条目/);
    assert.deepEqual(store.snapshot(), before);
  }

  const moved = store.execute({
    expectedRevision: before.revision,
    type: 'updateEntry',
    spaceId: 'shared',
    entryId: entry.id,
    patch: { section: '待办备忘' },
  });
  assert.equal(onlyEntry(moved, 'shared').section, '待办备忘');

  const trimmed = store.execute({
    expectedRevision: moved.revision,
    type: 'updateSpace',
    spaceId: 'shared',
    patch: { sections: ['目标与约束', '决定与依据', '待办备忘'] },
  });
  assert.deepEqual(trimmed.spaces[2].sections, ['目标与约束', '决定与依据', '待办备忘']);
});

test('新增记忆校验标题、正文、栏目、来源与未知栏目', (t) => {
  const { store } = createTempStore(t);
  const base = revisionOf(store);

  const cases = [
    [{ section: '不存在的栏目' }, /不在该空间的栏目列表/],
    [{ title: '   ' }, /标题不能为空/],
    [{ title: '长'.repeat(121) }, /标题长度不能超过 120/],
    [{ body: '' }, /正文不能为空/],
    [{ source: 's'.repeat(201) }, /来源引用长度不能超过 200/],
    [{ title: 123 }, /标题必须是文本/],
    [{ body: null }, /正文必须是文本/],
  ];
  for (const [overrides, expected] of cases) {
    assert.throws(
      () => store.execute({
        expectedRevision: base,
        type: 'addEntry',
        spaceId: 'project-b',
        title: '合法标题',
        body: '合法正文',
        section: '当前进度',
        source: '手工录入',
        ...overrides,
      }),
      expected,
    );
  }
  assert.equal(store.snapshot().revision, base);
  assert.equal(store.snapshot().spaces[1].entries.length, 0);
});

test('发布后编辑退回候选，撤回后不能复活或修改', (t) => {
  const { store } = createTempStore(t);

  let snapshot = addEntry(store, 'project-a');
  let entry = onlyEntry(snapshot, 'project-a');
  assert.deepEqual(
    {
      status: entry.status,
      version: entry.version,
      section: entry.section,
      source: entry.source,
    },
    { status: 'candidate', version: 1, section: '当前进度', source: '手工录入' },
  );
  assert.equal(entry.createdAt, entry.updatedAt);

  snapshot = store.execute({
    expectedRevision: snapshot.revision,
    type: 'publishEntry',
    spaceId: 'project-a',
    entryId: entry.id,
  });
  entry = onlyEntry(snapshot, 'project-a');
  assert.equal(entry.status, 'published');
  assert.equal(entry.version, 2);

  snapshot = store.execute({
    expectedRevision: snapshot.revision,
    type: 'updateEntry',
    spaceId: 'project-a',
    entryId: entry.id,
    patch: { title: '修订后的标题' },
  });
  entry = onlyEntry(snapshot, 'project-a');
  assert.equal(entry.status, 'candidate', '已发布条目被修改后应退回候选');
  assert.equal(entry.version, 3);
  assert.equal(entry.title, '修订后的标题');

  snapshot = store.execute({
    expectedRevision: snapshot.revision,
    type: 'publishEntry',
    spaceId: 'project-a',
    entryId: entry.id,
  });
  assert.equal(onlyEntry(snapshot, 'project-a').version, 4);

  snapshot = store.execute({
    expectedRevision: snapshot.revision,
    type: 'retractEntry',
    spaceId: 'project-a',
    entryId: entry.id,
    reason: '来源失效，撤回',
  });
  const retracted = onlyEntry(snapshot, 'project-a');
  assert.equal(retracted.status, 'retracted');
  assert.equal(retracted.version, 5);
  assert.equal(retracted.retractReason, '来源失效，撤回');
  assert.ok(typeof retracted.retractedAt === 'string' && !Number.isNaN(Date.parse(retracted.retractedAt)));

  const before = store.snapshot();
  assert.throws(() => store.execute({
    expectedRevision: before.revision,
    type: 'updateEntry',
    spaceId: 'project-a',
    entryId: entry.id,
    patch: { body: '试图修改撤回条目' },
  }), /已撤回的记忆不能修改/);
  assert.throws(() => store.execute({
    expectedRevision: before.revision,
    type: 'publishEntry',
    spaceId: 'project-a',
    entryId: entry.id,
  }), /已撤回的记忆不能发布/);
  assert.throws(() => store.execute({
    expectedRevision: before.revision,
    type: 'retractEntry',
    spaceId: 'project-a',
    entryId: entry.id,
  }), /已经撤回/);

  assert.deepEqual(store.snapshot(), before, '失败的撤回相关操作不应改变状态');
  assert.equal(onlyEntry(store.snapshot(), 'project-a').status, 'retracted');
});

test('撤回必须提供原因，并记录原因与撤回时间（审计）', (t) => {
  const { filePath, store } = createTempStore(t);
  let snapshot = addEntry(store, 'project-a');
  const entry = onlyEntry(snapshot, 'project-a');
  snapshot = store.execute({ expectedRevision: snapshot.revision, type: 'publishEntry', spaceId: 'project-a', entryId: entry.id });

  assert.throws(() => store.execute({
    expectedRevision: snapshot.revision, type: 'retractEntry', spaceId: 'project-a', entryId: entry.id,
  }), /撤回原因必须是文本/);
  assert.throws(() => store.execute({
    expectedRevision: snapshot.revision, type: 'retractEntry', spaceId: 'project-a', entryId: entry.id, reason: '   ',
  }), /撤回原因不能为空/);
  assert.equal(onlyEntry(store.snapshot(), 'project-a').status, 'published', '缺少或空原因时不得改变状态');

  snapshot = store.execute({
    expectedRevision: snapshot.revision, type: 'retractEntry', spaceId: 'project-a', entryId: entry.id, reason: '来源链接已失效',
  });
  const retracted = onlyEntry(snapshot, 'project-a');
  assert.equal(retracted.status, 'retracted');
  assert.equal(retracted.retractReason, '来源链接已失效');
  assert.ok(!Number.isNaN(Date.parse(retracted.retractedAt)));

  const reloaded = onlyEntry(new MemoryStore(filePath).snapshot(), 'project-a');
  assert.equal(reloaded.retractReason, '来源链接已失效', '审计字段应持久化并在重启后恢复');
  assert.equal(reloaded.retractedAt, retracted.retractedAt);
});

test('写盘失败时内存状态与修订号保持不变', (t) => {
  const { directory, store } = createTempStore(t);
  const withEntry = addEntry(store, 'project-a');
  const entry = onlyEntry(withEntry, 'project-a');
  const before = store.snapshot();
  assert.equal(before.revision, 1);

  removeTestDirectory(directory);

  assert.throws(() => store.execute({
    expectedRevision: 1,
    type: 'createSpace',
    name: '写盘失败的空间',
    kind: 'project',
  }), /写入失败/);

  assert.throws(() => store.execute({
    expectedRevision: 1,
    type: 'publishEntry',
    spaceId: 'project-a',
    entryId: entry.id,
  }), /写入失败/);

  assert.deepEqual(store.snapshot(), before);
  assert.equal(store.snapshot().spaces.some((space) => space.name === '写盘失败的空间'), false);
  assert.equal(onlyEntry(store.snapshot(), 'project-a').status, 'candidate');
});

test('损坏或结构无效的数据文件报错且不被静默重置覆盖', (t) => {
  const { directory, filePath } = createTempStore(t);
  const broken = '{"revision": 0, "spaces": [';
  fs.writeFileSync(filePath, broken, 'utf8');
  assert.throws(() => new MemoryStore(filePath), /已损坏.*未做任何覆盖/);
  assert.equal(fs.readFileSync(filePath, 'utf8'), broken);

  const seededPath = path.join(directory, 'struct.json');
  const seeded = new MemoryStore(seededPath).snapshot();
  seeded.spaces[0].permissions = ['admin'];
  const tampered = `${JSON.stringify(seeded, null, 2)}\n`;
  fs.writeFileSync(seededPath, tampered, 'utf8');
  assert.throws(() => new MemoryStore(seededPath), /结构无效.*permissions/);
  assert.equal(fs.readFileSync(seededPath, 'utf8'), tampered);

  const missingFieldPath = path.join(directory, 'missing.json');
  const missing = new MemoryStore(missingFieldPath).snapshot();
  delete missing.spaces[2].contextChars;
  const missingText = `${JSON.stringify(missing, null, 2)}\n`;
  fs.writeFileSync(missingFieldPath, missingText, 'utf8');
  assert.throws(() => new MemoryStore(missingFieldPath), /结构无效/);
  assert.equal(fs.readFileSync(missingFieldPath, 'utf8'), missingText);

  const badRevisionPath = path.join(directory, 'revision.json');
  const badRevision = new MemoryStore(badRevisionPath).snapshot();
  badRevision.revision = '一';
  fs.writeFileSync(badRevisionPath, JSON.stringify(badRevision), 'utf8');
  assert.throws(() => new MemoryStore(badRevisionPath), /结构无效.*revision/);

  const orphanSectionPath = path.join(directory, 'section.json');
  const orphanStore = new MemoryStore(orphanSectionPath);
  addEntry(orphanStore, 'project-a');
  const orphan = orphanStore.snapshot();
  orphan.spaces[0].sections = ['目标与约束', '决定与依据', '待办备忘'];
  fs.writeFileSync(orphanSectionPath, JSON.stringify(orphan, null, 2), 'utf8');
  assert.throws(() => new MemoryStore(orphanSectionPath), /结构无效.*不存在的栏目/);
});

test('文件路径无效或父目录不存在时明确报错且不创建目录', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'model-desk-memory-'));
  t.after(() => removeTestDirectory(directory));

  assert.throws(() => new MemoryStore(''), /有效的文件路径/);
  assert.throws(() => new MemoryStore('   '), /有效的文件路径/);
  assert.throws(() => new MemoryStore(123), /有效的文件路径/);
  assert.throws(() => new MemoryStore(null), /有效的文件路径/);

  const missingDirectory = path.join(directory, 'not-created');
  assert.throws(() => new MemoryStore(path.join(missingDirectory, 'memory.json')), /写入失败/);
  assert.equal(fs.existsSync(missingDirectory), false, '不应自动创建目录');
});

test('架构建议预览使用同一校验但不改状态或磁盘', (t) => {
  const { store, filePath } = createTempStore(t);
  const before = store.snapshot();
  const diskBefore = fs.readFileSync(filePath, 'utf8');
  const proposal = store.preview({ type: 'updateSpace', spaceId: 'project-a', expectedRevision: before.revision, patch: { name: '仅预览' } });
  assert.equal(proposal.spaces[0].name, '仅预览');
  assert.deepEqual(store.snapshot(), before);
  assert.equal(fs.readFileSync(filePath, 'utf8'), diskBefore);
  assert.throws(() => store.preview({ type: 'updateSpace', spaceId: 'project-a', expectedRevision: before.revision, patch: { sections: '非法类型' } }));
  assert.deepEqual(store.snapshot(), before);
});

test('没有来源的候选不能绕过界面直接发布', (t) => {
  const { store } = createTempStore(t);
  const snapshot = addEntry(store, 'project-a', { source: '' });
  assert.throws(() => store.execute({ type: 'publishEntry', spaceId: 'project-a', entryId: onlyEntry(snapshot, 'project-a').id, expectedRevision: snapshot.revision }), /来源/);
  assert.deepEqual(store.snapshot(), snapshot);
});
