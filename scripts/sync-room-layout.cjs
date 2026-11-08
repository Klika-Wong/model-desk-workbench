/* 把 desktop/assets/rooms/office.js 里的布局写成 office.json 快照。
   运行时只读 js（file:// + CSP connect-src 'none' 读不到 json），
   json 只作为可读数据给外部工具和文档用。改布局后跑一次本脚本。 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'desktop', 'assets', 'rooms', 'office.js');
const OUT = path.join(ROOT, 'desktop', 'assets', 'rooms', 'office.json');

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox);

const layout = sandbox.window.__ROOM_LAYOUT;
if (!layout || !Array.isArray(layout.props)) {
  throw new Error('office.js 没有导出 window.__ROOM_LAYOUT');
}
fs.writeFileSync(OUT, JSON.stringify(layout, null, 2) + '\n');
console.log(`office.json 已同步：${layout.props.length} 件家具，${layout.fallbackSeats.length} 个补位`);
