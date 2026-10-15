# 速贴（ClipFast）

一款跨平台粘贴板管理工具（Electron 桌面端）。支持 Supabase 邮箱密码登录、自动记录剪贴板文本/链接/代码、分类检索、收藏、深链接密码重置和全局快捷键。

## 下载

| 平台 | 文件 | 说明 |
|------|------|------|
| macOS (Apple Silicon) | `clipFast-1.0.1-arm64.dmg` | 未签名，首次打开需右键 → 打开 |
| Windows x64 | `ClipFast-1.0.1-win-x64.zip` | 解压后运行 ClipFast.exe |

前往 [Releases](https://github.com/Fxxk181126/clipFast/releases) 下载。

## 功能特性
- 自动记录：轮询系统剪贴板文本变化并入库（默认 10 万条上限）
- 智能分类：粗粒度识别为"文本 / 链接 / 代码"三类
- 快捷检索：关键词搜索、类型筛选、仅看收藏
- 快速操作：一键粘贴、收藏/取消收藏、删除、预览
- 新记录提醒：面板隐藏或列表离开顶部时汇总新记录数量，点击回到顶部
- 便捷导航：长列表滚动后一键回到顶部
- 全局快捷键：`Cmd/Ctrl + Shift + V` 显示/隐藏面板
- 本地持久化：使用 `electron-store` 存储记录与设置
- 强制账号：Supabase Auth 邮箱密码注册、登录、会话恢复和退出
- 密码重置：深链接 `clipfast://auth/callback` 回到应用设置新密码
- 认证代理：Cloudflare Worker 隐藏 anon key 并执行 IP 限流

## 架构

```
桌面应用（Electron）
    │
    ▼ HTTPS
Cloudflare Worker（认证代理）
    │  注入 anon key，按 IP 限流
    ▼ HTTPS
Supabase Auth（注册/登录/token 管理）
```

客户端只知道 Worker 地址，不含 Supabase URL 和 anon key。Worker 只放行 5 个 Auth 端点（signup/token/logout/user/recover），并执行以下限流：

| 端点 | 限制 |
|------|------|
| 注册 `/auth/v1/signup` | 5 次/小时/IP |
| 登录/刷新 `/auth/v1/token` | 20 次/分钟/IP |
| 密码重置 `/auth/v1/recover` | 3 次/小时/IP |
| 其他 | 60 次/分钟/IP |

## 开发环境

- Node.js ≥ 22（`nvm use 22`）
- npm

### 快速开始
```bash
# 安装依赖（如遇网络慢，使用镜像变量）
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install

# 配置认证
cp .env.example .env
# 编辑 .env，填入 Supabase URL + anon key（直连模式）
# 或填入 Cloudflare Worker 代理 URL（代理模式，优先级更高）

# 启动应用
npm start
```

应用启动后先完成注册或登录。登录成功后，使用 `Cmd/Ctrl + Shift + V` 调出面板。

### 认证配置

| 环境变量 | 说明 |
|----------|------|
| `CLIPFAST_AUTH_PROXY_URL` | Cloudflare Worker 代理地址（生产模式，设置后忽略下方两项） |
| `CLIPFAST_SUPABASE_URL` | Supabase 项目地址（开发直连模式） |
| `CLIPFAST_SUPABASE_ANON_KEY` | Supabase 公开 anon key 或 publishable key |

`.env` 已被 Git 忽略，不要提交真实凭据。

## 部署 Worker 代理

Worker 源码在 `worker/` 目录，部署到 Cloudflare：
```bash
cd worker
npm install

# 设置 secrets
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY

# （可选）启用 KV 限流
npx wrangler kv namespace create RATE_LIMIT
# 把返回的 id 填入 wrangler.toml

npm run deploy
```

部署后需要在 Supabase Dashboard → Authentication → URL Configuration 中：
1. 将 Worker 地址加入 Redirect URLs
2. 将 `clipfast://auth/callback` 加入 Redirect URLs（密码重置深链接）

## 打包

```bash
# macOS (arm64)
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run dist
# 产物：dist/clipFast-<version>-arm64.dmg

# Windows (x64)
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run dist:win:x64
# 产物：dist/ClipFast-<version>-win-x64.zip
```

> macOS 未签名（无 Apple Developer 证书），首次打开需右键 → 打开。

## 测试

```bash
npm test
```

## 项目结构
```
clipFast/
├─ worker/             # Cloudflare Worker 认证代理
│  ├─ index.js         # 代理逻辑（白名单 + 限流 + 转发）
│  ├─ wrangler.toml    # 部署配置
│  └─ README.md        # 部署步骤
├─ renderer/           # 渲染层（面板 UI）
│  ├─ index.html
│  ├─ renderer.js
│  └─ style.css
├─ src/
│  ├─ auth.js          # Supabase Auth 服务与加密 session 存储
│  ├─ clipboard.js     # 剪贴板轮询、分类与入库
│  └─ ipc-channels.js  # IPC 通道单一真身
├─ main.js             # 主进程，窗口/快捷键/IPC/深链接
├─ preload.js          # 预加载，暴露安全 API
├─ test/               # Node.js 内建测试
├─ package.json        # 脚本与 electron-builder 配置
└─ .gitignore
```

## 权限

- macOS 一键粘贴需在"系统设置 → 隐私与安全 → 辅助功能"中授权
- Windows/Linux 写入剪贴板后需手动粘贴

## 常见问题

- Electron 下载超时：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
- macOS 深链接无效：安装 DMG 后 `clipfast://` 协议会自动注册，如仍无效请重启系统
- 列表渲染性能：前端一次最多返回 500 条，继续输入关键词过滤

## 许可证

MIT
