'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {normalizeOverview} = require('./model-overview.cjs');

test('quota zero is distinct from missing, strings and invalid values', () => {
  const values = [0, 100, null, undefined, '0', NaN, Infinity, -1, 101, false];
  const result = normalizeOverview({codex_usage: {status: 'ready', buckets: [{windows: values.map(remaining_percent => ({remaining_percent}))}]}});
  assert.deepEqual(result.accounts[0].windows.map(w => w.remaining), [0, 100, null, null, null, null, null, null, null, null]);
});
test('stale quota keeps measured values and labels them as previous data', () => {
  const result = normalizeOverview({codex_usage: {status: 'error', stale: true, updated_at: '2026-10-30T00:00:00Z', buckets: [{windows: [{remaining_percent: 23, resets_at: 1800000000}]}]}});
  assert.match(result.accounts[0].stateLabel, /上次数据/);
  assert.equal(result.accounts[0].windows[0].remaining, 23);
  assert.match(result.accounts[0].windows[0].resetLabel, /^2027-/);
});
test('failed quota sync without cached windows is explicitly an error, not zero', () => {
  const account = normalizeOverview({codex_usage:{status:'error'}}).accounts[0];
  assert.equal(account.stateLabel, '同步失败 · 额度未知');
  assert.deepEqual(account.windows, []);
});
test('overview only returns allowlisted public fields; no runtime, URL, project or credential passthrough', () => {
  const result = normalizeOverview({secret: 'sensitive-fixture', tasks: [{title: 'private-project-fixture'}], models: [{id: 'local', name: '<script>alert(1)</script>', provider: 'local', secret: 'sensitive-fixture', api_base: 'private-url-fixture', capability_notes: '分类'}],
    execution_endpoints: {rows: [{id: 'dsh', name: 'DSH', ready: true, models: [{id: 'local'}], runtime: {secret: 'sensitive-fixture'}}]}});
  assert.equal(result.models[0].executorReady, true);
  assert.equal(result.models[0].name, '<script>alert(1)</script>'); // Rendered via textContent, not HTML.
  assert.doesNotMatch(JSON.stringify(result), /sensitive-fixture|private-project-fixture|private-url-fixture|api_base|runtime/);
});
test('ambiguous execution identity stays unknown; reachability is not generation', () => {
  const result = normalizeOverview({models: [{id: 'm', last_check: {ok: true, kind: 'reachability', inference: false}}],
    execution_endpoints: {rows: ['pi', 'dsh'].map(id => ({id, ready: true, models: [{id: 'm'}]}))}});
  assert.equal(result.models[0].executorReady, null);
  assert.equal(result.models[0].checkLabel, '尚无调用验证');
});
test('only successful generation yields previous-call success, never running', () => {
  const result = normalizeOverview({models: [{id: 'm', last_check: {ok: true, kind: 'generation', inference: true, at: '2026-10-30T00:00:00Z'}}]});
  assert.equal(result.models[0].checkLabel, '上次调用成功');
  assert.doesNotMatch(JSON.stringify(result), /正在执行|运行中/);
});
test('another model pinned to execution endpoint requires an explicit configuration change', () => {
  const result = normalizeOverview({models: [{id:'a'}, {id:'b'}], execution_endpoints: {rows:[{id:'dsh', ready:true, current_model:'b', models:[{id:'a'}, {id:'b'}]}]}});
  assert.equal(result.models[0].selectionBlocked, true);
  assert.equal(result.models[1].selectionBlocked, false);
});
test('local resource cost and native quota are explicit; malformed rows tolerated', () => {
  const result = normalizeOverview({models: [null, [], 5, {id: 'local', provider: 'local'}], execution_endpoints: {rows: [null, {id: 'workbuddy'}]}});
  assert.equal(result.models.length, 1);
  assert.match(result.accounts.find(a => a.id === 'local').detail, /CPU、GPU/);
  assert.equal(result.accounts.find(a => a.id === 'workbuddy').stateLabel, '额度未接入');
  assert.equal(normalizeOverview({models: {}}).models.length, 0);
});
test('cash zero is preserved; null, booleans and empty string never become a zero balance', () => {
  for (const value of [null, false, '', '   ']) {
    const result = normalizeOverview({models: [{id: 'api', billing: {balance: {balance_infos: [{currency: 'CNY', total_balance: value}]}}}]});
    assert.equal(result.accounts.find(a => a.id === 'model:api').stateLabel, '余额未知');
  }
  const result = normalizeOverview({models: [{id: 'api', billing: {balance: {status: 'ready', balance_infos: [{currency: 'CNY', total_balance: '0'}]}}}]});
  assert.match(result.accounts.find(a => a.id === 'model:api').detail, /CNY 0.00/);
});
