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


def extract_exports(src: str) -> list:
    """从源文件里抽取出所有 export 出去的顶层声明名"""
    names = []
    for line in src.splitlines():
        m = re.match(r'^export\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)', line)
        if m:
            names.append(m.group(1))
            continue
        m = re.match(r'^export\s+(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)', line)
        if m:
            names.append(m.group(1))
            continue
    return names


def extract_view_imports(src: str) -> str:
    """
    从 view 模块源文件里提取 import 语句，生成对应的解构代码，
    注入到 IIFE 顶部，让 view 模块原样用 DB.xxx / Settings.xxx / Speech.xxx / etc 不需要改。

    返回类似：
        const { el, fmtMoney } = window.Util;
        const { Settings } = window;
        const DB = window.DB;
    """
    lines = []
    for raw in src.splitlines():
        raw = raw.strip()
        if not raw.startswith('import '):
            continue
        # import * as DB from '../db.js'
        m = re.match(r"import\s+\*\s+as\s+(\w+)\s+from\s+['\"]\.\.?/(\w+(?:/\w+)*)\.js['\"]", raw)
        if m:
            ns_name = m.group(1)
            mod_path = m.group(2)
            # 找出对应的 window 全局名
            mod_key = 'js/' + mod_path + '.js'
            if mod_key in MODULE_CONFIG:
                _, win_name = MODULE_CONFIG[mod_key]
                lines.append(f'const {ns_name} = window.{win_name};')
            continue
        # import { Foo, Bar as Baz } from '../xxx.js'
        m = re.match(r"import\s+\{([^}]+)\}\s+from\s+['\"]\.\.?/(\w+(?:/\w+)*)\.js['\"]", raw)
        if m:
            raw_names = [n.strip() for n in m.group(1).split(',')]
            # JS 解构语法用 { Y: X } 而不是 { X as Y }，转一下
            names = []
            for n in raw_names:
                parts = re.split(r'\s+as\s+', n)
                if len(parts) == 2:
                    # import { X as Y } → JS 解构: { X: Y }  (X 是源, Y 是目标)
                    names.append(f'{parts[0]}: {parts[1]}')
                else:
                    names.append(parts[0])
            mod_path = m.group(2)
            mod_key = 'js/' + mod_path + '.js'
            if mod_key in MODULE_CONFIG:
                _, win_name = MODULE_CONFIG[mod_key]
                mode, _ = MODULE_CONFIG[mod_key]
                if mode in ('namespace', 'passthrough'):
                    lines.append(f'const {{ {", ".join(names)} }} = window.{win_name};')
            continue
    return '\n'.join(lines)


# module 文件名 → 暴露方式
#  - "namespace": 装成 { name1, name2, ... } 对象
#  - "passthrough": 单 const 导出，直接 window.X = X
MODULE_CONFIG = {
    'js/db.js':       ('namespace',  'DB'),
    'js/settings.js': ('passthrough', 'Settings'),
    'js/llm.js':      ('namespace',  'LLM'),
    'js/speech.js':   ('namespace',  'Speech'),
    'js/util.js':     ('namespace',  'Util'),
}


def main() -> None:
    out = []

    # 1) 全局模块：去掉 import/export 后，装进 window.<Name> 命名空间
    for m in GLOBAL_MODULES:
        path = ROOT / m
        raw = path.read_text(encoding='utf-8')
        names = extract_exports(raw)
        code = transform(raw)
        mode, ns = MODULE_CONFIG[m]
        if mode == 'namespace':
            exposed = f'window.{ns} = {{ {", ".join(names)} }};\n'
        elif mode == 'passthrough':
            assert len(names) == 1, f'{m} passthrough 模式必须只有一个导出'
            exposed = f'window.{ns} = {names[0]};\n'
        else:
            raise ValueError(f'unknown mode: {mode}')
        out.append(f"// === {m} ===\n{code}\n{exposed}\n")

    # 2) view 模块用 IIFE 包装，末尾把渲染函数挂到 window
    for m, exports_list in IIFE_MODULES:
        path = ROOT / m
        raw = path.read_text(encoding='utf-8')
        code = transform(raw)
        # 注入 import 别名解构（让 view 模块原样的 DB.xxx / Settings.xxx / Speech.xxx 工作）
        injected = extract_view_imports(raw)
        exposed = ''.join(f'window.{name} = {name};\n' for name in exports_list)
        out.append(
            f"// === {m} ===\n(function() {{\n{injected}\n{code}\n{exposed}\n}})();\n"
        )

    bundle_path = ROOT / 'app.bundle.js'
    bundle_path.write_text('\n'.join(out), encoding='utf-8')
    size_kb = bundle_path.stat().st_size / 1024
    print(f"Built {bundle_path.name} ({size_kb:.1f} KB)")


if __name__ == '__main__':
    main()
