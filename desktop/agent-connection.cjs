'use strict';

const path = require('node:path');

// Only the desktop supplies the installation, current project and discovered panel.
// The form can name a host and bind one conversation, but cannot supply a command.
function connectionConfig({ root, project, baseUrl, host, session = '' }) {
  if (!root || !path.isAbsolute(root)) throw new Error('找不到工作台安装目录。');
  if (!project || !path.isAbsolute(project)) throw new Error('请先选择项目。');
  if (typeof host !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(host)) {
    throw new Error('Agent 标识请使用 1 至 64 位字母、数字、点、短横线或下划线，以字母或数字开头。');
  }
  if (typeof session !== 'string' || (session && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(session))) {
    throw new Error('专用会话标识格式无效。');
  }
  const url = new URL(baseUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.href !== url.origin + '/') {
    throw new Error('工作台必须使用本机回环地址。');
  }
  const worker = path.join(root, '.local-worker');
  const args = [path.join(worker, 'brain_mcp_server.py'), '--project', project, '--host', host,
    '--owner', host, '--role', 'brain', '--panel-url', url.origin];
  if (session) args.push('--session-binding', 'user_bound', '--session-id', session);
  return { mcpServers: { 'model-desk': {
    command: path.join(worker, 'venv', 'Scripts', 'python.exe'), args
  } } };
}

module.exports = { connectionConfig };
