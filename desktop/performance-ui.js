(() => {
  const panel = document.getElementById('performance-dialog');
  const values = document.getElementById('performance-values');
  const refresh = document.getElementById('refresh-performance');
  let timer = null, generation = 0, pending = false;
  const visible = () => panel.open && !document.hidden;
  function schedule() {
    clearTimeout(timer);
    timer = visible() ? setTimeout(update, 10000) : null;
  }
  async function update() {
    if (!visible() || pending) return;
    clearTimeout(timer);
    const run = generation;
    pending = true; refresh.disabled = true;
    try {
      const data = await window.workbench.performanceSample();
      if (!visible() || run !== generation) return;
      const lines = [
        `CPU：${data.cpuPercent === null ? '等待第二次采样' : data.cpuPercent.toFixed(1) + '%'}`,
        `内存：${(data.usedBytes / 2 ** 30).toFixed(1)} / ${(data.totalBytes / 2 ** 30).toFixed(1)} GB`,
        ...data.gpus.map(g => `${g.name}：${g.usage}% · 显存 ${g.usedMiB} / ${g.totalMiB} MiB`),
        data.gpus.length ? '' : 'GPU：不可用或未支持',
        '以上为整机占用；单个模型占用暂不可归因。',
        `采样时间：${new Date(data.sampledAt).toLocaleTimeString()}`,
      ];
      values.replaceChildren();
      for (const text of lines.filter(Boolean)) {
        const line = document.createElement('p'); line.textContent = text; values.append(line);
      }
    } catch {
      if (visible() && run === generation) values.textContent = '读取失败，请稍后重试。';
    } finally {
      pending = false; refresh.disabled = false;
      if (visible() && run !== generation) update(); else schedule();
    }
  }
  document.getElementById('open-performance').onclick = () => {
    if (!panel.open) panel.showModal();
    generation++; values.textContent = '正在读取整机性能…'; update();
  };
  document.getElementById('close-performance').onclick = () => panel.close();
  panel.addEventListener('close', () => { generation++; clearTimeout(timer); timer = null; });
  document.addEventListener('visibilitychange', () => {
    generation++; clearTimeout(timer); timer = null;
    if (visible()) update();
  });
  refresh.onclick = update;
})();
