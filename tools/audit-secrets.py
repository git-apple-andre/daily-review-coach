#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""敏感信息审计：报告 文件:行号 + 类型 + 掩码样本。绝不打印完整真值。"""
import os, re, sys
from collections import defaultdict

ROOT = sys.argv[1] if len(sys.argv) > 1 else "."
SKIP_DIRS = {".git", "node_modules", ".superpowers"}

PATTERNS = [
    ("GitHub PAT",      re.compile(r"github_pat_[A-Za-z0-9_]{20,}")),
    ("GitHub token",    re.compile(r"gh[pousr]_[A-Za-z0-9]{30,}")),
    ("OpenAI/LLM key",  re.compile(r"sk-[A-Za-z0-9_\-]{16,}")),
    ("Anthropic key",   re.compile(r"sk-ant-[A-Za-z0-9_\-]{16,}")),
    ("飞书 chat_id",     re.compile(r"oc_[a-f0-9]{16,}")),
    ("飞书 open_id",     re.compile(r"ou_[a-f0-9]{16,}")),
    ("飞书 user_id",     re.compile(r"(?<!_)\bu_[a-f0-9]{12,}")),
    ("App Secret 字段",  re.compile(r"(?i)(app_?secret|appSecret)\"?\s*[:=]\s*\"?([A-Za-z0-9]{16,})")),
    ("Bearer token",    re.compile(r"(?i)bearer\s+[A-Za-z0-9_\-\.]{20,}")),
    ("私钥块",           re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("URL+token",       re.compile(r"https?://[^\s\"'<>]*[?&](token|key|secret|access_token)=[^\s\"'<>&]{8,}")),
    ("手机号",           re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")),
    ("邮箱",             re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")),
    ("身份证号",         re.compile(r"(?<!\d)\d{17}[\dXx](?!\d)")),
    ("腾讯云 SCF 网关",   re.compile(r"https?://[a-z0-9\-]+\.ap-[a-z]+\.tencentcs\.com[^\s\"'<>]*")),
    ("其他 HTTPS 外链",   re.compile(r"https?://[^\s\"'<>\)\]]{10,}")),
]

def mask(s):
    s = s.strip()
    if len(s) <= 8:
        return s[:2] + "*" * max(len(s) - 2, 0)
    return f"{s[:6]}…*[{len(s)}字符]"

hits = defaultdict(list)
scanned = 0
for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
    for fn in filenames:
        if fn.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".pdf", ".zip", ".gz")):
            continue
        p = os.path.join(dirpath, fn)
        try:
            text = open(p, encoding="utf-8", errors="ignore").read()
        except Exception:
            continue
        scanned += 1
        rel = os.path.relpath(p, ROOT)
        for lineno, line in enumerate(text.splitlines(), 1):
            for name, rx in PATTERNS:
                for m in rx.finditer(line):
                    val = m.group(0)
                    hits[name].append((rel, lineno, mask(val)))

print(f"扫描 {scanned} 个文本文件\n")
for name, rows in sorted(hits.items(), key=lambda kv: -len(kv[1])):
    print(f"── {name}：{len(rows)} 处")
    # 按文件聚合，最多展示 6 个文件
    byfile = defaultdict(list)
    for rel, ln, mv in rows:
        byfile[rel].append((ln, mv))
    for rel in sorted(byfile)[:6]:
        items = byfile[rel]
        lns = ", ".join(str(l) for l, _ in items[:8])
        more = f" …(+{len(items)-8})" if len(items) > 8 else ""
        print(f"   {rel}  行 {lns}{more}")
        print(f"      样本: {items[0][1]}")
    if len(byfile) > 6:
        print(f"   …另有 {len(byfile)-6} 个文件")
    print()
