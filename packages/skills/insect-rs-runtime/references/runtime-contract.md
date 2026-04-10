# Runtime Contract

## Command Surface

- `serve`
  Start the local HTTP server.
- `engine`
  Run page extraction or search extraction.
- `transcribe-youtube`
  Fetch a YouTube transcript through ordered adapter fallback.

## Canonical Environment Variables

- `PORT`
  HTTP bind port for `serve`.
- `ADMIN_KEY`
  Admin route key for key-management routes.
- `INSECT_RS_DB_PATH`
  SQLite path override for the Rust runtime.
- `INSECT_RS_BIN`
  Optional override for the launcher scripts when the bundled binary is not the intended executable.

## Engine Contract

### Page Mode

- Trigger with `--url`.
- Useful flags:
  - `--method`
  - `--format`
  - `--selector`
  - `--metadata`
  - `--screenshot`
  - `--pdf`
  - `--output`

### Search Mode

- Trigger with `--query` or legacy `--google`.
- Search engines supported by the CLI contract:
  - `duckduckgo`
  - `bing`
  - `brave`
  - `google`
- Google is intentionally forced to the final attempt when it is included.

## Transcript Contract

- Provide exactly one locator:
  - `--url`
  - `--video-id`
- Supported methods:
  - `insect_native`
  - `insect_signal`
  - `invidious`
  - `piped`
  - `yt_dlp`
- Supported formats:
  - `text`
  - `json`
  - `markdown`

## Output Surfaces

- stdout
  Default structured or text output.
- stderr
  Execution metadata when `--metadata` is enabled.
- filesystem
  Output files passed via `--output`, `--screenshot`, or `--pdf`.
