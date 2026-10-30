(() => {
  const root = document.documentElement;
  const grip = document.getElementById('sidebar-resizer');
  const toggle = document.getElementById('toggle-sidebar');
  const dock = document.getElementById('dock-sidebar');
  let drag = null;
  let prefs = { width: 226, right: false, hidden: false };
  try { const saved = JSON.parse(localStorage.getItem('workspace-layout')); if (saved) prefs = { width: Number.isFinite(saved.width) ? saved.width : 226, right: saved.right === true, hidden: saved.hidden === true }; } catch {}
  function apply() {
    prefs.width = Math.max(190, Math.min(380, Math.floor(window.innerWidth * .35), prefs.width));
    root.style.setProperty('--sidebar-width', `${prefs.width}px`);
    document.body.classList.toggle('sidebar-right', prefs.right);
    document.body.classList.toggle('sidebar-hidden', prefs.hidden);
    toggle.setAttribute('aria-expanded', String(!prefs.hidden));
    grip.setAttribute('aria-valuenow', String(prefs.width));
    grip.setAttribute('aria-valuemin', '190'); grip.setAttribute('aria-valuemax', String(Math.min(380, Math.floor(window.innerWidth * .35))));
    grip.setAttribute('aria-valuetext', `${prefs.width} 像素；${prefs.right ? '向左' : '向右'}拖动加宽`);
    dock.textContent = prefs.right ? '移到左侧' : '移到右侧';
    try { localStorage.setItem('workspace-layout', JSON.stringify(prefs)); } catch {}
  }
  toggle.addEventListener('click', () => { prefs.hidden = !prefs.hidden; apply(); });
  dock.addEventListener('click', () => { prefs.right = !prefs.right; apply(); document.getElementById('layout-menu').open = false; });
  grip.addEventListener('pointerdown', e => { drag = {x:e.clientX,width:prefs.width}; grip.setPointerCapture(e.pointerId); e.preventDefault(); });
  grip.addEventListener('pointermove', e => { if (grip.hasPointerCapture(e.pointerId)) { prefs.width = drag.width + (e.clientX - drag.x) * (prefs.right ? -1 : 1); apply(); } });
  grip.addEventListener('pointerup', e => { if (grip.hasPointerCapture(e.pointerId)) grip.releasePointerCapture(e.pointerId); });
  grip.addEventListener('keydown', e => { if (!['ArrowLeft','ArrowRight'].includes(e.key)) return; e.preventDefault(); prefs.width += (e.key === 'ArrowRight' ? 10 : -10) * (prefs.right ? -1 : 1); apply(); });
  document.getElementById('reset-layout').addEventListener('click', () => { prefs = {width:226,right:false,hidden:false}; apply(); document.getElementById('layout-menu').open=false; });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.getElementById('layout-menu').open=false;
    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b' && !['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName) && !document.querySelector('dialog[open]')) { e.preventDefault(); prefs.hidden=!prefs.hidden; apply(); }
  });
  document.addEventListener('pointerdown', e => { const menu=document.getElementById('layout-menu'); if (!menu.contains(e.target)) menu.open=false; });
  window.addEventListener('resize', apply);
  apply();
})();
