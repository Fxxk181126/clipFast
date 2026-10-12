# 速贴（ClipFast）

一款跨平台粘贴板管理工具。当前仓库为桌面端（Electron）核心验证版本，支持强制账号登录、自动记录文本、分类检索、收藏、删除、预览与全局快捷键调出面板。

## 功能特性
- 自动记录：轮询系统剪贴板文本变化并入库（默认 10 万条上限）
- 智能分类：粗粒度识别为“文本 / 链接 / 代码”三类
- 快捷检索：关键词搜索、类型筛选、仅看收藏
- 快速操作：一键粘贴、收藏/取消收藏、删除、预览
- 全局快捷键：`Cmd/Ctrl + Shift + V` 显示/隐藏面板
- 本地持久化：使用 `electron-store` 存储记录与设置
- 强制账号：Supabase Auth 邮箱密码注册、登录、会话恢复和退出

## 运行环境
- Node.js：建议使用 LTS
- macOS：已验证；Windows/Linux 后续增强粘贴自动触发

## 快速开始
```bash
# 安装依赖（如遇网络慢，使用镜像变量）
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install

# 配置 Supabase 项目中的公开 anon key 或新版 publishable key（不要使用 service_role/secret key）
cp .env.example .env
# 编辑 .env，填入 Supabase Project URL 和公开 anon key / publishable key

# 启动应用
npm start
```

应用启动后先完成注册或登录。登录成功后，使用 `Cmd/Ctrl + Shift + V` 调出面板。复制任意文本会在约 0.75s 内出现在列表中。

## 测试

```bash
npm test
```

## 打包发布
已集成 `electron-builder`，产物输出到 `dist/`。

- 打包 macOS（arm64）：
```bash
npm run dist
# 产物：dist/速贴 ClipFast-<version>-arm64.dmg
```

- 打包 Windows（x64 压缩包）：
```bash
# 如遇 Electron 下载超时，请加镜像变量
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run dist:win:x64
# 产物：dist/ClipFast-<version>-win-x64.zip
```

- 打包 Windows（ARM64 压缩包，可选）：
```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run dist:win
# 产物：dist/ClipFast-<version>-win-arm64.zip（若已配置 artifactName）
```

> 说明：在 macOS 上交叉打包 Windows 压缩包无需代码签名；若需要安装器（NSIS .exe），需安装 `wine` 并在 `build.win.target` 中启用 `nsis`。

## 权限与系统提示
- macOS 一键粘贴：首次使用可能提示“辅助功能”权限。请在“系统设置 → 隐私与安全 → 辅助功能”中允许 Electron/速贴 ClipFast 进行操作。
- Windows/Linux：当前版本写入剪贴板后，需手动触发粘贴；后续将增加系统级快捷键模拟。

## 配置项
认证配置通过环境变量注入：
- `CLIPFAST_SUPABASE_URL`：Supabase 项目地址
- `CLIPFAST_SUPABASE_ANON_KEY`：Supabase 公开 anon key，或新版项目的 public publishable key

开发时也可以把上述变量写入项目根目录 `.env`；该文件已被 Git 忽略，不要提交真实密钥。

Supabase 项目建议开启邮箱确认，并将最小密码长度设置为 8。

应用配置保存在 `electron-store` 默认文件（用户目录）中：
- `settings.maxRecords`：最多保留记录条数，默认 `100000`
- `settings.panel.width/height`：窗口尺寸，默认 `900 × 600`
- `settings.shortcut`：调出面板快捷键，默认 `CommandOrControl+Shift+V`

> 当前未提供设置入口；主进程已实现 `settings:setShortcut` IPC，可在后续版本提供界面更改。

## 数据与安全
- Supabase session 只保存在主进程；渲染进程只能读取脱敏后的用户信息。
- `safeStorage` 可用时，refresh session 加密后保存在独立的 `clipfast-auth` 存储中。
- `safeStorage` 不可用时 session 只保留在内存中，重启应用需要重新登录。
- 剪贴板历史仍保存在当前设备本地；不同设备登录同一账号不会共享历史。

## 项目结构
```
clipFast/
├─ renderer/          # 渲染层（面板 UI）
│  ├─ index.html
│  ├─ renderer.js
│  └─ style.css
├─ src/
│  ├─ auth.js         # Supabase Auth 服务与加密 session 存储
│  ├─ clipboard.js    # 剪贴板轮询、分类与入库
│  └─ ipc-channels.js # IPC 通道单一真身
├─ main.js            # 主进程，窗口/快捷键/IPC/持久化
├─ preload.js         # 预加载，暴露安全 API
├─ test/               # Node.js 内建测试
├─ package.json       # 脚本与打包配置
├─ .gitignore
└─ README.md
```

## 常见问题
- Electron/依赖下载超时：
  - 运行命令前设置镜像：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
  - 或为 npm 配置国内源：`npm config set registry https://registry.npmmirror.com`
- 一键粘贴未生效（macOS）：
  - 确认已授予“辅助功能”权限；重新尝试后生效
- 列表项过多渲染性能：
  - 前端列表一次最多返回 500 条；继续输入关键词精确过滤

## 迭代计划（V1.0 后续）
- 图片与文件记录支持（缩略图/图标）
- 文本编辑与保存新记录、批量操作与导出 TXT/CSV
- 清理规则（按时间/类型/大小）与标签管理
- Windows/Linux 的自动粘贴触发

## 许可证
MIT
