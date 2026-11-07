(() => {
  const settings = document.getElementById('settings-dialog');
  if (!settings) return;
  const heading = document.createElement('h3'); heading.textContent = 'AI 使用说明';
  const hint = document.createElement('p'); hint.className = 'hint';
  hint.textContent = '让已连接工作台的 AI 按需读取手册和当前设置。默认只读短入口，不把整份说明或私人记忆塞进上下文。';
  const button = document.createElement('button'); button.type = 'button'; button.id = 'copy-ai-guide';
  button.textContent = '复制给 AI 的使用入口';
  const status = document.createElement('p'); status.className = 'hint'; status.setAttribute('role', 'status');
  settings.append(heading, hint, button, status);
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const result = await window.workbench.copyAiGuide();
      if (!result?.ok) throw new Error('copy failed');
      status.textContent = '已复制短说明。新接入或更新 MCP 后可能需要重新连接；未接入的 AI 不会自动获得电脑访问权限。';
    } catch { status.textContent = '复制失败，请重开桌面软件后重试。'; }
    finally { button.disabled = false; }
  });
})();
