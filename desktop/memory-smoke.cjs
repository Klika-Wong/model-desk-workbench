const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { MemoryStore } = require('./memory-store.cjs');

module.exports = async function checkMemory(window, filePath, readClipboard) {
  const js = (code) => window.webContents.executeJavaScript(code);
  const wait = async (code) => {
    for (let count = 0; count < 60; count += 1) {
      if (await js(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Memory UI condition timed out: ${code}`);
  };
  const snapshot = async () => (await js('window.workbench.memorySnapshot()')).data;
  const checks = [];
  // 隐藏窗口的合成帧不稳定：先强制重绘再截图，否则会抓到旧帧。
  const capture = async (name) => {
    await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    window.webContents.invalidate();
    await new Promise((resolve) => setTimeout(resolve, 260));
    fs.writeFileSync(path.join(__dirname, name), (await window.webContents.capturePage()).toPNG());
  };
  await wait("document.querySelectorAll('#space-list .space-button').length === 3");
  await js(`document.querySelector('#add-memory').click();
    document.querySelector('#entry-title').value = '恢复项目时先核对当前步骤';
    document.querySelector('#entry-body').value = 'SMOKE-A-PRIVATE：切换到其他项目后，这条记忆仍只属于示例项目 A。';
    document.querySelector('#entry-source').value = '工程测试样本，不是真实个人资料';
    document.querySelector('#entry-form').requestSubmit(); true;`);
  await wait("document.querySelectorAll('#entries .entry-card').length === 1 && !document.querySelector('#entry-dialog').open");
  const state = await snapshot();
  const entry = state.spaces.find((space) => space.id === 'project-a').entries[0];
  assert.equal(entry.status, 'candidate');
  await js(`document.querySelector('[data-space-id="project-b"]').click(); true;`);
  assert.equal(await js("document.querySelector('#entries').textContent.includes('SMOKE-A-PRIVATE')"), false);
  const denied = await js(`window.workbench.memoryExecute(${JSON.stringify({ type: 'updateEntry', spaceId: 'project-b', entryId: entry.id, expectedRevision: state.revision, patch: { body: 'cross-project' } })})`);
  assert.equal(denied.ok, false);
  assert.deepEqual(await snapshot(), state);
  checks.push('memory-ui-space-isolation');
  await js(`document.querySelector('[data-space-id="project-a"]').click();
    [...document.querySelectorAll('#entries button')].find(button => button.textContent === '确认并发布').click(); true;`);
  await wait("document.querySelector('#published-count').textContent === '1'");
  const published = await snapshot();
  assert.equal(published.spaces[0].entries[0].status, 'published');
  assert.deepEqual(new MemoryStore(filePath).snapshot(), published);
  checks.push('memory-ui-publish-and-durable-save');

  const exported = await js("window.workbench.memoryExport('project-a')");
  assert.equal(exported.ok, true);
  assert.equal(exported.data.includes('SMOKE-A-PRIVATE'), false);
  const request = JSON.parse(exported.data);
  const invalid = { ...request, patch: { permissions: 'all' } };
  assert.equal((await js(`window.workbench.memoryPrepare(${JSON.stringify(JSON.stringify(invalid))})`)).ok, false);
  const invalidType = { ...request, patch: { sections: '错误类型' } };
  assert.equal((await js(`window.workbench.memoryPrepare(${JSON.stringify(JSON.stringify(invalidType))})`)).ok, false);
  const anotherProject = await js(`window.workbench.memoryExecute(${JSON.stringify({ type: 'addEntry', spaceId: 'project-b', expectedRevision: published.revision, title: 'B 的项目进度', body: 'SMOKE-B-PRIVATE 只属于 B', section: '当前进度', source: '测试样本' })})`);
  assert.equal(anotherProject.ok, true);
  request.patch.sections.push('复用经验');
  const prepared = await js(`window.workbench.memoryPrepare(${JSON.stringify(JSON.stringify(request))})`);
  assert.equal(prepared.ok, true);
  const applied = await js(`window.workbench.memoryApplyProposal(${JSON.stringify(prepared.data.id)})`);
  assert.equal(applied.ok, true);
  const replay = await js(`window.workbench.memoryApplyProposal(${JSON.stringify(prepared.data.id)})`);
  assert.equal(replay.ok, false);
  const stale = await js(`window.workbench.memoryPrepare(${JSON.stringify(JSON.stringify(request))})`);
  assert.equal(stale.ok, false);
  await js("document.querySelector('#reload-memory').click(); true;");
  await wait("document.querySelectorAll('#architecture .arch-node').length === 5");
  checks.push('architecture-proposal-scope-version-single-use');
  checks.push('architecture-export-excludes-memory-body');
  checks.push('architecture-unrelated-project-edit-does-not-invalidate');

  await js(`document.querySelector('#configure-space').click();
    document.querySelector('#space-capacity').value = '15000';
    document.querySelector('#space-form').requestSubmit(); true;`);
  await wait("!document.querySelector('#space-dialog').open");
  assert.equal((await snapshot()).spaces[0].capacityChars, 15000);
  await js(`document.querySelector('#configure-space').click();
    document.querySelector('#space-sections').value = '只剩一个空栏目';
    document.querySelector('#space-form').requestSubmit(); true;`);
  await wait("document.querySelector('#space-error').textContent.includes('仍有')");
  await js("document.querySelector('#space-dialog').close(); true;");
  checks.push('memory-ui-architecture-form-and-used-section-guard');

  await js("document.querySelector('#open-proposal').click(); true;");
  await wait("document.querySelector('#proposal-dialog').open");
  assert.equal(await js("document.querySelector('#apply-proposal').disabled"), true);
  await js(`const suggestion = JSON.parse(document.querySelector('#architecture-export').value);
    suggestion.patch.contextChars = 2500;
    document.querySelector('#proposal-input').value = JSON.stringify(suggestion);
    document.querySelector('#preview-proposal').click(); true;`);
  await wait("!document.querySelector('#apply-proposal').disabled");
  await js("document.querySelector('#proposal-input').dispatchEvent(new Event('input', { bubbles: true })); true;");
  assert.equal(await js("document.querySelector('#apply-proposal').disabled"), true);
  await js("document.querySelector('#preview-proposal').click(); true;");
  await wait("!document.querySelector('#apply-proposal').disabled");
  await js("document.querySelector('#apply-proposal').click(); true;");
  await wait("!document.querySelector('#proposal-dialog').open");
  assert.equal((await snapshot()).spaces[0].contextChars, 2500);
  checks.push('architecture-proposal-real-dialog-flow');

  await js(`document.querySelector('#add-memory').click();
    document.querySelector('#entry-title').value = '尚待核实';
    document.querySelector('#entry-body').value = '需要补充来源的候选。';
    document.querySelector('#entry-form').requestSubmit(); true;`);
  await wait("!document.querySelector('#entry-dialog').open && document.querySelector('#candidate-count').textContent === '1'");
  await js("[...document.querySelectorAll('#entries button')].find(button => button.textContent === '确认并发布').click(); true;");
  await wait("document.querySelector('#memory-message').textContent.includes('来源')");
  assert.equal((await snapshot()).spaces[0].entries[1].status, 'candidate');
  await js("document.querySelector('#entries .entry-card button').click(); document.querySelector('#entry-body').value += ' 更新说明。'; document.querySelector('#entry-form').requestSubmit(); true;");
  await wait("!document.querySelector('#entry-dialog').open && document.querySelector('#published-count').textContent === '0'");
  await js("[...document.querySelectorAll('#entries .entry-card:first-child button')].find(button => button.textContent === '确认并发布').click(); true;");
  await wait("document.querySelector('#published-count').textContent === '1'");
  await js("[...document.querySelectorAll('#entries .entry-card:last-child button')].find(button => button.textContent === '撤回').click(); true;");
  assert.equal(await js("document.querySelector('#retract-dialog').open"), true);
  assert.equal((await snapshot()).spaces[0].entries[1].status, 'candidate');
  await js("document.querySelector('#confirm-retract').click(); true;");
  await wait("document.querySelector('#retract-error').textContent.includes('撤回原因')");
  assert.equal(await js("document.querySelector('#retract-dialog').open"), true);
  await js("document.querySelector('#retract-reason').value = '冒烟：来源失效'; document.querySelector('#confirm-retract').click(); true;");
  await wait("!document.querySelector('#retract-dialog').open");
  const audited = (await snapshot()).spaces[0].entries[1];
  assert.equal(audited.status, 'retracted');
  assert.equal(audited.retractReason, '冒烟：来源失效');
  assert.ok(audited.retractedAt);
  await js("document.querySelector('#status-filter').value='retracted'; document.querySelector('#status-filter').dispatchEvent(new Event('change')); true;");
  assert.equal(await js("document.querySelector('#entries').textContent.includes('复制为新候选')"), true);
  assert.equal(await js("document.querySelector('#entries').textContent.includes('撤回原因：冒烟：来源失效')"), true);
  await js("document.querySelector('#status-filter').value='active'; document.querySelector('#status-filter').dispatchEvent(new Event('change')); true;");
  checks.push('memory-ui-source-edit-and-retraction-lifecycle');
  checks.push('memory-retraction-audit');

  await js("document.querySelector('#open-packet').click(); document.querySelector('#packet-query').value='SMOKE-A'; document.querySelector('#build-packet').click(); true;");
  await wait("document.querySelector('#packet-consent').disabled === false");
  // Separate external-send permission: copying stays blocked until consent is granted.
  assert.equal(await js("document.querySelector('#copy-packet').disabled"), true);
  const context = await js("document.querySelector('#packet-preview').value");
  assert.equal(context.includes('SMOKE-A-PRIVATE'), true);
  assert.equal(context.includes('SMOKE-B-PRIVATE'), false);
  assert.equal(context.includes('需要补充来源的候选'), false);
  assert.ok([...context].length <= 2500);
  // CTX-03：注入清单必须列清楚收录了哪几条、各自字符数与来源。
  assert.equal(await js("document.querySelector('#packet-manifest').hidden"), false, '应显示注入清单');
  const manifest = await js(`(()=>{const rows=[...document.querySelectorAll('#packet-manifest .pm-row')];
    return {rows:rows.length, ids:rows.map(r=>r.querySelector('.pm-meta').textContent.includes('ID ')), sources:rows.map(r=>r.querySelector('.pm-meta').textContent.includes('来源：')), head:document.querySelector('#packet-manifest .pm-head').textContent};})()`);
  assert.ok(manifest.rows >= 1, '注入清单至少一行');
  assert.equal(manifest.ids.every(Boolean), true, '每行都要有记忆 ID');
  assert.equal(manifest.sources.every(Boolean), true, '每行都要有来源');
  assert.match(manifest.head, /命中/);
  checks.push('memory-packet-manifest');
  await capture('packet-manifest-preview.png');
  checks.push('memory-external-send-consent-gate');
  await js("document.querySelector('#packet-consent').click(); true;");
  assert.equal(await js("document.querySelector('#copy-packet').disabled"), false);
  await js("document.querySelector('#copy-packet').click(); true;");
  await wait("document.querySelector('#packet-error').textContent.includes('已授权')");
  assert.equal(readClipboard(), context);
  await js("document.querySelector('#packet-dialog').close(); true;");
  checks.push('memory-ui-retrieve-preview-and-copy-scoped-context');

  await js(`document.querySelector('#new-space').click();
    document.querySelector('#space-form-name').value = '专用空间体验';
    document.querySelector('#space-form-kind').value = 'special';
    document.querySelector('#space-form').requestSubmit(); true;`);
  await wait("document.querySelector('#space-name').textContent === '专用空间体验'");
  const created = await snapshot();
  assert.equal(created.spaces.at(-1).kind, 'special');
  assert.equal(created.spaces.at(-1).entries.length, 0);
  checks.push('memory-ui-create-custom-space');
  await js("document.querySelector('[data-space-id=\"project-a\"]').click(); true;");
  await wait("document.querySelector('#space-name').textContent === '示例项目 A'");

  // ---- 批量发布 / 批量撤回（共用一次审计原因） ----
  for (const [title, body] of [['批量候选一', 'BATCH-ONE'], ['批量候选二', 'BATCH-TWO']]) {
    await js(`document.querySelector('#add-memory').click();
      document.querySelector('#entry-title').value = ${JSON.stringify(title)};
      document.querySelector('#entry-body').value = ${JSON.stringify(body)};
      document.querySelector('#entry-source').value = '批量测试来源';
      document.querySelector('#entry-form').requestSubmit(); true;`);
    await wait("!document.querySelector('#entry-dialog').open");
  }
  const batchIds = (await snapshot()).spaces.find((space) => space.id === 'project-a').entries
    .filter((entry) => ['批量候选一', '批量候选二'].includes(entry.title)).map((entry) => entry.id);
  assert.equal(batchIds.length, 2, '应新增两条候选');
  const tick = async (id) => js(`(()=>{const box=document.querySelector('[data-entry-check="${id}"]');box.click();return box.checked;})()`);
  for (const id of batchIds) assert.equal(await tick(id), true);
  assert.equal(await js("document.querySelector('#batch-count').textContent"), '已选 2 条');
  assert.equal(await js("document.querySelector('#batch-bar').hidden"), false);
  await js("document.querySelector('#batch-bar').scrollIntoView({block:'center'}); true;");
  await capture('batch-bar-preview.png');
  await js("document.querySelector('#batch-publish').click(); true;");
  await wait("window.__memoryUi.entries().filter(e=>['批量候选一','批量候选二'].includes(e.title)).every(e=>e.status==='published')");
  checks.push('memory-batch-publish');

  for (const id of batchIds) await tick(id);
  await js("document.querySelector('#batch-retract').click(); true;");
  await wait("document.querySelector('#retract-dialog').open");
  assert.equal(await js("document.querySelector('#retract-title').textContent.includes('将撤回 2 条')"), true);
  await js(`document.querySelector('#retract-reason').value = '批量整理：测试淘汰';
    document.querySelector('#confirm-retract').click(); true;`);
  await wait("window.__memoryUi.entries().filter(e=>['批量候选一','批量候选二'].includes(e.title)).every(e=>e.status==='retracted')");
  const afterBatch = (await snapshot()).spaces.find((space) => space.id === 'project-a').entries.filter((entry) => batchIds.includes(entry.id));
  assert.equal(afterBatch.every((entry) => entry.retractReason === '批量整理：测试淘汰'), true, '批量撤回应共用同一审计原因');
  assert.equal(await js("document.querySelector('#batch-bar').hidden"), true, '批量完成后应清空选择');
  checks.push('memory-batch-retract-with-audit');

  // ---- 命令面板与快捷键总览 ----
  await js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',code:'KeyK',ctrlKey:true,bubbles:true})); true;");
  assert.equal(await js("document.querySelector('#palette').hidden"), false, 'Ctrl+K 应打开命令面板');
  await js(`(()=>{const input=document.querySelector('#palette-input');input.value='示例项目 B';input.dispatchEvent(new Event('input'));return true;})()`);
  await capture('palette-preview.png');
  await js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true})); true;");
  await wait("document.querySelector('#space-name').textContent === '示例项目 B'");
  assert.equal(await js("document.querySelector('#palette').hidden"), true, '执行后面板应关闭');
  checks.push('command-palette-navigate');

  // ---- 最近使用 ----
  await js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',code:'KeyK',ctrlKey:true,bubbles:true})); true;");
  assert.equal(await js("document.querySelector('#palette-list li').textContent"), '最近使用', '空查询时首组应为「最近使用」');
  assert.equal(await js("document.querySelector('#palette-list li[role=option]').dataset.key"), 'space|project-b', '最近使用应记录刚执行的那一项');
  await js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true})); true;");
  checks.push('command-palette-recent');

  // ---- 跨空间全文命中（正文，不是标题） ----
  await js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',code:'KeyK',ctrlKey:true,bubbles:true})); true;");
  await js(`(()=>{const i=document.querySelector('#palette-input');i.value='smoke-a-priv';i.dispatchEvent(new Event('input'));return true;})()`);
  assert.equal(await js("[...document.querySelectorAll('#palette-list li.palette-group')].some(el=>el.textContent==='全文命中')"), true, '正文命中应单独分组');
  assert.equal(await js("document.querySelector('#palette-list li[role=option]').dataset.key.startsWith('hit|')"), true, '正文命中应排在首位');
  await capture('palette-fulltext-preview.png');
  await js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true})); true;");
  await wait("document.querySelector('#space-name').textContent === '示例项目 A'");
  checks.push('command-palette-fulltext-cross-space');

  // ---- 多词 AND + 命中高亮 ----
  await js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',code:'KeyK',ctrlKey:true,bubbles:true})); true;");
  await js(`(()=>{const i=document.querySelector('#palette-input');i.value='smoke private';i.dispatchEvent(new Event('input'));return true;})()`);
  assert.equal(await js("[...document.querySelectorAll('#palette-list li.palette-group')].some(el=>el.textContent==='全文命中')"), true, '多词应同时命中同一条记忆');
  assert.ok((await js("document.querySelectorAll('#palette-list mark.palette-mark').length")) >= 2, '命中的词应高亮');
  await capture('palette-highlight-preview.png');
  await js(`(()=>{const i=document.querySelector('#palette-input');i.value='smoke zzzz';i.dispatchEvent(new Event('input'));return true;})()`);
  assert.equal(await js("[...document.querySelectorAll('#palette-list li.palette-group')].some(el=>el.textContent==='全文命中')"), false, '缺一个词就不该命中');
  await js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true})); true;");
  checks.push('command-palette-multiterm-and-highlight');

  await js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'/',code:'Slash',ctrlKey:true,bubbles:true})); true;");
  await wait("document.querySelector('#shortcuts-dialog').open");
  assert.ok((await js("document.querySelectorAll('#shortcuts-body .shortcut-row').length")) >= 10, '快捷键总览应列出全部快捷键');
  await js("document.querySelector('#close-shortcuts').click(); true;");
  checks.push('shortcuts-overview');

  // ---- 列表密度 ----
  await js("(()=>{const s=document.querySelector('#density-select');s.value='compact';s.dispatchEvent(new Event('change'));return true;})()");
  assert.equal(await js("document.body.dataset.density"), 'compact');
  await js("(()=>{const s=document.querySelector('#density-select');s.value='normal';s.dispatchEvent(new Event('change'));return true;})()");
  assert.equal(await js("document.body.dataset.density"), 'normal');
  checks.push('memory-list-density');

  await js("document.querySelector('[data-space-id=\"project-a\"]').click(); true;");
  await wait("document.querySelector('#space-name').textContent === '示例项目 A'");
  await window.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
  await js('window.scrollTo(0, 0); true;');
  await capture('memory-preview.png');
  return checks;
};
