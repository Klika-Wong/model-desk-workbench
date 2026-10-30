// 不连面板的 UI 验证入口：用桩 preload 跑真实窗口，验证页面互斥、项目路径、小窗渲染。
//   node ui-verify-run.cjs
const { spawn } = require('node:child_process');
const path = require('node:path');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['ui-verify.cjs'], {
  cwd: __dirname,
  env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => { stdout += chunk; });
child.stderr.on('data', (chunk) => { stderr += chunk; });

const timer = setTimeout(() => child.kill(), 90000);

child.on('exit', (code) => {
  clearTimeout(timer);
  const line = stdout.trim().split('\n').filter(Boolean).pop() || '';
  let result = null;
  try { result = JSON.parse(line); } catch {}
  if (code === 0 && result && result.ok) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = 0;
    return;
  }
  process.stderr.write(`UI 验证失败（exit ${code}）: ${(result && result.error) || stderr.slice(-1200) || '无输出'}\n`);
  process.exitCode = 1;
});
