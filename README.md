[中文](./README.zh-CN.md) | **English**

# OpenHarness

OpenHarness is a cross-platform desktop workspace for running and managing AI agents.

It combines a Tauri desktop shell, a React-based web UI, a mobile pairing experience, and a Rust core that handles agent execution, tools, permissions, terminal workflows, and remote control features.

## What This Repository Contains

This repository is a monorepo with four main layers:

- `src/apps/desktop`: the Tauri desktop application
- `src/web-ui`: the main React frontend used by the desktop app
- `src/mobile-web`: the browser-based mobile companion and pairing flow
- `src/crates/*`: Rust services and shared core libraries, including the agent runtime

Supporting directories:

- `scripts`: build, packaging, and bootstrap scripts
- `tests/e2e`: end-to-end tests
- `OpenHarness-Installer`: installer packaging project
- `docs`: project documentation and supporting material

## Core Capabilities

- Desktop application built with Tauri
- React + TypeScript web UI
- Rust agent runtime with tool execution pipeline
- Custom agent definitions and permissions
- Shell risk analysis and approval flow
- Embedded editor, Git workflows, terminal integration, and LSP-related tooling
- Mobile web pairing and remote control entrypoints
- Cross-platform packaging for Windows, macOS, and Linux

## Requirements

Before building locally, make sure you have:

- Node.js 18 or newer
- `pnpm`
- Rust stable toolchain
- Tauri system prerequisites for your platform

Recommended:

- Windows developers should install the current Visual Studio C++ build tools
- If you build release artifacts often, installing `sccache` is worthwhile

## Getting Started

Install dependencies:

```bash
pnpm install
```

Run the desktop app in development mode:

```bash
pnpm run desktop:dev
```

Run the web UI only:

```bash
pnpm run dev:web
```

## Common Commands

Build the web UI:

```bash
pnpm run build:web
```

Build the desktop app:

```bash
pnpm run desktop:build
```

Build a Windows release executable without extra bundling:

```bash
pnpm run desktop:build:exe
```

Useful alternatives:

```bash
pnpm run desktop:build:nsis
pnpm run desktop:build:release-fast
pnpm run cli:check
pnpm run cli:test
pnpm run e2e:test:smoke
```

## Release Build Notes

The Windows `exe` delivery path used during recent project closeout is:

```bash
pnpm run desktop:build:exe
```

Primary output:

- `target/release/openharness-desktop.exe`

What this command does:

- builds `src/web-ui`
- prepares `src/mobile-web`
- runs the Tauri release build
- reuses cached OpenSSL bootstrap assets
- enables `sccache` automatically when available

Important build behavior:

- The first release build is much slower than later builds
- Repeated builds are faster when `target/` is kept intact
- On Windows, low disk space can break release linking long before the final artifact is produced
- If you see `no space on device`, clear old build outputs such as `target/debug` or stale custom profiles

## Recent Project Closeout Work

The latest repository cleanup and stabilization work included:

- desktop startup path cleanup on Windows
- avoiding unnecessary eager miniapp worker startup
- release build profile tuning for delivery builds
- `sccache` integration in the desktop build script
- README updates for repeatable local packaging

## Testing

Rust checks:

```bash
cargo check -p openharness-desktop
cargo test -p openharness-core agentic
```

Web type check:

```bash
pnpm run type-check:web
```

Smoke-level end-to-end test:

```bash
pnpm run e2e:test:smoke
```

## Repository Layout

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

## Contributing

If you plan to contribute:

1. Read [CONTRIBUTING.md](./CONTRIBUTING.md)
2. Keep changes focused and easy to review
3. Prefer reproducible commands in PR descriptions
4. Include validation notes for desktop, web, or Rust changes as appropriate

## License

This project is released under the [MIT License](./LICENSE).
