[中文](./README.zh-CN.md) | **English**

<div align="center">

![OpenHarness](./png/OpenHarness_title.png)

[![GitHub release](https://img.shields.io/github/v/release/GCWing/OpenHarness?style=flat-square&color=blue)](https://github.com/GCWing/OpenHarness/releases)
[![Website](https://img.shields.io/badge/Website-openopenharness.com-6f42c1?style=flat-square)](https://openopenharness.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue?style=flat-square)](https://github.com/GCWing/OpenHarness)

</div>

## OpenHarness

OpenHarness is a desktop home for AI agents.

It is designed for people who want more than a chat box: a workspace where agents can think, act, run tools, edit code, work through files, stay in context, and keep going across sessions.

It aims to feel less like "asking an assistant for one answer" and more like living beside an evolving system that can help with real work every day.

![OpenHarness Screenshot](./png/first_screen_screenshot.png)

## What It Feels Like

- A companion when you want continuity, memory, and style
- An execution-first agent when you want something done
- A desktop control center for code, documents, terminals, and tools
- A remotely reachable system you can wake up from your phone

## Core Experience

### Agentic Desktop

OpenHarness centers the experience around a desktop app, not a browser tab you forget to come back to. The desktop becomes the place where agents can actually work with context, files, tools, and runtime state.

### Dual Working Modes

- **Assistant Mode**: warmer, longer-memory, preference-aware, better for ongoing collaboration
- **Professional Mode**: cleaner, leaner, more execution-focused, better for immediate tasks

### Remote Control

Pair a phone by scanning a QR code and use it as a command center for the desktop agent. OpenHarness also supports remote command flows through channels such as Telegram, Feishu, and WeChat bots.

### Real Tools, Not Just Text

OpenHarness is built around the idea that useful agents need more than words. It brings together terminals, editors, Git workflows, files, structured tools, and an agent runtime that can coordinate them.

## Agent Lineup

| Agent | Role | What It Is Good At |
| --- | --- | --- |
| Personal Assistant | Your long-term companion | Memory, personal preferences, ongoing collaboration, orchestration |
| Code Agent | Engineering work | Planning, editing, debugging, reviewing, running tools and verification |
| Cowork Agent | Knowledge work | Documents, office files, structured workflows, expandable capabilities |
| Custom Agent | Specialist roles | Domain-specific behavior defined around your own needs |

## Ecosystem

OpenHarness is meant to grow.

It supports:

- Skills
- MCP and MCP-based app integrations
- Custom agents
- Mini apps generated from requirements into runnable interfaces

The goal is not only to ship one agent, but to support an environment where many kinds of agents and capabilities can live together.

## Platform Support

OpenHarness is built for:

- Windows
- macOS
- Linux

The main experience is desktop-first, with mobile web used for pairing and remote control.

## Getting OpenHarness

### Windows

- Download the latest Windows release from [Releases](https://github.com/GCWing/OpenHarness/releases)
- Or build locally:

```bash
pnpm install
pnpm run desktop:build:exe
```

- Installer build:

```bash
pnpm run desktop:build:nsis
```

### macOS

- Download the latest macOS release from [Releases](https://github.com/GCWing/OpenHarness/releases)
- Or build locally on macOS:

```bash
pnpm install
pnpm run desktop:build:arm64
```

For Intel Macs:

```bash
pnpm run desktop:build:x86_64
```

### Linux

- Download the latest Linux release from [Releases](https://github.com/GCWing/OpenHarness/releases)
- Or build locally on Linux:

```bash
pnpm install
pnpm run desktop:build:linux
```

Package-specific builds:

```bash
pnpm run desktop:build:linux:deb
pnpm run desktop:build:linux:rpm
pnpm run desktop:build:linux:appimage
```

## For Developers

If you want to run the project in development mode:

```bash
pnpm install
pnpm run desktop:dev
```

Requirements:

- Node.js 18+
- `pnpm`
- Rust stable
- Tauri prerequisites for your platform

## Contributing

If you want to contribute, start here:

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [CONTRIBUTING_CN.md](./CONTRIBUTING_CN.md)

Good contributions are not limited to code. Product ideas, interaction design, workflow improvements, agent capabilities, and ecosystem extensions all matter here.

## License

OpenHarness is released under the [MIT License](./LICENSE).
