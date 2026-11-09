#!/usr/bin/env node
/* 把仓库 desktop/ 的代码同步到「用户实际在运行」的 Electron 实例。
 *
 * 为什么需要它：仓库 push 到 GitHub 之后，桌面快捷方式指向的是另一份目录。
 * 只改仓库不跑这个脚本，用户重启应用也看不到任何变化。
 *
 *   node scripts/sync-to-runtime.cjs [目标目录]
 *   node scripts/sync-to-runtime.cjs --dry-run [目标目录]
 *
 * 默认目标：E:\多Agent工作台升级规划\desktop-shell-prototype（桌面「模型工作台体验版」快捷方式指向的目录）。
 * 只覆盖仓库里存在的代码/素材，不删除目标独有文件（预览图、README、node_modules 全部保留）。
 * 覆盖前把旧文件备份到目标同级 review-backups/<时间戳>/，行尾统一为 LF。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'desktop');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const targetArg = args.find((a) => !a.startsWith('--'));
const TARGET = path.resolve(targetArg || 'E:/多Agent工作台升级规划/desktop-shell-prototype');

// desktop/ 根目录的 README / 预览图是运行实例自己的产物；assets 里的图片是真素材，要同步。
const ROOT_ONLY_KEEP = /^(?:README\.md|.*\.png|.*\.jpg)$/i;
// 本地诊断脚本、编辑器垃圾文件不进运行实例。
const SKIP_FILE = /^(?:_.*\.cjs|\.DS_Store|Thumbs\.db)$/i;
const SKIP_DIR = /^(?:node_modules|\.git|\.workbuddy|dist|out|\.smoke-result\.json\.workspace)$/i;
const TEXT_EXT = /\.(?:js|cjs|mjs|json|css|html|md|txt|svg|ps1|sh|yml|yaml)$/i;
const TEXT_NAME = /^(?:LICENSE(?:-.*)?|README|NOTICE|CHANGELOG)$/i;
const isText = (name) => TEXT_EXT.test(name) || TEXT_NAME.test(name);

if (!fs.existsSync(path.join(SRC, 'main.cjs'))) {
  console.error('找不到 desktop/main.cjs，脚本必须从仓库根运行。');
  process.exit(1);
}
if (!fs.existsSync(TARGET)) {
  console.error(`目标目录不存在：${TARGET}\n请显式传入路径，例如 node scripts/sync-to-runtime.cjs "D:/xxx/desktop-shell-prototype"`);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const BACKUP = path.join(path.dirname(TARGET), 'review-backups', `sync-${stamp}`);

const changes = [];
function walk(rel = '') {
  const dir = path.join(SRC, rel);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIR.test(entry.name)) continue;
      walk(r);
    } else if (entry.isFile()) {
      if (SKIP_FILE.test(entry.name)) continue;
      if (!rel && ROOT_ONLY_KEEP.test(entry.name)) continue;
      const src = path.join(SRC, r);
      const dst = path.join(TARGET, r);
      let data = fs.readFileSync(src);
      if (isText(entry.name)) data = Buffer.from(data.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
      const exists = fs.existsSync(dst);
      let same = false;
      if (exists) {
        const old = fs.readFileSync(dst);
        // 运行实例可能是 CRLF、仓库是 LF；只因行尾不同就重写全部文件没有意义。
        same = isText(entry.name)
          ? old.toString('utf8').replace(/\r\n/g, '\n') === data.toString('utf8')
          : old.equals(data);
      }
      if (same) continue;
      changes.push({ rel: r, action: exists ? 'update' : 'add', src, dst, data, exists });
    }
  }
}
walk();

if (!changes.length) {
  console.log(`运行实例已是最新（${TARGET}），无需同步。`);
  process.exit(0);
}

if (!dryRun) {
  let backedUp = 0;
  for (const c of changes) {
    if (!c.exists) continue;
    const dst = path.join(BACKUP, c.rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(c.dst, dst);
    backedUp += 1;
  }
  for (const c of changes) {
    fs.mkdirSync(path.dirname(c.dst), { recursive: true });
    fs.writeFileSync(c.dst, c.data);
  }
  console.log(`已备份 ${backedUp} 个旧文件 → ${BACKUP}`);
}

console.log(`${dryRun ? '[dry-run] 将同步' : '已同步'} ${changes.length} 个文件 → ${TARGET}`);
for (const c of changes) console.log(`  ${c.action.padEnd(6)} ${c.rel}`);
console.log('\n提示：应用若正在运行，需要完全退出后重新打开才会加载新代码（关闭窗口不会退出，托盘里选「退出工作台」）。');
