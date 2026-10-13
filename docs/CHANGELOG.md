# Changelog

本文档记录 AI 产生的项目变更。日期格式为 `YYYY-MM-DD`。

## 2026-10-13

### 2026-10-13 变更简化复审（/simplify）

- **refactor**: 提取 `assertPasswordStrength` 供 `validateCredentials` 与 `updatePassword` 共用，消除同文件三处弱密码校验重复（与既有 `normalizeEmail` 对称）。
  - 受影响模块：`src/auth.js`
- **refactor**: 恢复深链退化为纯布尔信号——`parseRecoveryUrl` 改为 `isRecoveryUrl`（token 在渲染层无消费者，事件不携带死数据）；两处手写窗口发送守卫统一复用 `broadcast()`，消除同文件第三种发送惯用法；自定义协议注册加 `isDefaultProtocolClient` 守卫，避免每次启动重复写 OS 注册。
  - 受影响模块：`main.js`、`preload.js`
- **refactor**: Worker 放行路由与限流规则由两张平行表合并为单一 `ROUTES` 表，一次前缀匹配同时完成放行判断与限流规则解析，删除 `resolveRateLimit`（新增路由不再需要同步改两处）。
  - 受影响模块：`worker/index.js`
- **refactor**: 渲染层简化——`#authTabs` 由内联 `style.display` 改为与其他表单一致的 `hidden` 属性；提取 `passwordsMatch` 消除注册/重置两处逐字重复的"两次密码不一致"校验；空状态由双层结构收敛为单元素。
  - 受影响模块：`renderer/renderer.js`
- **style**: 删除 `.empty-title` 规则（字号/字重并入 `.empty-state`，`margin-bottom` 无兄弟元素属死样式）；色差肉眼不可辨且语义角色相同的 `--accent-border-soft` 并入 `--accent-border`。
  - 受影响模块：`renderer/style.css`

## 2026-10-12

- **chore**: 版本号升级到 1.0.0，通过 PR #1 合并到 main，打 tag `v1.0.0`，构建 macOS arm64 DMG 和 Windows x64 ZIP，发布到 GitHub Releases。
  - 受影响模块：`package.json`、`dist/clipFast-1.0.0-arm64.dmg`、`dist/ClipFast-1.0.0-win-x64.zip`
- **fix**: 打包后认证配置丢失——Worker 代理 URL 硬编码为生产默认值，不再依赖 `.env` 文件；开发时通过 `.env` 设置 `CLIPFAST_AUTH_PROXY_URL` 可覆盖。
  - 受影响模块：`main.js`
- **feat**: 实现 `clipfast://auth/callback` 深链接密码重置流程——Electron 注册自定义协议并监听 `open-url`/`second-instance` 事件；密码重置邮件的 `redirectTo` 指向深链接；渲染层新增"设置新密码"表单；`package.json` 声明协议注册。
  - 受影响模块：`main.js`、`src/auth.js`、`src/ipc-channels.js`、`preload.js`、`renderer/index.html`、`renderer/renderer.js`、`package.json`
- **chore**: Worker 限流生效——创建 Cloudflare KV namespace `RATE_LIMIT`（id: `17f720c55b4740949f67bc6a1634c189`）并绑定到 `wrangler.toml`，注册 5 次/小时/IP、登录 20 次/分钟/IP、重置 3 次/小时/IP。
  - 受影响模块：`worker/wrangler.toml`
- **chore**: 部署 Cloudflare Worker 认证代理到 `clipfast-auth-proxy.clipfast-auth-proxy.workers.dev`，注入 SUPABASE_URL 和 SUPABASE_ANON_KEY secrets；端到端注册请求验证通过（HTTP 200，返回有效 JWT）。`.env` 和 `.env.example` 已启用 `CLIPFAST_AUTH_PROXY_URL`。
  - 受影响模块：`worker/index.js`、`worker/wrangler.toml`、`.env`、`.env.example`、`docs/CHANGELOG.md`
- **feat**: 新增 Cloudflare Worker 认证代理层，生产环境通过 `CLIPFAST_AUTH_PROXY_URL` 将 Supabase Auth 请求路由至 Worker，由 Worker 注入 anon key 并执行 IP 限流，客户端不再暴露 Supabase URL 和 anon key。
  - 受影响模块：`worker/index.js`（新增）、`worker/wrangler.toml`（新增）、`worker/package.json`（新增）、`worker/README.md`（新增）、`main.js`、`.env.example`
- **refactor**: 简化认证与启动路径——启动会话恢复统一走 `handleAuthChanged` 且不再阻塞快捷键/托盘注册；受保护 IPC 改用内存态 `currentUser` 检查，移除每次调用触发的 session 磁盘读取与解密；删除仅剩单调用者的 `requireAuthenticatedUser` 与 `assertAuthenticatedSession`。
  - 受影响模块：`main.js`、`src/auth.js`、`test/auth-service.test.js`
- **refactor**: 邮箱规范化校验提取 `normalizeEmail` 供登录与密码重置复用，消除同文件两处重复。
  - 受影响模块：`src/auth.js`
- **refactor**: 渲染层清理——删除 `escapeHtml` 死代码；空状态统一为 `empty-state` 结构（原 `placeholder` 类无对应样式）；`timeAgo` 改布尔分支；操作按钮图标预计算为 `ACTION_ICONS`，避免每张卡片重复正则替换。
  - 受影响模块：`renderer/renderer.js`
- **refactor**: 样式清理——删除无引用的 `.brand-mark` 规则与冗余 `font-weight` 分组；合并账号菜单与账号卡片的逐字重复规则；强调/危险色散落字面量收敛为 `:root` token（`--accent-border`、`--danger-hover`、`--text-faint` 等），焦点光环改用 `color-mix(var(--accent))`。
  - 受影响模块：`renderer/style.css`
- **test**: 新增沙箱 preload 内联 IPC 通道表与 `src/ipc-channels.js` 的深度相等断言，把"两处需同步修改"的手工约定变为机器强制。
  - 受影响模块：`test/workspace-ui.test.js`
- **fix**: 点击叉号时隐藏托盘面板，确保关闭后第一次快捷键即可唤起。
  - 受影响模块：`main.js`、`test/workspace-ui.test.js`
- **fix**: 登录页和侧栏品牌标识改用产品图标，替换字母 C 占位符。
  - 受影响模块：`renderer/index.html`、`renderer/style.css`、`test/workspace-ui.test.js`
- **fix**: 将工作区最小窗口宽度提高到 800px，避免 700-780px 区间进入折叠布局并造成账号菜单溢出。
  - 受影响模块：`main.js`、`test/workspace-ui.test.js`
- **fix**: 修复窄窗口折叠侧栏下账号菜单向左溢出的问题，改由侧栏内侧向右展开。
  - 受影响模块：`renderer/style.css`、`test/workspace-ui.test.js`
- **style**: 将账号入口移到侧栏底部账号卡片，登录后展示邮箱和头像缩写；账号菜单改为向上弹出，窄窗口收缩为圆形头像入口，并替换“全部”分类图标避免与“文本”重复。
  - 受影响模块：`renderer/index.html`、`renderer/style.css`、`renderer/renderer.js`、`test/workspace-ui.test.js`
- **fix**: 应用启动时先创建并显示主窗口，再恢复认证会话；修复 Electron 42 下 `ready-to-show` 未触发导致进程存在但界面不可见的问题。
  - 受影响模块：`main.js`
- **style**: 按 Figma 设计方向重做登录页与剪贴板工作区 UI，新增品牌分栏登录页、紧凑分类侧栏、记录行悬停操作、账号菜单、时间显示和应用内删除确认弹窗；窗口收窄时保持图标化导航并消除横向溢出。
  - 受影响模块：`renderer/index.html`、`renderer/renderer.js`、`renderer/style.css`
- **fix**: 登录初始化改为先显示登录骨架，再恢复会话；会话桥接或状态读取失败时展示明确错误，避免认证初始化期间出现空白窗口。
  - 受影响模块：`renderer/renderer.js`
- **fix**: Supabase 配置缺失时在登录、注册和重置表单间保持配置错误提示，避免用户只看到提交按钮禁用却不知道原因。
  - 受影响模块：`renderer/renderer.js`
- **chore**: 支持从项目根目录 `.env` 加载认证配置，并新增 `.env.example` 和配置说明；真实配置文件保持 Git 忽略。
  - 受影响模块：`main.js`、`.env.example`（新增）、`README.md`

## 2026-10-10

- **feat**: 增加强制 Supabase Auth 邮箱密码登录，覆盖注册、登录、退出、会话恢复和忘记密码；登录前不启动剪贴板监控，记录类 IPC 增加认证保护。
  - 受影响模块：`src/auth.js`（新增）、`main.js`、`preload.js`、`src/ipc-channels.js`、`renderer/index.html`、`renderer/renderer.js`、`renderer/style.css`
- **test**: 新增认证服务、脱敏用户、确认注册、密码重置、退出和加密会话存储测试；新增 `npm test` 脚本。
  - 受影响模块：`test/auth-service.test.js`（新增）、`package.json`
- **docs**: 补充 Supabase 环境变量、账号安全边界和测试说明。
  - 受影响模块：`README.md`、`docs/CHANGELOG.md`
- **docs**: 说明环境变量兼容 Supabase 新版 public publishable key。
  - 受影响模块：`README.md`、`docs/CHANGELOG.md`

## 2026-10-09

- **build**: 将开发依赖 Electron 从 31.7.7 升级到 42.3.0，解决旧运行时被 macOS 安全机制拦截的问题；本地启动需使用 Node.js 22 或更高版本。
  - 受影响文件：`package.json`、`package-lock.json`

### 2026-10-09 全项目简化重构（/simplify）

- **refactor**: 合并 main.js 三个逐字重复的粘贴 IPC handler（`records:paste`/`upload:video`/`records:pasteImage`）为单一 `records:paste(id)`，类型分派收敛到主进程 `writeRecordToClipboard`；"置顶+广播/隐藏面板/osascript 发 Cmd+V"抽为 `moveRecordToTop`/`pasteToForeground`/`broadcast` 复用（原置顶逻辑在 5 处各有一份拷贝）。
  - 受影响文件：`main.js`、`src/clipboard.js`
- **refactor**: 记录 CRUD（增/删/清空/移回）集中到 `src/clipboard.js`，`hashIndex` 去重索引随所有变更路径同步维护（此前删除/截断记录会遗留死索引条目，导致同样内容重启前无法再被捕获）；IPC 通道名抽取 `src/ipc-channels.js` 单一真身（preload 因沙箱限制内联同名字面量并注释互指）。
  - 受影响文件：`src/clipboard.js`、`src/ipc-channels.js`（新增）、`main.js`、`preload.js`
- **fix**: 修复收藏按钮选中态样式永不生效的问题（CSS 选择器 `.card-btn.favorite.active` 与实际类名 `fav` 不匹配）；搜索输入增加 250ms 防抖。
  - 受影响文件：`renderer/style.css`、`renderer/renderer.js`
- **perf**: 剪贴板图片变更检测改用 32px 降采样指纹（原先每个轮询 tick 对全分辨率图做 PNG 编码+SHA1）；`pruneByAge` 由每 750ms 执行改为启动时一次+每 30 分钟低频执行（electron-store 每次 get/set 均为全文件读写）；图片粘贴不再从渲染层回传整个 dataUrl 重算哈希，改传记录 id。
  - 受影响文件：`src/clipboard.js`、`main.js`、`preload.js`、`renderer/renderer.js`
- **refactor**: 渲染层清理——删除只写不读的 `lastMove`/`redoStack`/`undoEnabled`/`state.active` 冗余状态；`isFav` 的 O(n²) 列表扫描改为直接读主进程注入的 `__fav`；SVG 图标提取 `ICONS` 常量；toast 由 JS 动态构建改为静态 `#toast`+CSS；合并重复的 `records:new` 回调；快捷键弹窗统一用 `$` 查询、精简恒等键位映射。
  - 受影响文件：`renderer/renderer.js`、`renderer/index.html`、`renderer/style.css`
- **chore**: 删除死代码（无人调用的 `pasteText` 桥、恒假的 `if (tray) tray.destroy()`、加载同一路径的托盘图标 fallback、panel 尺寸双默认值）；`build` 脚本去掉与 dist 系列重复的前置 `npm run icons`；`gen-icons.js` 默认源路径由硬编码本机绝对路径改为 `__dirname` 相对路径；与 `:root` 变量同值的硬编码颜色统一改 `var()` 引用；`assets/icon.png` 路径与 `maxRecords`/列表上限 500 提为命名常量。
  - 受影响文件：`preload.js`、`main.js`、`package.json`、`scripts/gen-icons.js`、`renderer/style.css`
