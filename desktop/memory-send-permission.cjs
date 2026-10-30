'use strict';

// A one-time "send this exact memory context out" permission.
//
// The permission is bound to a SHA-256 hash of the exact previewed text and
// expires after a short TTL. If the underlying memory changes between grant and
// copy, the hash no longer matches and the permission is rejected, so a stale
// or altered packet can never be sent out under an earlier grant.
//
// This is a local, application-level gate. It does not itself send anything and
// it is not an OS sandbox.

const { createHash, randomBytes } = require('node:crypto');

const TTL_MS = 5 * 60 * 1000;

function hashText(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function createPermission(previewText, now = Date.now()) {
  return {
    token: randomBytes(16).toString('hex'),
    hash: hashText(previewText),
    expires: now + TTL_MS,
  };
}

function verifyPermission(permission, token, currentText, now = Date.now()) {
  if (!permission || permission.token !== token) {
    throw new Error('外发授权缺失或已失效，请重新授权。');
  }
  if (permission.expires < now) {
    throw new Error('外发授权已过期，请重新授权。');
  }
  if (permission.hash !== hashText(currentText)) {
    throw new Error('记忆内容已变化，本次外发授权自动失效，请重新检索并授权。');
  }
  return true;
}

module.exports = { TTL_MS, hashText, createPermission, verifyPermission };
