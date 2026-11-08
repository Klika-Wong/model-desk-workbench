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

  // 渲染诊断：把「到底在走硬件加速还是软件渲染」摊开给用户看。
  // 软件渲染 + 高 DPI 是「卡、闪」最常见的机器侧原因，不是样式能完全解决的。
  const fillRenderInfo = async () => {
    const box = document.getElementById('render-info');
    if (!box || !window.workbench || !window.workbench.renderInfo) return;
    let info = null;
    try { info = await window.workbench.renderInfo(); } catch { return; }
    if (!info) { box.textContent = '读不到渲染状态。'; return; }
    const accelerated = info.gpuCompositing === 'enabled';
    const parts = [
      accelerated ? '硬件加速：已开启' : '硬件加速：未启用（当前用软件渲染）',
      `显示器缩放：${info.scaleFactor}×`,
      `分辨率：${info.displaySize ? info.displaySize.join('×') : '未知'}`,
    ];
    box.textContent = parts.join(' · ') + (accelerated ? '' : '。软件渲染下动画更容易卡；可勾选上面的「降低动效」。');
    box.dataset.accelerated = accelerated ? '1' : '0';
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fillRenderInfo);
  else fillRenderInfo();
  const settingsBtn = document.getElementById('open-settings');
  if (settingsBtn) settingsBtn.addEventListener('click', () => setTimeout(fillRenderInfo, 120));
})();
