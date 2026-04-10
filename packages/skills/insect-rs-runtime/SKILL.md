---
name: insect-rs-runtime
description: Operate the compiled Insect Rust runtime for local HTTP serving, page extraction, search fallback, artifact capture, and YouTube transcript retrieval. Use when Codex needs to run or validate the bundled `insect-rs.exe`, inspect CLI help, execute `engine` or `transcribe-youtube` commands, smoke-test the Rust runtime before packaging or deployment, or produce runtime artifacts such as text output, screenshots, and PDFs from the native binary.
---

# Insect RS Runtime

## Overview

Use the bundled Windows release binary and thin wrapper scripts to operate `insect-rs` without reconstructing the CLI contract from source. Keep the flow deterministic: discover the command surface, choose the correct mode, run through the wrapper, and verify the resulting payload or artifact.

## Quick Start

1. Confirm the runtime surface.
   Run `scripts/run-insect-rs.ps1 --help`.
2. Pick a mode.
   Use `serve` for the HTTP API, `engine` for page or search extraction, `transcribe-youtube` for transcript retrieval.
3. Run through the wrapper instead of hardcoding a binary path.
4. Validate the output artifact, stderr metadata, or HTTP response before reporting success.

## Operating Sequence

### 1. Confirm the runtime contract

- Read [references/runtime-contract.md](references/runtime-contract.md) when you need the exact modes, flags, environment variables, or output behavior.
- Use `scripts/run-insect-rs.ps1 --help` first when the task is exploratory.
- Treat `PORT`, `ADMIN_KEY`, and `INSECT_RS_DB_PATH` as the canonical runtime environment names.

### 2. Choose the execution path

- Use `serve` when the task is about HTTP endpoints, API-key-protected routes, health checks, or local SaaS hosting behavior.
- Use `engine --url ...` when the task is page extraction.
- Use `engine --query ...` when the task is search extraction with ordered engine fallback.
- Use `transcribe-youtube --url ...` or `--video-id ...` when the task is transcript retrieval.

### 3. Run through the wrapper scripts

- Windows:
  - `scripts/run-insect-rs.ps1`
  - `scripts/smoke-insect-rs.ps1`
- Bash shells on Windows:
  - `scripts/run-insect-rs.sh`
- The wrappers use `assets/bin/insect-rs.exe` by default and switch to `INSECT_RS_BIN` only when you explicitly provide that override.
- Do not hardcode absolute user-specific binary paths when the wrapper already gives you a stable launch contract.

### 4. Verify the result at the correct surface

- For `serve`, hit `/health` and then the intended route.
- For `engine`, inspect stdout or the file passed to `--output`, and inspect stderr when `--metadata` is enabled.
- For screenshot and PDF requests, verify the output files exist and are non-empty.
- For transcript work, verify the selected adapter order and the returned format before summarizing the result.

## Mode Recipes

### Serve the API

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-insect-rs.ps1 serve
```

### Extract a page to markdown

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-insect-rs.ps1 engine --url https://example.com --format markdown --metadata
```

### Run search extraction with explicit engine order

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-insect-rs.ps1 engine --query "open source crawling frameworks" --search-engines duckduckgo,bing,brave,google --format json
```

### Capture page artifacts

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-insect-rs.ps1 engine --url https://example.com --format text --screenshot .\out\page.png --pdf .\out\page.pdf --output .\out\page.txt --metadata
```

### Fetch a transcript

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-insect-rs.ps1 transcribe-youtube --video-id dQw4w9WgXcQ --format json --include-segments
```

## Patterns

- Start with `--help` when the task is ambiguous.
- Prefer wrapper scripts over direct binary invocation.
- Keep search engine order explicit when search quality matters.
- Use `--metadata` whenever execution details matter to the user.
- Write output to disk when the artifact itself is part of the deliverable.
- Preserve the runtime contract exactly as documented when packaging or hosting the binary.

## Anti-Patterns

- Do not claim a route, flag, or environment variable that the bundled binary does not expose.
- Do not bypass the wrapper and then report a broken path contract as a runtime defect.
- Do not treat `PORT`, `ADMIN_KEY`, and `INSECT_RS_DB_PATH` as optional aliases with different names.
- Do not report `engine` success until the requested stdout, file output, or artifact actually exists.
- Do not assume transcript adapters or search engines succeeded just because the command returned structured output; inspect the returned method or search metadata.

## Agent Pipeline

1. Inspect the requested outcome.
2. Read [references/runtime-contract.md](references/runtime-contract.md) if the correct command surface is not obvious.
3. Read [references/workflows.md](references/workflows.md) for task-specific execution flow.
4. Read [references/patterns.md](references/patterns.md) when you need operational discipline or reporting rules.
5. Run through `scripts/run-insect-rs.ps1` unless the user explicitly needs the raw binary path.
6. Capture machine-checkable evidence before closing the task.

## Bundled Resources

- `assets/bin/insect-rs.exe`
  Use as the bundled release artifact.
- `scripts/run-insect-rs.ps1`
  Use as the canonical Windows launcher.
- `scripts/run-insect-rs.sh`
  Use from Git Bash or similar Windows-hosted Bash shells.
- `scripts/smoke-insect-rs.ps1`
  Use for a fast help-plus-engine smoke pass.
- `references/runtime-contract.md`
  Read for the command and environment contract.
- `references/workflows.md`
  Read for task-by-task execution flow.
- `references/patterns.md`
  Read for best practices, anti-patterns, and reporting expectations.

## Source of Truth

- `E:\Workspaces\01_Projects\01_Github\insect-js\rust\src\main.rs`
- `E:\Workspaces\01_Projects\01_Github\insect-js\rust\README.md`
- `E:\Workspaces\01_Projects\01_Github\insect-js\README.md`
