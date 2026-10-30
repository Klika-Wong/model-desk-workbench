const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function (window, file) {
  const run = (code) => window.webContents.executeJavaScript(code);
  const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));
  async function until(code) { for (let i = 0; i < 60; i += 1) { if (await run(code)) return; await new Promise((r) => setTimeout(r, 50)); } throw Error('Designer UI condition failed: ' + code); }

  await run("document.querySelector('#nav-designer').click()");
  await until("document.querySelectorAll('.diagram-node').length===11");
  assert.ok((await run("document.querySelector('#designer-space').options.length")) >= 3, '架构画布应提供空间选择器');
  assert.equal(await run("document.querySelector('#designer-space').value"), 'project-a');

  // zoom
  await settle(150);
  const zoomCheck = await run(`(()=>{const c=document.querySelector('#designer-canvas');const before=c.style.getPropertyValue('--designer-zoom')||'1';document.querySelector('#designer-zoom-in').click();const afterIn=c.style.getPropertyValue('--designer-zoom');const label=document.querySelector('#designer-zoom-reset').textContent;document.querySelector('#designer-zoom-reset').click();return {before,afterIn,label,afterReset:c.style.getPropertyValue('--designer-zoom')};})()`);
  assert.equal(zoomCheck.before, '1');
  assert.notEqual(zoomCheck.afterIn, '1', '放大后缩放值应变化');
  assert.equal(zoomCheck.label, '110%');
  assert.equal(zoomCheck.afterReset, '1');

  // marquee select: drag on empty canvas selects intersecting nodes
  const marqueeMsg = await run(`(()=>{const vp=document.querySelector('#designer-canvas');const r=vp.getBoundingClientRect();vp.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:3,clientX:r.left+4,clientY:r.top+4}));vp.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:3,clientX:r.left+r.width-4,clientY:r.top+r.height-4}));vp.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:3,clientX:r.left+r.width-4,clientY:r.top+r.height-4}));return document.querySelector('#designer-message').textContent;})()`);
  assert.match(marqueeMsg, /已框选/, '框选应选中相交节点');

  // tool separation: hand tool vs select tool
  const tools = await run(`(()=>{const vp=document.querySelector('#designer-canvas');document.querySelector('#designer-tool-hand').click();const hand=vp.classList.contains('tool-hand');const hp=document.querySelector('#designer-tool-hand').getAttribute('aria-pressed');document.querySelector('#designer-tool-select').click();const afterSel=vp.classList.contains('tool-hand');return {hand,hp,afterSel,sp:document.querySelector('#designer-tool-select').getAttribute('aria-pressed')};})()`);
  assert.equal(tools.hand, true, '抓手工具应进入平移态');
  assert.equal(tools.hp, 'true');
  assert.equal(tools.afterSel, false, '切回选择工具应退出平移态');
  assert.equal(tools.sp, 'true');

  // drag a node freely (pointer events on the infinite canvas)
  const beforeLeft = await run("document.querySelector('.diagram-node[data-id=\"tools\"]').style.left");
  await run(`(()=>{const el=document.querySelector('.diagram-node[data-id="tools"]');const r=el.getBoundingClientRect();const vp=document.querySelector('#designer-canvas');el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:1,clientX:r.left+20,clientY:r.top+20}));vp.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,clientX:r.left+120,clientY:r.top+60}));vp.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,clientX:r.left+120,clientY:r.top+60}));return true;})()`);
  await until("document.querySelector('#designer-version').textContent.includes('未保存')");
  const afterLeft = await run("document.querySelector('.diagram-node[data-id=\"tools\"]').style.left");
  assert.notEqual(afterLeft, beforeLeft, '拖动后节点位置应改变');

  // connect human -> projects via right-click menu
  await run(`(()=>{const el=document.querySelector('.diagram-node[data-id="human"]');const r=el.getBoundingClientRect();el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:r.left+20,clientY:r.top+20}));return true;})()`);
  await until("!document.querySelector('#designer-menu').hidden");
  await run("[...document.querySelectorAll('#designer-menu button')].find(b=>b.textContent.includes('连线')).click()");
  await until("document.querySelector('#designer-message').textContent.includes('连线模式')");
  await run(`(()=>{const el=document.querySelector('.diagram-node[data-id="projects"]');const r=el.getBoundingClientRect();el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerId:2,clientX:r.left+20,clientY:r.top+20}));return true;})()`);
  await until("document.querySelector('#designer-version').textContent.includes('未保存')");

  // right-click shows details in the inspector
  await run(`(()=>{const el=document.querySelector('.diagram-node[data-id="goals"]');const r=el.getBoundingClientRect();el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:r.left+20,clientY:r.top+20}));return true;})()`);
  await until("!document.querySelector('#designer-menu').hidden");
  await run("[...document.querySelectorAll('#designer-menu button')].find(b=>b.textContent==='查看详情').click()");
  await until("document.querySelector('#designer-menu').hidden");
  assert.equal(await run("document.querySelector('#designer-name').value"), '目标 · 当前进度');

  // trial
  await run("document.querySelector('#designer-trial').click()");
  await until("document.querySelector('#designer-results').textContent.includes('连线')");

  // save
  await settle();
  await run("document.querySelector('#designer-save').click()");
  await until("document.querySelector('#designer-preview').open");
  assert.match(await run("document.querySelector('#designer-diff').textContent"), /位置|连线/);
  await settle();
  await run("document.querySelector('#designer-confirm').click()");
  await until("!document.querySelector('#designer-preview').open && !document.querySelector('#designer-version').textContent.includes('未保存')");

  const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.notEqual(disk.spaces['project-a'].nodes.find((x) => x.id === 'tools').x, 340, '拖动后的坐标应持久化');
  assert.ok(disk.spaces['project-a'].edges.some((e) => (e.from === 'human' && e.to === 'projects') || (e.to === 'human' && e.from === 'projects')), '新连线应持久化');

  // per-space binding: project-b must remain the default and not be created
  await run("(()=>{const s=document.querySelector('#designer-space');s.value='project-b';s.dispatchEvent(new Event('change'));})()");
  await until("document.querySelector('#designer-version').textContent.includes('v0')");
  assert.equal(await run("[...document.querySelectorAll('.diagram-node')].length"), 11);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).spaces['project-b'], undefined, '项目B架构不应因项目A保存而被创建');
  await run("(()=>{const s=document.querySelector('#designer-space');s.value='project-a';s.dispatchEvent(new Event('change'));})()");
  await until("document.querySelector('#designer-version').textContent.includes('v1')");

  // add then undo
  await settle();
  await run("document.querySelector('#designer-add').click()");
  await until("document.querySelectorAll('.diagram-node').length===12");
  await settle();
  await run("document.querySelector('#designer-undo').click()");
  await until("document.querySelectorAll('.diagram-node').length===11");

  // AI import rejects unsupported fields
  await run("document.querySelector('#designer-ai').click()");
  await until("document.querySelector('#designer-ai-dialog').open");
  await run("document.querySelector('#designer-ai-input').value='{\"nodes\":[{\"command\":\"execute\"}]}';document.querySelector('#designer-import').click();");
  await until("document.querySelector('#designer-ai-error').textContent.includes('不支持')");
  await run("document.querySelector('#designer-ai-close').click()");

  // arrange / scatter
  const beforeArrange = await run("document.querySelector('.diagram-node[data-id=\"tools\"]').style.left");
  await settle();
  await run("document.querySelector('#designer-arrange').click()");
  await until("document.querySelector('#designer-version').textContent.includes('未保存')");
  const afterArrange = await run("document.querySelector('.diagram-node[data-id=\"tools\"]').style.left");
  assert.notEqual(afterArrange, beforeArrange, '整理应改变节点位置');
  await settle();
  await run("document.querySelector('#designer-undo').click()");

  // Theme and narrow layout: the canvas and inspector stay legible.
  await settle();
  await run("document.querySelector('#open-settings').click()");
  await until("document.querySelector('#settings-dialog').open");
  await run("(()=>{const s=document.querySelector('#theme-select');s.value='dark';s.dispatchEvent(new Event('change'));})()");
  assert.equal(await run("document.documentElement.getAttribute('data-theme')"), 'dark');
  await run("document.querySelector('#close-settings').click()");
  await run("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  await settle(250);
  fs.writeFileSync(path.join(__dirname, 'theme-dark-preview.png'), (await window.webContents.capturePage()).toPNG());
  const darkColors = await run("(()=>{const n=getComputedStyle(document.querySelector('.diagram-node'));const i=getComputedStyle(document.querySelector('.designer-inspector'));return {node:n.backgroundColor,ink:n.color,inspector:i.backgroundColor,inspectorInk:i.color};})()");
  assert.notEqual(darkColors.node, 'rgb(255, 255, 255)', '深色节点不应保持白底');
  assert.notEqual(darkColors.inspector, 'rgb(255, 255, 255)', '深色属性面板不应保持白底');
  assert.equal(darkColors.ink, darkColors.inspectorInk, '深色节点与属性面板使用同一高对比文字色');
  const oldSize = window.getSize();
  window.setSize(1000, 720);
  await settle(250);
  const narrow = await run("(()=>{const c=document.querySelector('#designer-canvas').getBoundingClientRect(),i=document.querySelector('.designer-inspector').getBoundingClientRect();return {stacked:i.top>=c.bottom-2,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};})()");
  assert.equal(narrow.stacked, true, '窄窗口属性面板应在画布下方');
  assert.equal(narrow.overflow, false, '窄窗口不应发生整页横向溢出');
  fs.writeFileSync(path.join(__dirname, 'theme-dark-narrow-preview.png'), (await window.webContents.capturePage()).toPNG());
  window.setSize(...oldSize);
  await run("document.querySelector('#open-settings').click()");
  await run("(()=>{const s=document.querySelector('#theme-select');s.value='light';s.dispatchEvent(new Event('change'));})()");
  assert.equal(await run("document.documentElement.getAttribute('data-theme')"), 'light');
  await run("document.querySelector('#close-settings').click()");

  // One navigation model: search lives below the navigation, without legacy view switches.
  await settle();
  const nav = await run("({search:!!document.querySelector('#sidebar-search'),theme:!!document.querySelector('#theme-seg'),view:!!document.querySelector('#view-seg')})");
  assert.deepEqual(nav, {search:true,theme:false,view:false});

  // fit view: every node should end up inside the canvas viewport
  await settle();
  await run("document.querySelector('#designer-fit').click()");
  await settle(160);
  const fits = await run(`(()=>{const vp=document.querySelector('#designer-canvas').getBoundingClientRect();return [...document.querySelectorAll('.diagram-node')].every(n=>{const r=n.getBoundingClientRect();return r.left>=vp.left-12&&r.right<=vp.right+12&&r.top>=vp.top-12&&r.bottom<=vp.bottom+12;});})()`);
  assert.equal(fits, true, '适配后所有节点应在视口内');

  await run("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  fs.writeFileSync(path.join(__dirname, 'architecture-preview.png'), (await window.webContents.capturePage()).toPNG());
  return ['designer-node-drag-persists', 'designer-context-menu-details', 'designer-connect-nodes', 'designer-canvas-zoom', 'designer-marquee-select', 'designer-tool-separation', 'designer-arrange-scatter', 'designer-fit-view', 'designer-trial-undo', 'designer-ai-invalid-proposal-rejected', 'architecture-per-space-binding', 'theme-toggle', 'theme-dark-contrast', 'theme-dark-narrow', 'single-navigation'];
};
