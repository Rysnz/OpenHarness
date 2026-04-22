**中文** | [English](./README.md)

# OpenHarness

OpenHarness 是一个面向 AI Agent 的跨平台桌面工作台。

它把 Tauri 桌面壳、React 前端、移动端配对页面，以及负责 Agent 执行、工具调用、权限控制、终端能力和远程控制的 Rust 核心整合在同一个仓库里。

## 仓库内容

这个仓库是一个 monorepo，主要由四层组成：

- `src/apps/desktop`：Tauri 桌面应用
- `src/web-ui`：桌面应用使用的 React 主界面
- `src/mobile-web`：移动端浏览器配对与遥控入口
- `src/crates/*`：Rust 核心服务与共享库，包括 agent runtime

辅助目录：

- `scripts`：构建、打包、引导脚本
- `tests/e2e`：端到端测试
- `OpenHarness-Installer`：安装包工程
- `docs`：补充文档

## 主要能力

- 基于 Tauri 的桌面应用
- React + TypeScript 主界面
- Rust Agent 执行引擎与工具调用链路
- 自定义 Agent 与权限配置
- Shell 风险分析与审批流程
- 编辑器、Git、终端、LSP 相关能力
- 移动端配对和远程控制入口
- Windows、macOS、Linux 多平台打包

## 环境要求

本地构建前请准备：

- Node.js 18 及以上
- `pnpm`
- Rust stable toolchain
- 当前平台对应的 Tauri 依赖

建议：

- Windows 环境安装最新版 Visual Studio C++ Build Tools
- 如果经常做 release 构建，建议安装 `sccache`

## 快速开始

安装依赖：

```bash
pnpm install
```

开发模式启动桌面端：

```bash
pnpm run desktop:dev
```

只启动 Web 界面：

```bash
pnpm run dev:web
```

## 常用命令

构建 Web 界面：

```bash
pnpm run build:web
```

构建桌面端：

```bash
pnpm run desktop:build
```

构建 Windows 发布用 `exe`：

```bash
pnpm run desktop:build:exe
```

其他常用命令：

```bash
pnpm run desktop:build:nsis
pnpm run desktop:build:release-fast
pnpm run cli:check
pnpm run cli:test
pnpm run e2e:test:smoke
```

## 交付构建说明

最近项目收尾阶段主要使用的 Windows 交付构建命令是：

```bash
pnpm run desktop:build:exe
```

主要产物：

- `target/release/openharness-desktop.exe`

这条命令会：

- 构建 `src/web-ui`
- 准备 `src/mobile-web`
- 触发 Tauri release 构建
- 复用 OpenSSL 缓存
- 在本机可用时自动启用 `sccache`

需要注意：

- 第一次 release 构建会明显更慢
- 保留 `target/` 能让后续重复构建更快
- Windows 下磁盘空间不足会在链接阶段直接导致失败
- 如果出现 `no space on device`，优先清理 `target/debug` 或旧的自定义 profile 产物

## 最近收尾完成的事项

最近这轮项目收尾主要完成了：

- Windows 桌面启动链路清理
- 减少 miniapp worker 的启动期无效预热
- 交付构建 profile 调整
- 在桌面构建脚本中接入 `sccache`
- 补充可复用的构建说明文档

## 测试

Rust 检查：

```bash
cargo check -p openharness-desktop
cargo test -p openharness-core agentic
```

Web 类型检查：

```bash
pnpm run type-check:web
```

基础烟测：

```bash
pnpm run e2e:test:smoke
```

## 仓库结构

```text
OpenHarness-V2/
  src/
    apps/
      cli/
      desktop/
      relay-server/
      server/
    crates/
      api-layer/
      core/
      events/
      transport/
      webdriver/
    mobile-web/
    web-ui/
  scripts/
  tests/e2e/
  OpenHarness-Installer/
```

## 参与贡献

如果你准备参与开发，建议先看：

1. [CONTRIBUTING.md](./CONTRIBUTING.md)
2. [CONTRIBUTING_CN.md](./CONTRIBUTING_CN.md)

提交时建议附上：

- 改动范围
- 验证命令
- 桌面端或 Web 端的影响说明

## 许可证

本项目采用 [MIT License](./LICENSE)。
