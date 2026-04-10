$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$rustRoot = Join-Path $repoRoot "rust"

Push-Location $rustRoot
try {
  cargo check
  cargo test -- --test-threads=1
} finally {
  Pop-Location
}
