/* 模型显示 ID：用户可自定义，默认是模型原名。
   所有显示模型名的地方（对话下拉、讨论场景、多视角、派发、形象页）都走这里，
   改一次 ID，各处一起变。 */
(() => {
  const key = (modelId) => 'model-alias:' + modelId;

  function get(modelId, fallback) {
    try {
      const saved = localStorage.getItem(key(modelId));
      if (saved) return saved;
    } catch {}
    return fallback || String(modelId || '');
  }

  function set(modelId, value) {
    const text = String(value || '').trim();
    try {
      if (text) localStorage.setItem(key(modelId), text);
      else localStorage.removeItem(key(modelId));
    } catch {}
    return get(modelId, '');
  }

  function clear(modelId) {
    try { localStorage.removeItem(key(modelId)); } catch {}
  }

  // 从模型对象取显示名：自定义 ID > 模型原名 > modelId
  function of(model) {
    if (!model) return '';
    return get(model.id, model.name || model.id);
  }

  // 是否用户改过（用于界面提示"已自定义"）
  function isCustom(modelId) {
    try { return Boolean(localStorage.getItem(key(modelId))); } catch { return false; }
  }

  window.__modelAlias = { get, set, clear, of, isCustom, key };
})();
