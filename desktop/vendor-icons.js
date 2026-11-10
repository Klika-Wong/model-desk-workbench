/* 主界面 vendor 图标的统一回退处理。
   图标文件来自 tabler/tabler-icons (MIT)，路径与 SHA-256 见 assets/vendor/SOURCES.json。
   CSP 是 script-src 'self'，不能写 inline onerror，所以在这里统一绑定：
   本地 SVG 缺失时退回 data-fallback 的系统字符，不显示破图，也不访问外网。
   动态创建的图标（协作舱状态情绪标）在各自的模块里单独绑 onerror。 */
(() => {
  function bind() {
    for (const img of document.querySelectorAll('img.vendor-ico[data-fallback]')) {
      const fail = () => {
        img.replaceWith(document.createTextNode(img.dataset.fallback || ''));
      };
      img.addEventListener('error', fail, { once: true });
      // 图片有可能在脚本执行前就已完成加载并失败（缓存 / 同步解码），补一次判定。
      if (img.complete && img.naturalWidth === 0) fail();
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }
})();
