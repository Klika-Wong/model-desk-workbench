'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPacket } = require('./memory-retrieval.cjs');

const SECTIONS = ['目标与约束', '当前进度', '决定与依据', '待办备忘'];
const WHEN = '2026-01-01T00:00:00.000Z';

function entry(overrides = {}) {
  return {
    id: 'entry-1',
    title: '示例标题',
    body: '示例正文。',
    section: '当前进度',
    source: '手工录入',
    status: 'published',
    version: 1,
    createdAt: WHEN,
    updatedAt: WHEN,
    ...overrides,
  };
}

function space(id, name, entries, contextChars = 2000) {
  return {
    id,
    name,
    kind: id === 'shared' ? 'shared' : 'project',
    capacityChars: 12000,
    contextChars,
    sections: [...SECTIONS],
    entries,
  };
}

function snapshot(spaces, revision = 6) {
  return { revision, spaces };
}

function packet(snap, spaceId, query, budgetChars = 1200) {
  return buildPacket(snap, { spaceId, query, budgetChars });
}

function codePointLength(text) {
  return [...text].length;
}

test('A/B 两个空间使用同一关键词时互不混入', () => {
  const snap = snapshot([
    space('project-a', '示例项目 A', [
      entry({ id: 'a-1', title: '部署约束', body: '部署前必须确认回滚方案。', source: 'docs/a.md' }),
    ]),
    space('project-b', '示例项目 B', [
      entry({ id: 'b-1', title: '部署约束', body: '部署前必须确认回滚方案。', source: 'docs/b.md' }),
    ]),
    space('shared', '本机公共池', [
      entry({ id: 's-1', title: '部署约束', body: '部署前必须确认回滚方案。', source: 'shared-note' }),
    ]),
  ]);

  const result = packet(snap, 'project-a', '部署');

  assert.equal(result.spaceId, 'project-a');
  assert.equal(result.spaceName, '示例项目 A');
  assert.equal(result.revision, 6);
  assert.equal(result.method, 'local-lexical');
  assert.deepEqual(result.items.map((item) => item.id), ['a-1']);
  assert.match(result.text, /docs\/a\.md/);
  assert.doesNotMatch(result.text, /b-1|docs\/b\.md|示例项目 B|s-1|shared-note|本机公共池/);
});

test('候选与已撤回条目不参与检索', () => {
  const snap = snapshot([
    space('project-a', '示例项目 A', [
      entry({ id: 'cand-1', title: '回滚草案', body: '灰度回滚记录。', status: 'candidate' }),
      entry({ id: 'retr-1', title: '回滚旧版', body: '灰度回滚记录。', status: 'retracted' }),
      entry({ id: 'pub-1', title: '发布记录', body: '常规发布记录。' }),
    ]),
  ]);

  const result = packet(snap, 'project-a', '回滚');

  assert.deepEqual(result.items, []);
  assert.equal(result.truncated, false);
  assert.match(result.text, /未找到匹配/);
  assert.doesNotMatch(result.text, /cand-1|retr-1/);
});

test('本机共享池不会自动混入项目空间', () => {
  const snap = snapshot([
    space('project-a', '示例项目 A', [
      entry({ id: 'a-1', title: '发布记录', body: '本周完成发布。' }),
    ]),
    space('shared', '本机公共池', [
      entry({ id: 's-1', title: '共享约定', body: '共享池标记词只属于公共池。' }),
    ]),
  ]);

  const result = packet(snap, 'project-a', '标记词');

  assert.deepEqual(result.items, []);
  assert.match(result.text, /未找到匹配/);
  assert.doesNotMatch(result.text, /s-1|共享池标记词|本机公共池|共享约定/);
});

test('中文关键词与短语可以命中，且只返回命中的片段', () => {
  const snap = snapshot([
    space('project-a', '示例项目 A', [
      entry({
        id: 'zh-1',
        title: '上下文预算规则',
        body: '上下文预算按 Unicode 字符计算，不能只截正文。发布前需要检查预算。',
        source: 'docs/zh.md',
      }),
      entry({ id: 'zh-2', title: '无关条目', body: '这里只记录界面颜色。' }),
    ]),
  ]);

  const keyword = packet(snap, 'project-a', '上下文预算');
  assert.deepEqual(keyword.items.map((item) => item.id), ['zh-1']);
  assert.match(keyword.items[0].excerpt, /上下文预算/);

  const phrase = packet(snap, 'project-a', '发布 预算');
  assert.deepEqual(phrase.items.map((item) => item.id), ['zh-1']);
  assert.doesNotMatch(phrase.text, /界面颜色/);
});

test('英文关键词大小写不敏感', () => {
  const snap = snapshot([
    space('project-a', '示例项目 A', [
      entry({
        id: 'en-1',
        title: 'Release checklist',
        body: 'The Rollback plan must be reviewed before every deploy.',
      }),
    ]),
  ]);

  const result = packet(snap, 'project-a', 'ROLLBACK PLAN');

  assert.deepEqual(result.items.map((item) => item.id), ['en-1']);
  assert.match(result.text, /Rollback plan/);
});

test('空查询返回全部已发布条目，排序确定且不含候选/撤回', () => {
  const snap = snapshot([
    space('project-a', '示例项目 A', [
      entry({ id: 'pub-2', title: '第二条', body: '正文二。' }),
      entry({ id: 'cand-1', title: '候选', body: '候选正文。', status: 'candidate' }),
      entry({ id: 'pub-1', title: '第一条', body: '正文一。' }),
      entry({ id: 'retr-1', title: '撤回', body: '撤回正文。', status: 'retracted' }),
    ]),
  ]);

  const first = packet(snap, 'project-a', '');
  const second = packet(snap, 'project-a', '');

  assert.deepEqual(first.items.map((item) => item.id), ['pub-1', 'pub-2']);
  assert.equal(first.truncated, false);
  assert.doesNotMatch(first.text, /cand-1|retr-1|候选正文|撤回正文/);
  assert.deepEqual(first, second);
});

test('排序可说明：标题命中优先，同分按 ID 稳定', () => {
  const snap = snapshot([
    space('project-a', '示例项目 A', [
      entry({ id: 'body-hit', title: '说明', body: 'alpha 出现在正文。' }),
      entry({ id: 'title-hit', title: 'alpha 约定', body: '这里没有关键词。' }),
      entry({ id: 'tie-b', title: 'alpha 乙', body: '正文。' }),
      entry({ id: 'tie-a', title: 'alpha 甲', body: '正文。' }),
    ]),
  ]);

  const result = packet(snap, 'project-a', 'alpha');

  assert.notEqual(result.items[0].id, 'body-hit');
  assert.ok(
    result.items.findIndex((item) => item.id === 'title-hit')
      < result.items.findIndex((item) => item.id === 'body-hit'),
    '标题命中应排在正文命中之前',
  );
  const tieIds = result.items.filter((item) => item.id.startsWith('tie-')).map((item) => item.id);
  assert.deepEqual(tieIds, ['tie-a', 'tie-b']);
  assert.deepEqual(result, packet(snap, 'project-a', 'alpha'));
});

test('无匹配时给出明确空结果，不伪造摘要', () => {
  const snap = snapshot([
    space('project-a', '示例项目 A', [entry({ id: 'a-1', body: '普通正文。' })]),
  ]);

  const result = packet(snap, 'project-a', '量子纠缠');

  assert.deepEqual(result.items, []);
  assert.equal(result.truncated, false);
  assert.match(result.text, /未找到匹配的已发布记忆片段/);
  assert.match(result.text, /未生成摘要或推测内容/);
  assert.doesNotMatch(result.text, /量子纠缠/);
});

test('每个片段保留记忆 ID、版本与来源，空来源明确标为未填', () => {
  const snap = snapshot([
    space('project-a', '示例项目 A', [
      entry({ id: 'no-source', title: '无来源', body: '正文甲。', source: '', version: 3 }),
      entry({ id: 'has-source', title: '有来源', body: '正文乙。', source: 'docs/adr-7.md', version: 2 }),
    ]),
  ]);

  const result = packet(snap, 'project-a', '');

  assert.equal(result.items.length, 2);
  const emptySourceItem = result.items.find((item) => item.id === 'no-source');
  assert.equal(emptySourceItem.source, '');
  assert.match(result.text, /记忆 ID：no-source｜版本：v3｜来源：未填/);
  assert.match(result.text, /记忆 ID：has-source｜版本：v2｜来源：docs\/adr-7\.md/);
});

test('Unicode 预算包含标题、来源与包装开销且不超上限', () => {
  const body = `发布检查。${'🧠'.repeat(80)}${'回滚方案必须完整。'.repeat(20)}`;
  const snap = snapshot([
    space('project-a', '示例项目 A', [
      entry({ id: 'emoji-1', title: '回滚预算', body, source: 'docs/emoji.md' }),
    ]),
  ]);

  const result = packet(snap, 'project-a', '回滚', 360);

  assert.equal(result.budgetChars, 360);
  assert.equal(result.usedChars, codePointLength(result.text));
  assert.ok(codePointLength(result.text) <= 360, `实际 ${result.usedChars} 字符超过预算`);
  assert.equal(result.truncated, true);
  assert.equal(result.items.length, 1);
  assert.ok(result.items[0].excerpt !== body, '超长正文应被截取');
  assert.ok(codePointLength(result.items[0].excerpt) <= codePointLength(body));
  assert.ok(result.text.includes(result.items[0].excerpt));
  assert.match(result.text, /记忆 ID：emoji-1｜版本：v1｜来源：docs\/emoji\.md/);
  assert.doesNotMatch(result.text, /undefined/);
});

test('实际预算收敛到空间 contextChars', () => {
  const snap = snapshot([
    space('project-a', '示例项目 A', [
      entry({ id: 'a-1', title: '预算收敛', body: '预算收敛测试正文。' }),
    ], 260),
  ]);

  const result = packet(snap, 'project-a', '预算', 20000);

  assert.equal(result.budgetChars, 260);
  assert.ok(codePointLength(result.text) <= 260);
  assert.equal(result.usedChars, codePointLength(result.text));
  assert.ok(result.items.length >= 1);
});

test('预算放不下任何完整出处片段时返回清楚的不足提示', () => {
  const snap = snapshot([
    space('project-a', '示例项目 A', [
      entry({
        id: 'long-1',
        title: '长条目',
        body: '回滚方案。'.repeat(80),
        source: 'docs/long.md',
      }),
    ]),
  ]);

  const result = packet(snap, 'project-a', '回滚', 100);

  assert.deepEqual(result.items, []);
  assert.equal(result.truncated, true);
  assert.match(result.text, /预算不足|不足以容纳/);
  assert.ok(codePointLength(result.text) <= 100);
  assert.equal(result.usedChars, codePointLength(result.text));
});

test('最多返回 10 条命中', () => {
  const entries = Array.from({ length: 12 }, (_, index) => entry({
    id: `m-${String(index + 1).padStart(2, '0')}`,
    title: `alpha ${index + 1}`,
    body: 'alpha 正文。',
  }));
  const snap = snapshot([space('project-a', '示例项目 A', entries, 20000)]);

  const result = packet(snap, 'project-a', 'alpha', 20000);

  assert.equal(result.items.length, 10);
  assert.equal(result.truncated, true);
  assert.ok(codePointLength(result.text) <= 20000);
});

test('buildPacket 不修改输入 snapshot', () => {
  const snap = snapshot([
    space('project-a', '示例项目 A', [
      entry({ id: 'b-1', title: '乙', body: '回滚乙。' }),
      entry({ id: 'a-1', title: '甲', body: '回滚甲。' }),
    ]),
  ]);
  const before = structuredClone(snap);
  const serialized = JSON.stringify(snap);

  packet(snap, 'project-a', '回滚');
  packet(snap, 'project-a', '');

  assert.deepEqual(snap, before);
  assert.equal(JSON.stringify(snap), serialized);
});

test('拒绝无效的预算、空间、查询与快照输入', () => {
  const snap = snapshot([
    space('project-a', '示例项目 A', [entry({ id: 'a-1' })]),
  ]);
  const build = (overrides = {}, nextSnapshot = snap) => () => buildPacket(nextSnapshot, {
    spaceId: 'project-a',
    query: '部署',
    budgetChars: 500,
    ...overrides,
  });

  for (const budgetChars of [99, 20001, 100.5, '500']) {
    assert.throws(build({ budgetChars }), /budgetChars/);
  }
  assert.throws(build({ spaceId: 'missing' }), /未找到空间/);
  assert.throws(build({ spaceId: 'Project-A' }), /未找到空间/);
  assert.throws(build({ spaceId: 'project-a ' }), /未找到空间/);
  assert.throws(build({ query: 123 }), /query/);
  assert.throws(build({ query: '字'.repeat(201) }), /200/);
  assert.throws(() => buildPacket(snap, null), /检索参数/);
  assert.throws(() => buildPacket(null, { spaceId: 'project-a', query: '', budgetChars: 500 }), /快照/);
  assert.throws(
    () => buildPacket({ revision: -1, spaces: [] }, { spaceId: 'project-a', query: '', budgetChars: 500 }),
    /revision/,
  );
  assert.throws(
    () => buildPacket({ revision: 0, spaces: 'x' }, { spaceId: 'project-a', query: '', budgetChars: 500 }),
    /spaces/,
  );
  assert.throws(
    () => buildPacket(snapshot([space('project-a', '示例项目 A', [], 50)]), {
      spaceId: 'project-a', query: '', budgetChars: 500,
    }),
    /contextChars/,
  );
});

test('query 恰好 200 个字符可以接受', () => {
  const snap = snapshot([
    space('project-a', '示例项目 A', [entry({ id: 'a-1' })]),
  ]);

  const result = packet(snap, 'project-a', 'a'.repeat(200));

  assert.deepEqual(result.items, []);
  assert.match(result.text, /未找到匹配/);
});

 test('标点查询不被当成全量读取', () => {
   const result = packet(snapshot([space('a','A',[entry()])]),'a','!!!');
   assert.equal(result.items.length,0); assert.match(result.text,/未找到/);
 });
 test('损坏条目返回可读错误', () => {
   assert.throws(()=>packet(snapshot([space('a','A',[null])]),'a',''),/记忆条目必须是对象/);
 });

test('上下文包报告命中数、裁剪数与每条字符，供注入清单展示', () => {
  const longBody = '项目进度说明。'.repeat(40);
  const entries = [
    entry({ id: 'e-1', title: '进度一', body: longBody }),
    entry({ id: 'e-2', title: '进度二', body: longBody }),
    entry({ id: 'e-3', title: '进度三', body: longBody }),
    entry({ id: 'e-4', title: '进度四', body: longBody }),
  ];
  const result = buildPacket(snapshot([space('project-a', '示例项目 A', entries, 200)]), {
    spaceId: 'project-a', query: '进度', budgetChars: 200,
  });
  assert.equal(result.matched, 4, '四条都已发布且都命中');
  assert.ok(result.items.length >= 1, '预算内至少收录一条');
  assert.ok(result.items.length < result.matched, '预算不足必然裁掉一部分');
  assert.equal(result.dropped, result.matched - result.items.length);
  assert.equal(result.truncated, true);
  for (const item of result.items) {
    assert.equal(typeof item.excerptChars, 'number');
    assert.ok(item.excerptChars > 0 && item.excerptChars <= item.excerpt.length);
  }
  const total = result.items.reduce((sum, item) => sum + item.excerptChars, 0);
  assert.ok(total > 0);
});
