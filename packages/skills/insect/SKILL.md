---
name: insect
description: Canonical trigger alias for Insect. Use when the user says `insect`, `use insect`, `insect skill`, `search with insect`, `crawl with insect`, `scrape with insect`, `use insect on YouTube`, or otherwise references Insect without naming the specific runtime. Route the work to the compiled Rust runtime workflow exposed by the sibling `insect-rs-runtime` skill.
---

# Insect

Use this as the trigger alias for the canonical Insect runtime.

## Routing Rule

- Treat `insect-rs-runtime` as the implementation surface.
- If the task is page extraction, use the `engine --url` path from the sibling `insect-rs-runtime` package.
- If the task is search or web research, use the `engine --query` path from the sibling `insect-rs-runtime` package.
- If the task is YouTube transcript retrieval, use the `transcribe-youtube` path from the sibling `insect-rs-runtime` package.
- If the task is runtime validation or local API serving, use the `serve` path from the sibling `insect-rs-runtime` package.

## First Step

Open the sibling `insect-rs-runtime` skill and continue with that workflow immediately.
