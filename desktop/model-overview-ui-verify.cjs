'use strict';
// Run with Electron; fixtures only, no model calls or private project data.
const {app, BrowserWindow} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
async function main() {
  const win = new BrowserWindow({width: 1280, height: 900, show: false,
    webPreferences: {offscreen: true, preload: path.join(__dirname, 'ui-verify-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true}});
  await win.loadFile(path.join(__dirname, 'index.html'));
  const js = code => win.webContents.executeJavaScript(code);
  await js(`window.__stubCalls.enablePanelFixture(); document.getElementById('nav-panel').click()`);
  const results = [];
  for (const width of [600, 800, 1280]) for (const theme of ['light', 'dark']) {
    win.setContentSize(width, 900);
    await js(`window.__workbenchShell.setTheme('${theme}')`);
    await new Promise(resolve => setTimeout(resolve, 150));
    const result = await js(`(() => {
      function rgb(color) { return (color.match(/[0-9.]+/g)||[]).map(Number); }
      function luminance(c) { return c.slice(0,3).map(v => {v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;}).reduce((s,v,i) => s+v*[.2126,.7152,.0722][i],0); }
      function contrast(node) {
        const foreground = rgb(getComputedStyle(node).color);
        let parent = node, background;
        while (parent) {
          const c = rgb(getComputedStyle(parent).backgroundColor);
          if (c.length === 3 || c[3] === 1) {background = c; break;}
          parent = parent.parentElement;
        }
        if (!background) return 0;
        const a = luminance(foreground), b = luminance(background);
        return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      }
      const page = document.getElementById('models-page');
      const targets = [...page.querySelectorAll('button:not(:disabled), h3, .model-meta')];
      return {overflow: document.documentElement.scrollWidth > innerWidth + 1,
        minContrast: Math.min(...targets.map(contrast)), rows: page.querySelectorAll('.model-row').length,
        active: [...document.querySelectorAll('.nav-button.active')].map(n=>n.id)};
    })()`);
    if (result.overflow || result.minContrast < 4.5 || result.rows !== 2 || result.active.join() !== 'nav-panel') throw new Error(JSON.stringify({width,theme,...result}));
    results.push({width,theme,...result});
    if (process.env.MODEL_DESK_SCREENSHOTS) {
      fs.mkdirSync(process.env.MODEL_DESK_SCREENSHOTS, {recursive:true});
      fs.writeFileSync(path.join(process.env.MODEL_DESK_SCREENSHOTS, `models-${width}-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    }
  }
  win.destroy();
  process.stdout.write(JSON.stringify({ok:true,results})+'\n');
}
app.whenReady().then(main).then(() => app.quit()).catch(error => {process.stdout.write(JSON.stringify({ok:false,error:error.message})+'\n'); app.exit(1);});
