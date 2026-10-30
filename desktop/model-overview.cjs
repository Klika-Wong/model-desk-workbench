'use strict';

// Only public display fields cross IPC. Never forward provider URLs, credentials,
// raw runtime diagnostics or task/project contents to the overview.
const rows = value => Array.isArray(value) ? value.filter(v => v && typeof v === 'object' && !Array.isArray(v)) : [];
const text = (value, limit = 160) => typeof value === 'string' ? value.slice(0, limit) : '';
const percent = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return '';
  const n = Date.parse(value);
  return Number.isFinite(n) ? new Date(n).toISOString() : '';
}
function reset(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '';
  const d = new Date(value * 1000);
  return Number.isFinite(d.getTime()) ? d.toISOString() : '';
}
function normalizeOverview(data = {}) {
  const endpoints = rows(data.execution_endpoints?.rows ?? data.execution_endpoints);
  const engines = {dsh: 'DeepSeek Harness', pi: 'Pi Agent', workbuddy: 'WorkBuddy', zcode: 'ZCode'};
  const models = rows(data.models).filter(m => typeof m.id === 'string' && m.id).map(m => {
    const candidates = endpoints.filter(e => rows(e.models).some(item => item.id === m.id));
    const endpoint = candidates.length === 1 ? candidates[0] : null;
    const check = m.last_check || {};
    return {
      id: text(m.id), name: text(m.name) || text(m.model) || text(m.id),
      local: m.provider === 'local', providerLabel: m.provider === 'local' ? '本地模型' : text(m.provider) || '来源未知',
      executorLabel: endpoint ? text(endpoint.name) || engines[endpoint.id] || '执行端未知' : '执行端未确认',
      enabled: m.enabled !== false && endpoint?.enabled !== false,
      selectionBlocked: Boolean(endpoint && (endpoint.selection_error || endpoint.current_model && endpoint.current_model !== m.id)),
      executorReady: typeof endpoint?.ready === 'boolean' ? endpoint.ready : null,
      checkLabel: check.ok === false ? '上次检查失败' : check.ok === true && check.inference === true && check.kind === 'generation' ? '上次调用成功' : '尚无调用验证',
      checkedAt: date(check.at), capability: text(m.capability_notes, 800),
    };
  });
  const usage = data.codex_usage || {};
  const windows = rows(usage.buckets).flatMap(bucket => rows(bucket.windows).map(w => ({
    label: [text(bucket.name), typeof w.window_minutes === 'number' && w.window_minutes > 0 ? `${w.window_minutes / 60} 小时` : text(w.slot) || '额度窗口'].filter(Boolean).join(' · '),
    remaining: percent(w.remaining_percent), resetLabel: reset(w.resets_at),
  })));
  const stale = usage.stale === true || usage.status === 'error';
  const accounts = [{
    id: 'codex', label: 'Codex / ChatGPT',
    stateLabel: stale && windows.length ? '上次数据 · 待更新' : usage.status === 'error' ? '同步失败 · 额度未知' : usage.status === 'ready' && windows.length ? '账户快照' : '额度未知',
    detail: '账号额度跨项目共享。刷新此页只读取缓存；额度同步和账户配置在高级设置中。',
    updatedAt: date(usage.updated_at), windows,
  }];
  for (const endpoint of endpoints.filter(e => ['workbuddy', 'zcode'].includes(e.id))) {
    accounts.push({id: endpoint.id, label: engines[endpoint.id], stateLabel: '额度未接入',
      detail: '连接状态不代表剩余额度；请在原软件或高级设置查看原生权益。', updatedAt: '', windows: []});
  }
  if (models.some(m => m.local)) accounts.push({id: 'local', label: '本地模型', stateLabel: '不适用云端额度',
    detail: '仍会使用 CPU、GPU 和内存，可在性能监测中查看整机资源。', updatedAt: '', windows: []});
  for (const m of rows(data.models).filter(m => m.provider !== 'local' && !['workbuddy', 'zcode'].includes(m.provider))) {
    const balance = m.billing?.balance || {};
    const balances = rows(balance.balance_infos).flatMap(b => {
      if (!['CNY', 'USD'].includes(b.currency) || !['string', 'number'].includes(typeof b.total_balance) || String(b.total_balance).trim() === '') return [];
      const n = Number(b.total_balance);
      return Number.isFinite(n) && n >= 0 ? [`${b.currency} ${n.toFixed(2)}`] : [];
    });
    accounts.push({id: `model:${text(m.id)}`, label: text(m.name) || text(m.id),
      stateLabel: balances.length ? (balance.stale === true || balance.status !== 'ready' ? '上次余额 · 待更新' : '账户余额快照') : '余额未知',
      detail: balances.length ? `${balances.join(' / ')} · 可能与其他模型共享账户，不合计。` : '未取得可用余额数据；不等于余额为零。',
      updatedAt: date(balance.updated_at), windows: []});
  }
  return {models, accounts};
}
module.exports = {normalizeOverview};
