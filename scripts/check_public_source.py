"""Scan release sources without printing matched values. Standard library only."""
from pathlib import Path
import json
import hashlib
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SKIP = {'.git', 'node_modules', 'venv', '.venv', '__pycache__'}
RULES = {
    'private-key': re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    'provider-key': re.compile(r'\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b'),
    'aws-key': re.compile(r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b'),
    'user-home': re.compile(r'(?i)[a-z]:[\\/]+Users[\\/]+(?!Public\b|Default\b|example\b|fixture\b|test\b|user\b|you\b|alice\b|tester\b|me\b)[\w.-]+'),
}
BLOCKED_NAMES = {'models.json', 'settings.json', 'workflow.json', 'workbuddy.json',
                 'zcode.json', 'endpoint-access.json', 'execution-endpoints.json',
                 'project-index.json', 'budget-ledger.json', '.env'}
BLOCKED_PARTS = {'.model-desk', 'runs', 'review-backups', 'dsh-home',
                 '.smoke-result.json.workspace'}
RUNTIME_SUFFIXES = {'.db', '.sqlite', '.log', '.png', '.jpg', '.zip', '.exe', '.lnk'}
# 随仓库自带的合法二进制素材（角色序列帧、字体等）。它们本来就不是文本，
# 逐个报 unreadable-or-binary 会让校验永远返回非零，反而掩盖真正意外的二进制文件。
# 未知扩展名仍走 read_text 失败告警，检测能力没有去掉。
BINARY_SUFFIXES = {'.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.pdf', '.pyc'}

def canonical_bytes(raw: bytes) -> bytes:
    """Match desktop/source-manifest-bytes.cjs so the manifest verifies on any OS.

    core.autocrlf differs per machine: the same git blob is CRLF on Windows and LF on
    Linux. Normalize text to LF; leave binary (NUL-containing) bytes untouched.
    """
    if b'\0' in raw:
        return raw
    return raw.replace(b'\r\n', b'\n')


def main():
    manifest = ROOT / 'SOURCE-MANIFEST.json'
    entries = []
    manifest_data = {}
    if manifest.exists():
        manifest_data = json.loads(manifest.read_text(encoding='utf-8'))
        entries = manifest_data['files']
        paths = [ROOT / row['path'] for row in entries]
    else:
        paths = [p for p in ROOT.rglob('*') if p.is_file() and not set(p.relative_to(ROOT).parts) & SKIP]
    findings = []
    if manifest.exists():
        # 旧清单按工作区原始字节算哈希，换台机器会全量 mismatch。明确报出来，
        # 别把「规则换了」误报成「源码被改了」。
        if not str(manifest_data.get('hashing', '')).startswith('sha256 over LF-normalized'):
            findings.append({'path':'SOURCE-MANIFEST.json', 'rule':'manifest-hashing-rule-missing-or-old'})
        for row in entries:
            file = (ROOT / row['path']).resolve()
            if not file.is_relative_to(ROOT) or not file.is_file():
                findings.append({'path':row['path'], 'rule':'missing-or-outside-source-root'})
            elif hashlib.sha256(canonical_bytes(file.read_bytes())).hexdigest() != row['sha256']:
                findings.append({'path':row['path'], 'rule':'manifest-hash-mismatch'})
        if findings:
            print(json.dumps({'files':len(paths), 'findings':findings}, ensure_ascii=True))
            return True
    for p in paths:
        rel = p.relative_to(ROOT).as_posix()
        if p.name in BLOCKED_NAMES or set(p.relative_to(ROOT).parts) & BLOCKED_PARTS or p.suffix.lower() in RUNTIME_SUFFIXES:
            findings.append({'path':rel, 'rule':'runtime-or-personal-artifact'})
            continue
        if p.suffix.lower() in BINARY_SUFFIXES:
            continue
        try:
            content = p.read_text(encoding='utf-8-sig')
        except (UnicodeError, OSError):
            findings.append({'path':rel, 'rule':'unreadable-or-binary'})
            continue
        for number, line in enumerate(content.splitlines(), 1):
            for name, pattern in RULES.items():
                if pattern.search(line):
                    findings.append({'path':rel, 'line':number, 'rule':name})
    print(json.dumps({'files':len(paths), 'findings':findings}, ensure_ascii=True))
    return bool(findings)

if __name__ == '__main__':
    sys.exit(main())
