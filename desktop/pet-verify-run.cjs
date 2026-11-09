// 独立桌宠真机验证入口：node pet-verify-run.cjs
// 与 ui-verify-run.cjs 分开跑，因为后者用桩 preload，不会真的创建桌宠窗口。
const { spawn } = require('node:child_process');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['pet-verify.cjs'], {
  cwd: __dirname, env, windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (c) => { stdout += c; });
child.stderr.on('data', (c) => { stderr += c; });

const timer = setTimeout(() => child.kill(), 70000);
child.on('exit', (code) => {
  clearTimeout(timer);
  const line = stdout.trim().split('\n').filter(Boolean).pop() || '';
  let result = null;
  try { result = JSON.parse(line.replace(/^PET_VERIFY_RESULT\s+/, '')); } catch {}
  if (code === 0 && result && result.ok) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = 0;
    return;
  }
  process.stderr.write(`桌宠真机验证失败（exit ${code}）：${JSON.stringify(result && result.errors) || '无结果'}\n`);
  if (stderr.trim()) process.stderr.write('--- 子进程输出 ---\n' + stderr.slice(-2500) + '\n');
  process.exitCode = 1;
});
