/* 独立桌宠窗口的真机验证（Electron 主进程脚本）。
   背景：ui-verify.cjs 用的是桩 preload，petOpen 永远返回 {ok:true} 却不建窗口，
   所以「点了悬浮到桌面到底有没有窗口」一直没有真机覆盖。这个文件补上这条链：
   主窗口真实点击 → pet:open 建窗 → 窗口像素 / 形象库 / 右键菜单 / 关闭。
   由 pet-verify-run.cjs 以 Electron 入口脚本启动，不参与 ui-verify 的桩环境。 */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

const result = { ok: false, checks: [], errors: [] };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const trace = (s) => process.stderr.write('[pet-verify] ' + s + '\n');
const check = (name, pass, detail) => {
  result.checks.push(name);
  if (!pass) result.errors.push(`${name}: ${JSON.stringify(detail)}`);
};

function finish() {
  result.ok = result.errors.length === 0;
  process.stdout.write('\nPET_VERIFY_RESULT ' + JSON.stringify(result) + '\n');
  setTimeout(() => app.exit(result.ok ? 0 : 1), 50);
}

app.whenReady().then(async () => {
  let petWin = null;
  try {
    // 独立 userData，避免验证过程改写用户真实的桌宠位置与形象。
    app.setPath('userData', path.join(app.getPath('appData'), 'ModelDesk-Pet-Verify'));
    trace('registerPetWindow');
    const ctl = require('./pet-window.cjs').registerPetWindow(app.getPath('userData'));

    const main = new BrowserWindow({
      show: false, width: 1200, height: 800,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
      },
    });
    // 验证环境没有注册主窗口的业务 IPC，这些「No handler」不是桌宠缺陷。
    main.webContents.on('console-message', (_e, level, msg) => {
      if (level >= 2 && !/No handler registered|Security Warning/.test(msg)) {
        result.errors.push('main console: ' + msg.slice(0, 200));
      }
    });
    await main.loadFile(path.join(__dirname, 'index.html'));
    trace('main loaded');

    trace('query preload api');
    const apiType = await main.webContents.executeJavaScript('typeof window.workbench?.petOpen');
    check('pet-preload-exposes-open', apiType === 'function', apiType);

    trace('click pet open');
    const before = BrowserWindow.getAllWindows().length;
    const clicked = await main.webContents.executeJavaScript(`(async () => {
      const btn = document.querySelector('#stage-pet-open');
      if (!btn) return { button: false };
      btn.click();
      await new Promise(r => setTimeout(r, 350));
      const s = document.querySelector('#stage-status, .stage-status, #stage-status-line');
      return { button: true, status: (s?.textContent || '').slice(0, 120) };
    })()`);
    check('pet-button-bound', clicked.button === true && /桌宠已悬浮到桌面/.test(clicked.status || ''), clicked);

    const wins = BrowserWindow.getAllWindows();
    petWin = wins.find((w) => w !== main);
    trace('windows after click: ' + wins.length);
    check('pet-window-created', Boolean(petWin) && wins.length === before + 1, { before, after: wins.length });
    if (!petWin) return finish();

    petWin.webContents.on('console-message', (_e, level, msg) => {
      if (level >= 2 && !/Security Warning/.test(msg)) result.errors.push('pet console: ' + msg.slice(0, 200));
    });
    petWin.webContents.on('preload-error', (_e, p, err) => result.errors.push('pet preload: ' + p + ' ' + err.message));
    trace('wait for pet render');
    await wait(700);

    trace('read pet DOM');
    const url = petWin.webContents.getURL();
    check('pet-loads-own-page', /\/pet\.html$/.test(url) && petWin.isVisible() && !petWin.isDestroyed(), { url, visible: petWin.isVisible() });

    const dom = await petWin.webContents.executeJavaScript(`(() => {
      const q = (s) => document.querySelector(s);
      const strip = q('.pet-strip');
      const cs = strip ? getComputedStyle(strip) : null;
      return {
        avatars: typeof window.__avatars, workbench: typeof window.workbench,
        sprite: document.querySelectorAll('.pet-sprite').length,
        strip: document.querySelectorAll('.pet-strip').length,
        anim: cs ? cs.animationName : '',
        sheet: strip ? strip.style.getPropertyValue('--pet-sheet') : '',
        buttons: document.querySelectorAll('#pet-toolbar button').length,
      };
    })()`);
    check('pet-actor-rendered', dom.avatars === 'object' && dom.workbench === 'object'
      && dom.sprite === 1 && dom.strip === 1 && dom.anim === 'pet-play' && /roster\/.+\.webp/.test(dom.sheet), dom);
    check('pet-toolbar-complete', dom.buttons === 6, dom.buttons);

    // isVisible() 为真不代表屏幕上真有像素，数一次 BGRA 的 alpha。
    trace('capture pet pixels');
    const img = await petWin.webContents.capturePage();
    const bmp = img.toBitmap();
    let opaque = 0;
    for (let i = 3; i < bmp.length; i += 4) if (bmp[i] > 8) opaque += 1;
    const ratio = opaque / (bmp.length / 4);
    check('pet-has-visible-pixels', ratio > 0.05, { ratio: +ratio.toFixed(3) });

    trace('captured, open outfits');
    const outfits = await petWin.webContents.executeJavaScript(`(async () => {
      document.querySelector('#pet-swap')?.click();
      await new Promise(r => setTimeout(r, 180));
      return { hidden: document.querySelector('#pet-outfits')?.hidden,
        count: document.querySelectorAll('#pet-outfits-grid [data-outfit]').length };
    })()`);
    check('pet-outfit-library-lists-30', outfits.hidden === false && outfits.count === 30, outfits);

    trace('outfits done, open menu');
    const menu = await petWin.webContents.executeJavaScript(`(async () => {
      document.querySelector('#pet-outfits').hidden = true;
      document.getElementById('pet-actor').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 60 }));
      await new Promise(r => setTimeout(r, 150));
      const m = document.getElementById('pet-menu');
      return { hidden: m?.hidden, items: m ? m.querySelectorAll('[role="menuitem"]').length : 0 };
    })()`);
    check('pet-context-menu-works', menu.hidden === false && menu.items === 6, menu);

    trace('menu done, snapshot');
    const snap = ctl.snapshot();
    check('pet-hitbox-reported', Boolean(snap.hitbox && snap.hitbox.w > 0 && snap.hitbox.h > 0), snap);

    trace('snapshot done, petControl lock');
    const lock = await petWin.webContents.executeJavaScript(`window.workbench.petControl('lock', true)`);
    check('pet-control-channel', lock && lock.ok === true, lock);

    trace('lock done, close pet');
    // 在桌宠自己的渲染进程里 close 会销毁窗口，executeJavaScript 的 promise 必然以
    // "Render frame was disposed" 结束。这里只验证「关闭通道真的关掉了窗口」。
    petWin.webContents.executeJavaScript(`window.workbench.petControl('close')`).catch(() => {});
    await wait(400);
    check('pet-closes', petWin.isDestroyed(), { destroyed: petWin.isDestroyed() });
    finish();
  } catch (e) {
    result.errors.push('fatal: ' + (e && e.stack || e));
    finish();
  }
});

setTimeout(() => { result.errors.push('timeout'); finish(); }, 45000).unref?.();
