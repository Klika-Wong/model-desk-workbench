// 降低动效：关掉角色循环序列帧、连线流光与呼吸，用于低配机器、对光敏感或排查闪烁。
// 存在本机；主窗口与桌宠窗口共用同一个键。
(() => {
  const KEY = 'reduce-motion';
  const root = document.documentElement;
  const read = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
  const apply = (on) => { root.dataset.reduceMotion = on ? '1' : '0'; };
  apply(read());
  const sync = (on) => {
    try { on ? localStorage.setItem(KEY, '1') : localStorage.removeItem(KEY); } catch {}
    apply(on);
    for (const box of document.querySelectorAll('[data-motion-toggle]')) box.checked = on;
  };
  window.__motion = { get: read, set: sync };
  const wire = () => {
    for (const box of document.querySelectorAll('[data-motion-toggle]')) {
      box.checked = read();
      box.addEventListener('change', () => sync(box.checked));
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
