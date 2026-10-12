# Changelog

本文档记录 AI 产生的项目变更。日期格式为 `YYYY-MM-DD`。

## 2026-10-12

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
