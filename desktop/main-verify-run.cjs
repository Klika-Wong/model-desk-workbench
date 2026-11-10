const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const electron = require('electron');

async function main() {
  // 每次跑都用全新的临时 profile：状态干净、不碰用户真实目录，
  // 也不需要对固定目录做递归删除（那会触发删除保护）。
  const profileDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'model-desk-main-verify-'));
  const resultFile = path.join(profileDir, 'result.json');
  const env = {
    ...process.env,
    MODEL_DESK_MAIN_VERIFY: '1',
    MODEL_DESK_MAIN_VERIFY_RESULT: resultFile,
    MODEL_DESK_MAIN_VERIFY_PROFILE: path.join(profileDir, 'userdata'),
  };
  // 不让外部环境把这次启动改成 smoke 或别的分支。
  delete env.MODEL_DESK_SMOKE;
  delete env.MODEL_DESK_SMOKE_RESULT;
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, ['.', '--verify-main'], {
    cwd: __dirname,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  const keepTail = (target, chunk) => {
    target.push(chunk.toString('utf8'));
    while (target.join('').length > 8000) target.shift();
  };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => keepTail(stdout, chunk));
  child.stderr.on('data', (chunk) => keepTail(stderr, chunk));

  let timedOut = false;
  const exit = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 90000);  // 路由里有 15s 等桌宠窗口，再留出退出停服务的时间
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });

  let result;
  try {
    result = JSON.parse(await fs.promises.readFile(resultFile, 'utf8'));
  } catch (error) {
    const details = [...stdout, ...stderr].join('').slice(-4000);
    throw new Error(`真实启动验证没留下可读结果（exit ${exit.code ?? exit.signal}, timedOut=${timedOut}）：${details || error.message}`);
  } finally {
    // 清理只是顺手；临时目录删不掉也不该影响判定结果。
    try { await fs.promises.rm(profileDir, { recursive: true, force: true }); } catch {}
  }

  const checks = Array.isArray(result.checks) ? result.checks : [];
  if (result.ok && checks.length) {
    process.stdout.write(`主进程真实启动路径：${checks.length} 项通过\n`);
    for (const check of checks) process.stdout.write(`  ok  ${check}\n`);
  }
  if (timedOut || exit.code !== 0 || !result.ok) {
    const details = [...stdout, ...stderr].join('').slice(-4000);
    if (checks.length) {
      for (const check of checks) process.stdout.write(`  ok  ${check}\n`);
    }
    throw new Error(`${result.error || `Electron 在 ${result.stage || 'unknown'} 阶段以 ${exit.code ?? exit.signal} 退出。`}${details ? `\n${details}` : ''}`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
