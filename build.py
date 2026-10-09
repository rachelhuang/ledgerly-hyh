#!/usr/bin/env python3
"""
Build script: 把所有 .js 模块合并成一个 app.bundle.js，
去掉 ES module 语法，用 IIFE 隔离 view 模块作用域，
并在 view 模块 IIFE 末尾把渲染函数挂到 window 上供 app.js 调用。

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
# IIFE 末尾需要把渲染函数挂到 window
IIFE_MODULES = [
    ('js/views/input.js',     ['renderInput']),
    ('js/views/stats.js',      ['renderStats']),
    ('js/views/records.js',    ['renderRecords']),
    ('js/views/settings.js',   ['renderSettings']),
    ('js/app.js',              ['setActiveTab']),  # setActiveTab 是按钮 click 触发的入口
]


def transform(src: str) -> str:
    # 去掉 import ... from ...
    src = re.sub(r'^import\s.+?;\s*$', '', src, flags=re.MULTILINE)
    # 去掉 export 前缀（包括 export default / export async function 等）
    src = re.sub(r'^export\s+(default\s+)?', '', src, flags=re.MULTILINE)
    return src


def main() -> None:
    out = []

    # 1) 全局模块直接拼
    for m in GLOBAL_MODULES:
        path = ROOT / m
        code = path.read_text(encoding='utf-8')
        out.append(f"// === {m} ===\n{transform(code)}\n")

    # 2) view 模块用 IIFE 包装，末尾把渲染函数挂到 window
    for m, exports_list in IIFE_MODULES:
        path = ROOT / m
        code = path.read_text(encoding='utf-8')
        exposed = ''.join(f'window.{name} = {name};\n' for name in exports_list)
        out.append(
            f"// === {m} ===\n(function() {{\n{transform(code)}\n{exposed}\n}})();\n"
        )

    bundle_path = ROOT / 'app.bundle.js'
    bundle_path.write_text('\n'.join(out), encoding='utf-8')
    size_kb = bundle_path.stat().st_size / 1024
    print(f"Built {bundle_path.name} ({size_kb:.1f} KB)")


if __name__ == '__main__':
    main()
