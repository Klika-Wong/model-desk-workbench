/* 独立桌宠窗口的真机验证（Electron 主进程脚本）。
   背景：ui-verify.cjs 用的是桩 preload，petOpen 永远返回 {ok:true} 却不建窗口，
   所以「点了悬浮到桌面到底有没有窗口」一直没有真机覆盖。这个文件补上这条链：
   主窗口真实点击 → pet:open 建窗 → 窗口像素 / 形象库 / 右键菜单 / 关闭。
   由 pet-verify-run.cjs 以 Electron 入口脚本启动，不参与 ui-verify 的桩环境。 */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

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
    // 上一轮验证会把 lock:true 与窗口位置写进这个目录；下一轮启动时 state.locked
    // 直接短路 drag-start，拖动断言会莫名其妙失败。每轮从干净配置开始。
    try { fs.unlinkSync(path.join(app.getPath('userData'), 'pet-window.json')); } catch {}
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

    // 第三方素材：SVG 必须真的解码出来，且全部来自本地 vendor 目录，不能是 CDN 外链。
    const art = await petWin.webContents.executeJavaScript(`(async () => {
      const toolbarImgs = [...document.querySelectorAll('#pet-toolbar img.ico')];
      const emoteBtn = document.getElementById('pet-emote');
      emoteBtn.click();
      const emoteImgs = [...document.querySelectorAll('#pet-emotes img.emote-face')];
      await Promise.all([...toolbarImgs, ...emoteImgs].map((i) =>
        i.decode ? i.decode().catch(() => {}) : Promise.resolve()));
      const out = {
        toolbar: toolbarImgs.length,
        toolbarLoaded: toolbarImgs.filter((i) => i.complete && i.naturalWidth > 0).length,
        toolbarSrc: toolbarImgs.map((i) => i.getAttribute('src')),
        emotes: emoteImgs.length,
        emotesLoaded: emoteImgs.filter((i) => i.complete && i.naturalWidth > 0).length,
        emoteSrc: emoteImgs.map((i) => i.getAttribute('src')),
        external: [...document.images].filter((i) => /^https?:/i.test(i.getAttribute('src') || '')).length,
      };
      emoteBtn.click();   // 关回表情面板，别影响后面的菜单/形象库断言
      return out;
    })()`);
    check('pet-toolbar-icons-local-and-loaded', art.toolbar === 6 && art.toolbarLoaded === 6
      && art.toolbarSrc.every((s) => s && s.startsWith('assets/vendor/tabler-icons/')), art);
    check('pet-emotes-use-vendored-emoji', art.emotes === 8 && art.emotesLoaded === 8
      && art.emoteSrc.every((s) => s && s.startsWith('assets/vendor/fluent-emoji/')), art);
    check('pet-no-external-images', art.external === 0, art.external);

    // isVisible() 为真不代表屏幕上真有像素，数一次 BGRA 的 alpha。
    trace('capture pet pixels');
    const img = await petWin.webContents.capturePage();
    const bmp = img.toBitmap();
    let opaque = 0;
    for (let i = 3; i < bmp.length; i += 4) if (bmp[i] > 8) opaque += 1;
    const ratio = opaque / (bmp.length / 4);
    check('pet-has-visible-pixels', ratio > 0.05, { ratio: +ratio.toFixed(3) });

    // 输入驱动动作：光标跟随 + 快速划过追光 + 打字敲键盘。
    // 同时盯住 --pet-frames / --pet-dur：只改动作行不改帧数会扫到素材空白格，就是「闪一下」。
    trace('probe input-driven motion');
    const motionProbe = await petWin.webContents.executeJavaScript(`(async () => {
      const read = () => {
        const s = document.querySelector('.pet-sprite');
        return { row: s ? s.style.getPropertyValue('--pet-row') : '',
          frames: s ? s.style.getPropertyValue('--pet-frames') : '',
          dur: s ? s.style.getPropertyValue('--pet-dur') : '',
          flip: s ? s.style.getPropertyValue('--pet-flip') : '' };
      };
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      const before = read();
      const actor = document.getElementById('pet-actor');
      actor.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 8 }));
      await wait(150);
      const leftFlip = read().flip;
      actor.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 240 }));
      await wait(220);
      const hunt = read();
      await wait(700);
      document.getElementById('pet-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      await wait(220);
      const typing = read();
      await wait(2200);
      const settled = read();
      return { api: typeof window.__petMotion, state: typeof window.__petMotionState,
        before, leftFlip, hunt, typing, settled };
    })()`);
    check('pet-motion-api-present', motionProbe.api === 'object' && motionProbe.state === 'function', motionProbe);
    check('pet-motion-cursor-faces', motionProbe.leftFlip === '-1' && motionProbe.hunt.flip === '1', motionProbe);
    check('pet-motion-hunt-row-and-frames', motionProbe.hunt.row === '4'
      && motionProbe.hunt.frames === '5' && motionProbe.hunt.dur === '1100ms', motionProbe.hunt);
    check('pet-motion-typing-row-and-frames', motionProbe.typing.row === '7'
      && motionProbe.typing.frames === '6' && motionProbe.typing.dur === '1320ms', motionProbe.typing);
    check('pet-motion-returns-to-idle', motionProbe.settled.row === '0'
      && motionProbe.settled.frames === '6', motionProbe.settled);

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

    trace('menu keyboard path');
    // 真机里走一遍键盘：开菜单自动聚焦第一项 → ArrowDown 轮到第二项 → Esc 收起并归还焦点。
    // 这些是 DOM 层面的 KeyboardEvent，不依赖操作系统是否真的把焦点给了这个无边框小窗。
    const menuKeys = await petWin.webContents.executeJavaScript(`(async () => {
      const m = document.getElementById('pet-menu');
      const items = [...m.querySelectorAll('[data-action]')];
      const firstFocused = document.activeElement === items[0];
      items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      const afterDown = document.activeElement === items[1];
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 80));
      return { firstFocused, afterDown, hidden: m.hidden,
        returnedTo: document.activeElement === document.getElementById('pet-actor') };
    })()`);
    check('pet-menu-keyboard', menuKeys.firstFocused && menuKeys.afterDown
      && menuKeys.hidden === true && menuKeys.returnedTo, menuKeys);

    trace('menu done, snapshot');
    const snap = ctl.snapshot();
    check('pet-hitbox-reported', Boolean(snap.hitbox && snap.hitbox.w > 0 && snap.hitbox.h > 0), snap);
    check('pet-hit-diagnostics-readable',
      Number.isFinite(snap.diag && snap.diag.ignoreSwitches)
      && Number.isFinite(snap.diag && snap.diag.hitboxNoops)
      && Array.isArray(snap.diag && snap.diag.ignoreReasons), snap.diag);

    // 动作帧只改 CSS 变量，包围盒一像素都没变。以前 MutationObserver 监听 style，
    // applyRow 每帧写变量 → 每 60ms 一次跨进程上报 + 一次强制布局，白抢动画的帧预算。
    // 这里真跑 12 帧，读渲染层统计，证明「量到了、但没往主进程发」。
    trace('probe hitbox dedupe');
    const hitStats = await petWin.webContents.executeJavaScript(`(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      await wait(180);   // 让前面菜单 / 形象面板变更挂起的 60ms 定时器先收敛
      const before = window.__petHitboxStats();
      const sprite = document.querySelector('.pet-sprite');
      for (let i = 0; i < 12; i++) {
        if (sprite) sprite.style.setProperty('--pet-row', String(i % 9));
        await new Promise(r => requestAnimationFrame(r));
      }
      await wait(180);
      return { before, after: window.__petHitboxStats(),
        hasApi: typeof window.__petHitboxStats === 'function' };
    })()`);
    check('pet-hitbox-no-redundant-ipc',
      hitStats.hasApi === true
      && hitStats.after.measured > hitStats.before.measured
      && hitStats.after.sent === hitStats.before.sent
      && hitStats.after.skipped > hitStats.before.skipped, hitStats);

    // 松手当帧还原穿透：drag-start 会把整窗强制设成可点，drag-end 传的是
    // 窗口左上角附近的最终光标（远在角色包围盒外），应当立刻切回穿透。
    // 用 ignoreReasons 历史判断，避免 200ms 兜底轮询刚好覆盖 lastProbe.source。
    trace('probe drag-end ignore reset');
    const [wx, wy] = petWin.getPosition();
    const switchesBefore = ctl.snapshot().diag.ignoreSwitches;
    const dragReply = await petWin.webContents.executeJavaScript(`(async () => {
      const unlocked = await window.workbench.petControl('lock', false);
      const a = await window.workbench.petControl('drag-start', { x: 2, y: 2 });
      const b = await window.workbench.petControl('drag-end', { sx: ${wx + 2}, sy: ${wy + 2} });
      return { unlocked: !!unlocked && unlocked.ok === true,
        a: !!a && a.ok === true, b: !!b && b.ok === true };
    })()`);
    const afterDrag = ctl.snapshot();
    check('pet-drag-end-restores-ignore',
      dragReply.unlocked === true && dragReply.a === true && dragReply.b === true
      && afterDrag.dragOffset === null
      && afterDrag.diag.ignoreSwitches > switchesBefore
      && afterDrag.diag.ignoreReasons.includes('drag-start')
      && afterDrag.diag.ignoreReasons.includes('drag-end'),
      { dragReply, diag: afterDrag.diag, ignoring: afterDrag.ignoring });

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
