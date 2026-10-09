#!/usr/bin/env python3
"""
Build script: 把所有 .js 模块合并成一个 app.bundle.js，
去掉 ES module 语法（import/export），并用 IIFE 隔离 view 模块的作用域。

用法: python3 build.py
"""
import re
from pathlib import Path

ROOT = Path(__file__).parent

# 不需要 IIFE 隔离的模块（无内部状态冲突，作为全局对象）
GLOBAL_MODULES = [
    'js/db.js',
    'js/settings.js',
    'js/llm.js',
    'js/speech.js',
    'js/util.js',
]

# 需要 IIFE 隔离的模块（每个 view 内部有同名 let 变量）
IIFE_MODULES = [
    'js/views/input.js',
    'js/views/stats.js',
    'js/views/records.js',
    'js/views/settings.js',
    'js/app.js',
]


def transform(src: str) -> str:
    # 去掉 import ... from ...
    src = re.sub(r'^import\s.+?;\s*$', '', src, flags=re.MULTILINE)
    # 去掉 export 前缀（包括 export default / export async function 等）
    src = re.sub(r'^export\s+(default\s+)?', '', src, flags=re.MULTILINE)
    return src


def main() -> None:
    out = []
    for m in GLOBAL_MODULES:
        path = ROOT / m
        code = path.read_text(encoding='utf-8')
        out.append(f"// === {m} ===\n{transform(code)}\n")

    for m in IIFE_MODULES:
        path = ROOT / m
        code = path.read_text(encoding='utf-8')
        out.append(f"// === {m} ===\n(function() {{\n{transform(code)}\n}})();\n")

    bundle_path = ROOT / 'app.bundle.js'
    bundle_path.write_text('\n'.join(out), encoding='utf-8')
    size_kb = bundle_path.stat().st_size / 1024
    print(f"Built {bundle_path.name} ({size_kb:.1f} KB)")


if __name__ == '__main__':
    main()
