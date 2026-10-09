# Changelog

本文档记录 AI 产生的项目变更。日期格式为 `YYYY-MM-DD`。

## 2026-10-09

- **build**: 将开发依赖 Electron 从 31.7.7 升级到 42.3.0，解决旧运行时被 macOS 安全机制拦截的问题；本地启动需使用 Node.js 22 或更高版本。
  - 受影响文件：`package.json`、`package-lock.json`
