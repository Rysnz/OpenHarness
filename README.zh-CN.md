**中文** | [English](./README.md)

<div align="center">

![OpenHarness](./png/OpenHarness_title.png)

[![GitHub release](https://img.shields.io/github/v/release/GCWing/OpenHarness?style=flat-square&color=blue)](https://github.com/GCWing/OpenHarness/releases)
[![Website](https://img.shields.io/badge/Website-openopenharness.com-6f42c1?style=flat-square)](https://openopenharness.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue?style=flat-square)](https://github.com/GCWing/OpenHarness)

</div>

## OpenHarness 是什么

OpenHarness 是一个面向 AI Agent 的桌面工作台。

它不是把 Agent 塞进一个聊天框里，而是把 Agent 放进真正的工作环境里: 文件、终端、编辑器、工具调用、长期上下文、移动端遥控，这些都属于它的日常场景。

它想做的，不是“一次性回答问题的助手”，而是一个能长期陪你工作、持续执行任务、逐步长成你自己的 Agent 系统。

![OpenHarness 截图](./png/first_screen_screenshot_CN.png)

## 它想带来的体验

- 当你需要延续性时，它像一个真正熟悉你的伙伴
- 当你需要效率时，它像一个直接开始干活的执行型 Agent
- 当你在桌面工作时，它像一个统一调度代码、文件、工具和终端的控制中心
- 当你不在桌前时，它仍然可以被手机唤醒和遥控

## 核心体验

### Agentic Desktop

OpenHarness 以桌面端为中心，而不是一个随手开随手关的网页标签页。桌面应用才是 Agent 真正工作的地方: 有上下文、有文件、有工具、有状态，也有持续性。

### 双模式协作

- **Assistant Mode**：更有陪伴感，更强调记忆、偏好与长期协作
- **Professional Mode**：更克制、更直接、更偏执行，适合快速完成具体任务

### 远程控制

扫描二维码后，手机就能成为桌面 Agent 的遥控入口。除了移动端浏览器，OpenHarness 也支持通过 Telegram、飞书、微信等通道发起远程指令。

### 不只是聊天

OpenHarness 的出发点很明确: 有用的 Agent 不能只会说话。它需要真的接入终端、编辑器、Git、文件系统、结构化工具和执行链路，能够把事情推进下去。

## Agent 阵列

| Agent | 定位 | 擅长的事情 |
| --- | --- | --- |
| Personal Assistant | 你的长期伙伴 | 记忆、偏好、持续协作、调度能力 |
| Code Agent | 工程执行者 | 规划、改代码、调试、审查、跑工具和验证 |
| Cowork Agent | 知识工作助手 | 文档、办公文件、结构化处理、能力扩展 |
| Custom Agent | 定制专家 | 为特定场景定义专属能力和行为 |

## 生态方向

OpenHarness 不想只停在一个内置 Agent 上。

它支持：

- Skills
- MCP 与基于 MCP 的应用集成
- 自定义 Agent
- 从需求生成可运行界面的 Mini App

目标不是只做一个“会聊天的产品”，而是做一个能持续长出新能力的 Agent 环境。

## 平台支持

OpenHarness 面向：

- Windows
- macOS
- Linux

主体验以桌面端为核心，移动端主要负责配对和遥控。

## 获取 OpenHarness

### Windows

- 直接从 [Releases](https://github.com/GCWing/OpenHarness/releases) 下载最新 Windows 版本
- 或者在本地构建：

```bash
pnpm install
pnpm run desktop:build:exe
```

- 如果你需要安装包：

```bash
pnpm run desktop:build:nsis
```

### macOS

- 直接从 [Releases](https://github.com/GCWing/OpenHarness/releases) 下载最新 macOS 版本
- 或者在 macOS 本机构建：

```bash
pnpm install
pnpm run desktop:build:arm64
```

Intel Mac 可以使用：

```bash
pnpm run desktop:build:x86_64
```

### Linux

- 直接从 [Releases](https://github.com/GCWing/OpenHarness/releases) 下载最新 Linux 版本
- 或者在 Linux 本机构建：

```bash
pnpm install
pnpm run desktop:build:linux
```

如果你需要特定格式：

```bash
pnpm run desktop:build:linux:deb
pnpm run desktop:build:linux:rpm
pnpm run desktop:build:linux:appimage
```

## 给开发者的入口

如果你想在本地以开发模式运行：

```bash
pnpm install
pnpm run desktop:dev
```

环境要求：

- Node.js 18+
- `pnpm`
- Rust stable
- 当前平台对应的 Tauri 依赖

## 参与贡献

如果你想参与，先看：

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CONTRIBUTING_CN.md](./CONTRIBUTING_CN.md)

这里欢迎的不只是代码。产品想法、交互体验、工作流设计、Agent 能力、生态扩展，都是很重要的贡献方向。

## 许可证

OpenHarness 使用 [MIT License](./LICENSE)。
