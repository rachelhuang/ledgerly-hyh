#!/usr/bin/env python3
"""
推送脚本：绕过 git push 走 GitHub API。

关键设计：**所有文件合并成 1 个 commit**（Git Data API）。
旧版逐文件 PUT 会产生 N 个 commit → 触发 N 次 Pages 部署 → 18 秒内并发 13 个
workflow 会被 GitHub 限流（startup_failure）。

用法：
    export TOKEN=ghp_xxxx
    python3 push.py
"""
import os, sys, base64, json, urllib.request, urllib.error

REPO = 'rachelhuang/ledgerly-hyh'
BRANCH = 'main'
API = f'https://api.github.com/repos/{REPO}'

# 要推送的文件
FILES = [
    'app.bundle.js',
    'service-worker.js',
    'index.html',
    'manifest.webmanifest',
    'styles.css',
    'js/db.js',
    'js/settings.js',
    'js/llm.js',
    'js/speech.js',
    'js/util.js',
    'js/views/input.js',
    'js/views/records.js',
    'js/views/stats.js',
    'js/views/settings.js',
    'build.py',
    'push.py',
]

COMMIT_MSG = 'feat: 更新 Ledgerly PWA（批量提交）'


def load_token():
    candidates = [
        os.environ.get('TOKEN', ''),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '.token'),
        os.path.expanduser('~/.github_token'),
    ]
    for p in candidates:
        if not p:
            continue
        if os.path.isfile(p):
            with open(p) as f:
                t = f.read().strip()
        else:
            t = p.strip()
        if t:
            return t
    return ''


TOKEN = load_token()
if not TOKEN:
    print('ERROR: 找不到 GitHub PAT。')
    print('  export TOKEN=ghp_xxxx')
    print('  或 echo "ghp_xxxx" > ~/.github_token')
    sys.exit(1)

HEADERS = {
    'Authorization': f'token {TOKEN}',
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'ledgerly-push',
    'Content-Type': 'application/json',
}


def api(path, method='GET', data=None):
    req = urllib.request.Request(API + path, method=method, headers=HEADERS)
    if data is not None:
        req.data = json.dumps(data).encode()
    try:
        with urllib.request.urlopen(req) as r:
            body = r.read().decode()
            return r.status, (json.loads(body) if body else {})
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def main():
    root = os.path.dirname(os.path.abspath(__file__))

    # 1) 拿当前 main 分支的 HEAD commit + tree
    code, ref = api(f'/git/ref/heads/{BRANCH}')
    if code != 200:
        print(f'ERROR: 读取 branch 失败 ({code}): {ref.get("message")}')
        sys.exit(1)
    base_commit_sha = ref['object']['sha']

    code, commit = api(f'/git/commits/{base_commit_sha}')
    if code != 200:
        print(f'ERROR: 读取 commit 失败 ({code})')
        sys.exit(1)
    base_tree_sha = commit['tree']['sha']
    print(f'当前 HEAD: {base_commit_sha[:7]}  tree: {base_tree_sha[:7]}')

    # 2) 为每个文件创建 blob
    tree_entries = []
    for path in FILES:
        full = os.path.join(root, path)
        if not os.path.exists(full):
            print(f'  SKIP (不存在): {path}')
            continue
        with open(full, 'rb') as f:
            b64 = base64.b64encode(f.read()).decode()
        code, blob = api('/git/blobs', 'POST', {'content': b64, 'encoding': 'base64'})
        if code not in (200, 201):
            print(f'  ERR blob {path}: {code} {blob.get("message")}')
            continue
        tree_entries.append({
            'path': path,
            'mode': '100644',
            'type': 'blob',
            'sha': blob['sha'],
        })
        print(f'  blob: {path}')

    if not tree_entries:
        print('ERROR: 没有可提交的文件')
        sys.exit(1)

    # 3) 创建新 tree
    code, tree = api('/git/trees', 'POST', {
        'base_tree': base_tree_sha,
        'tree': tree_entries,
    })
    if code not in (200, 201):
        print(f'ERROR: 创建 tree 失败 ({code}): {tree.get("message")}')
        sys.exit(1)

    # 4) 创建单个 commit
    code, new_commit = api('/git/commits', 'POST', {
        'message': COMMIT_MSG,
        'tree': tree['sha'],
        'parents': [base_commit_sha],
    })
    if code not in (200, 201):
        print(f'ERROR: 创建 commit 失败 ({code}): {new_commit.get("message")}')
        sys.exit(1)
    print(f'新 commit: {new_commit["sha"][:7]}')

    # 5) 更新 main 分支指针（这一步才会触发 1 次 Pages 部署）
    code, updated = api(f'/git/refs/heads/{BRANCH}', 'PATCH', {
        'sha': new_commit['sha'],
        'force': False,
    })
    if code not in (200, 201):
        print(f'ERROR: 更新分支失败 ({code}): {updated.get("message")}')
        sys.exit(1)

    print()
    print(f'✅ 推送完成（1 个 commit，触发 1 次部署）')
    print(f'   https://github.com/{REPO}/commit/{new_commit["sha"]}')
    print('   GitHub Pages 将在 1-2 分钟内自动部署。')


if __name__ == '__main__':
    main()
