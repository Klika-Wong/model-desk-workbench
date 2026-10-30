'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TTL_MS, hashText, createPermission, verifyPermission,
} = require('./memory-send-permission.cjs');

test('createPermission 产出 32 字节令牌、64 位哈希与有效期', () => {
  const now = 1_000_000;
  const permission = createPermission('上下文内容', now);
  assert.equal(permission.token.length, 32);
  assert.equal(permission.hash, hashText('上下文内容'));
  assert.match(permission.hash, /^[a-f0-9]{64}$/);
  assert.equal(permission.expires, now + TTL_MS);
});

test('相同内容与令牌在有效期内通过校验', () => {
  const now = 5_000_000;
  const permission = createPermission('待外发的上下文', now);
  assert.equal(verifyPermission(permission, permission.token, '待外发的上下文', now + 1000), true);
});

test('令牌不匹配被拒绝', () => {
  const now = 5_000_000;
  const permission = createPermission('内容', now);
  assert.throws(() => verifyPermission(permission, '错误令牌', '内容', now), /授权缺失或已失效/);
});

test('过期后被拒绝', () => {
  const now = 5_000_000;
  const permission = createPermission('内容', now);
  assert.throws(() => verifyPermission(permission, permission.token, '内容', now + TTL_MS + 1), /已过期/);
});

test('内容变化后哈希失配被拒绝（撤回/编辑即失效）', () => {
  const now = 5_000_000;
  const permission = createPermission('原始已发布内容', now);
  assert.throws(() => verifyPermission(permission, permission.token, '被编辑后的内容', now), /内容已变化/);
});

test('不同正文产生不同哈希', () => {
  assert.notEqual(hashText('A 项目进度'), hashText('B 项目进度'));
});
