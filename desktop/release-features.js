/* 正式版功能封存（release sealing）
 *
 * 有些能力是实验性的（多视角对比、讨论/例会、桌宠陪聊）。正式版里它们不进界面，
 * 但代码、测试、数据链路全部保留：只要把对应的 key 从封存列表里去掉，或设置
 * 环境变量 MODEL_DESK_EXPERIMENTAL=1，入口就回来。这里只负责「显示与启停」，
 * 不删任何实现，也不改变未封存时的行为。
 */
(() => {
  const DEFAULT_SEALED = ['multi', 'discussion', 'pet'];
  const TOGGLES = { multi: 'chat-multi', discussion: 'chat-discussion', pet: 'chat-pet' };
  let sealed = new Set(DEFAULT_SEALED);

  function labelOf(id) {
    const input = document.getElementById(id);
    if (!input) return null;
    return input.closest ? input.closest('label') : input.parentElement;
  }

  // 封存时：隐藏并取消勾选那个开关，让界面回到「普通对话」。
  // 取消勾选会触发原有 change 监听，所以不会留下一个看不见却被选中的模式。
  function apply(list) {
    sealed = new Set(Array.isArray(list) ? list : DEFAULT_SEALED);
    for (const [key, id] of Object.entries(TOGGLES)) {
      const label = labelOf(id);
      const input = document.getElementById(id);
      if (!label || !input) continue;
      const off = sealed.has(key);
      label.hidden = off;
      if (off && input.checked) {
        input.checked = false;
        input.dispatchEvent(new Event('change'));
      }
      input.disabled = off;
    }
    // 参与对比/讨论的模型多选也跟着收起，避免留一个无主控件。
    const picks = document.getElementById('chat-multi-models');
    if (picks && sealed.has('multi') && sealed.has('discussion')) picks.hidden = true;
    const summary = document.getElementById('chat-options-summary');
    if (summary && !summary.textContent.includes('普通对话')) summary.textContent = '普通对话';
    document.documentElement.dataset.sealed = [...sealed].join(',');
  }

  const isSealed = (key) => sealed.has(key);
  window.__releaseFeatures = { apply, isSealed, keys: () => [...sealed] };

  async function load() {
    try {
      const reply = await window.workbench.releaseFeatures();
      if (reply && reply.ok && Array.isArray(reply.data && reply.data.sealed)) {
        apply(reply.data.sealed);
        return;
      }
    } catch {}
    apply(DEFAULT_SEALED);
  }

  // 界面脚本之后才就绪时也能补齐：DOM 已解析完成即执行，否则等 DOMContentLoaded。
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
