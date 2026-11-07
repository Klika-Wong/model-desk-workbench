'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { allowedWebAiUrl, allowedNavigation } = require('./webai-policy.cjs');

test('只放行白名单站点，且必须 https', () => {
  assert.equal(allowedWebAiUrl('https://chat.deepseek.com/').host, 'chat.deepseek.com');
  assert.equal(allowedWebAiUrl('https://chatgpt.com/').host, 'chatgpt.com');
  assert.equal(allowedWebAiUrl('http://chat.deepseek.com/'), null, 'http 不放行');
  assert.equal(allowedWebAiUrl('https://evil.example.com/'), null);
  assert.equal(allowedWebAiUrl('https://chat.deepseek.com.evil.com/'), null, '后缀伪装不放行');
  assert.equal(allowedWebAiUrl('javascript:alert(1)'), null);
  assert.equal(allowedWebAiUrl(''), null);
  assert.equal(allowedWebAiUrl(null), null);
});

test('站内导航只允许同域，跨域跳转一律拒绝', () => {
  assert.equal(allowedNavigation('https://chat.deepseek.com/a/chat', 'chat.deepseek.com'), true);
  assert.equal(allowedNavigation('https://chatgpt.com/c/123', 'chat.deepseek.com'), false, '不许跨站');
  assert.equal(allowedNavigation('https://evil.com/', 'chat.deepseek.com'), false);
  assert.equal(allowedNavigation('https://chat.deepseek.com/', null), true, '未给来源时只看白名单');
  assert.equal(allowedNavigation('about:blank', 'chat.deepseek.com'), false);
});
