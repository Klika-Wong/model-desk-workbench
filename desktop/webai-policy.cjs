'use strict';

// 网页 AI 入口：只允许白名单站点，且必须 https。
// 这里不做任何自动化（不填问题、不抓回复）——只当浏览器容器用。

const ALLOWED_HOSTS = new Set([
  'chat.deepseek.com',
  'chatgpt.com',
  'chat.openai.com',
]);

function allowedWebAiUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || ''));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) return null;
  return { href: url.href, host };
}

// 站内导航也要过一遍：只允许同域，避免被重定向到别处。
function allowedNavigation(raw, originHost) {
  let url;
  try {
    url = new URL(String(raw || ''));
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) return false;
  return !originHost || host === String(originHost).toLowerCase();
}

module.exports = { allowedWebAiUrl, allowedNavigation, ALLOWED_HOSTS };
