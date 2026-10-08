# Ledgerly PWA

自然语言记账的 iOS App 同时提供的 **网页版 / PWA 版本**。功能与 iOS 原生版完全一致：

- 文本 / 语音 / 图片 三种入口记一笔
- LLM（OpenAI 兼容）抽取 → 自动写入数据库
- 按周 / 月 / 年 切换统计，含折线图与 Top 10
- 列表 + 时间段筛选 + 搜索 + 删除
- LLM 配置（Base URL / API Key / Model）+ 一键测试
- 数据存储于浏览器 **IndexedDB**，刷新不丢

## 文件结构

```
Ledgerly-PWA/
├── index.html
├── manifest.webmanifest
├── service-worker.js
├── styles.css
├── icons/
│   ├── icon.svg
│   ├── icon-192.png
│   └── icon-512.png
└── js/
    ├── app.js              入口 + Tab 路由
    ├── db.js               IndexedDB 包装
    ├── settings.js         BaseURL / APIKey / Model 存储
    ├── llm.js              OpenAI 兼容客户端
    ├── speech.js           Web Speech API 封装
    ├── util.js             公共工具函数
    └── views/
        ├── input.js        记一笔
        ├── stats.js        统计（两级 Tab + Canvas 折线）
        ├── records.js      明细
        └── settings.js     设置
```

## 在本地跑

任意静态服务器都行（不能直接 `file://` 打开，因为 Service Worker 必须 HTTPS 或 localhost）。

### 方式 A：Python 一行起服务

```bash
cd Ledgerly-PWA
python3 -m http.server 8080
```

浏览器打开 http://localhost:8080

### 方式 B：Node.js

```bash
cd Ledgerly-PWA
npx serve -l 8080
```

### 方式 C：放到 GitHub Pages / Cloudflare Pages / Vercel

只要是个静态托管即可，不需要后端。部署后用 HTTPS 域名访问。

## 添加到 iPhone 桌面

1. Safari 打开部署好的网址（**必须 Safari**）
2. 点底部「分享」按钮（带向上箭头的方框）
3. 选 **「添加到主屏幕」**
4. 名称改「Ledgerly」，点添加

之后桌面会出现一个 Ledgerly 图标，点进去就是全屏 PWA，**没有 Safari 地址栏**，体验接近原生 App。

## 添加到 Android 桌面

Chrome 打开网址 → 右上角菜单 → 「添加到主屏幕」。

## 首次使用

1. 打开 App，默认在「记一笔」Tab
2. 切到「设置」Tab，填写：
   - **Base URL**：例如 `https://api.openai.com/v1`、`https://api.deepseek.com/v1`
   - **API Key**：对应服务的密钥
   - **Model**：例如 `gpt-4o-mini`、`deepseek-chat`
3. 点「测试连接」确认可用
4. 切回「记一笔」Tab，输入「今天午餐 35 元」→ 点保存
5. 切到「统计」或「明细」看结果

## 与 iOS 原生版的差异

| 项 | iOS 原生版 | PWA 版 |
|---|---|---|
| 数据存储 | SwiftData（系统级 SQLite）| IndexedDB（浏览器级）|
| API Key | Keychain | localStorage |
| 语音识别 | Apple Speech（SFSpeechRecognizer）| Web Speech API（Chromium / WebKit）|
| 图片识别 | OpenAI 兼容（多模态）| OpenAI 兼容（多模态）|
| 折线图 | Swift Charts（系统原生）| 手写 Canvas（自带 Bezier 平滑 + 触摸浮窗）|
| 后台运行 | 支持 | 受限（浏览器后台冻结）|
| 推送通知 | 支持（需配置 APNs）| 不支持 |
| 离线使用 | 部分 | 完整（PWA + Service Worker 缓存）|

## 浏览器兼容性

- **Safari iOS 16.4+**：PWA 安装、语音识别、IndexedDB 全部支持
- **Chrome / Edge 桌面版**：完整支持
- **Firefox 桌面版**：语音识别支持有限（Chromium-based 才有）
- **微信内置浏览器**：受限，建议复制链接到 Safari / Chrome

## 开发提示

如果想本地修改样式 / 加功能：

1. 修改 `js/views/*.js` 对应视图模块
2. 修改 `styles.css` 加样式
3. 修改 `service-worker.js` 里的 `CACHE` 版本号（`'ledgerly-v1'` → `'ledgerly-v2'`），否则浏览器还加载旧缓存
4. 浏览器开发者工具 → Application → Service Workers → **Unregister**，然后刷新

## 已知限制

- 折线图是手写 Canvas，悬浮窗定位精度不如 Swift Charts（特别是「本年」按月聚合时，触摸定位用最近的 month 近似）
- 语音识别在 Safari iOS 必须用户先有麦克风权限交互才会弹窗
- Service Worker 缓存策略是 cache-first，断网时仍可用，但**首次加载必须联网**

## License

MIT
