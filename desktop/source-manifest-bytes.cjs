/* SOURCE-MANIFEST 的字节规则，生成端、校验端与测试共用。
   git 的 core.autocrlf 因机器而异：同一份 blob 在 Windows 检出成 CRLF、在 Linux 是 LF。
   清单若按工作区原始字节算 SHA-256，换台机器核对必然全部 mismatch——
   一个声称「可离线核对源码完整性」的清单，不该只在生成它的那台机器上成立。

   规则：含 NUL 的文件按二进制原样（git 自己也不会转换这类文件）；其余统一去掉 CR
   只留 LF。这样无论 blob 里本来是 LF 还是 CRLF，规范化结果都一致，跨平台可核对。 */
'use strict';

function canonicalBytes(buf) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('canonicalBytes expects a Buffer');
  if (buf.includes(0)) return buf; // 二进制：连 CRLF 字节序列也不能改写
  // 纯字节过滤，不做文本解码：UTF-8 / BOM / 非 UTF-8 文本都不会被改坏。
  const out = Buffer.allocUnsafe(buf.length);
  let n = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a) continue; // 丢 CR，保留后面的 LF
    out[n++] = buf[i];
  }
  return out.subarray(0, n);
}

module.exports = { canonicalBytes };
