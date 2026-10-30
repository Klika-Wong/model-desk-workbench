'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(process.env.MODEL_DESK_NODE_MODULES || '', 'playwright'));
const current = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const toolbarIds = ['designer-tool-select', 'designer-tool-hand', 'designer-add',
  'designer-zoom-out', 'designer-zoom-reset', 'designer-zoom-in', 'designer-save',
  'designer-undo', 'designer-redo', 'designer-arrange', 'designer-fit',
  'designer-trial', 'designer-ai', 'designer-history-select', 'designer-history',
  'designer-reload'].sort();
// Static offline fixture inlines only local CSS, so omit the production external-style CSP here.
const html = current.replace(/<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g, (_, file) => `<style>${fs.readFileSync(path.join(__dirname, file), 'utf8')}</style>`);
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const checks = [];
  try {
    for (const width of [600, 800, 1280]) for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.route('**/*', route => route.abort());
      await page.setContent(html);
      await page.evaluate(theme => {
        document.documentElement.dataset.theme = theme;
        for (const child of document.querySelector('main.workspace').children) child.hidden = child.id !== 'designer-page';
      }, theme);
      assert.equal(await page.locator('.designer-toolbar').evaluate(el => getComputedStyle(el).display), 'flex', 'Fixture styles must actually load');
      const ids = await page.locator('.designer-toolbar [id]').evaluateAll(els => els.map(e => e.id).sort());
      assert.deepEqual(ids, toolbarIds);
      const groups = page.locator('.designer-toolbar details');
      assert.equal(await groups.count(), 2);
      assert.equal(await groups.evaluateAll(els => els.every(e => !e.open)), true);
      assert.equal(await page.locator('#designer-trial').isVisible(), false);
      assert.equal(await page.locator('#designer-save').isVisible(), true);
      for (let i = 0; i < 2; i++) {
        const summary = groups.nth(i).locator('summary');
        await summary.focus();
        await page.keyboard.press('Enter');
        assert.equal(await groups.nth(i).evaluate(e => e.open), true);
      }
      const layout = await page.evaluate(() => {
        const toolbar = document.querySelector('.designer-toolbar');
        const save = document.querySelector('#designer-save');
        const r = save.getBoundingClientRect();
        const s = getComputedStyle(save);
        return { overflow: document.documentElement.scrollWidth > innerWidth + 1, toolbarOverflow: toolbar.scrollWidth > toolbar.clientWidth + 1, saveVisible: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === save, fg: s.color, bg: s.backgroundColor };
      });
      assert.equal(layout.overflow, false, JSON.stringify({ width, theme, layout }));
      assert.equal(layout.toolbarOverflow, false, JSON.stringify({ width, theme, layout }));
      assert.equal(layout.saveVisible, true, '保存被遮挡');
      assert.notEqual(layout.fg, layout.bg);
      assert.equal(await page.locator('#designer-trial').isVisible(), true);
      assert.equal(await page.locator('#designer-history-select').isVisible(), true);
      await groups.evaluateAll(els => els.forEach(e => { e.open = false; }));
      if (width === 800) await page.screenshot({ path: path.join(__dirname, `toolbar-${theme}-preview.png`) });
      checks.push(`${width}-${theme}: ids, collapsed, keyboard, no-overflow, save-visible`);
      await page.close();
    }
    console.log(JSON.stringify({ ok: true, checks }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
