const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const electron = require('electron');
const resultFile = path.join(__dirname, '.smoke-result.json');

async function main() {
  await fs.promises.rm(resultFile, { force: true });
  await fs.promises.rm(`${resultFile}.memory.json`, { force: true });
  const env = { ...process.env, MODEL_DESK_SMOKE: '1', MODEL_DESK_SMOKE_RESULT: resultFile };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, ['.', '--smoke'], {
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
    }, 30000);
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
    throw new Error(`Electron smoke produced no readable result (exit ${exit.code ?? exit.signal}, timedOut=${timedOut}): ${details || error.message}`);
  } finally {
    await fs.promises.rm(resultFile, { force: true });
    await fs.promises.rm(`${resultFile}.memory.json`, { force: true });
    await fs.promises.rm(`${resultFile}.memory.json.architecture.json`, { force: true });
    await fs.promises.rm(`${resultFile}.chat.json`, { force: true });
  }
  if (timedOut || exit.code !== 0 || !result.ok) {
    const details = [...stdout, ...stderr].join('').slice(-4000);
    throw new Error(`${result.error || `Electron exited with ${exit.code ?? exit.signal} before completion; last stage: ${result.stage || 'unknown'}.`} ${details}`);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
