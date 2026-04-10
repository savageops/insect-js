$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$rustRoot = Join-Path $repoRoot "rust"

Push-Location $rustRoot
try {
  cargo run -- serve
} finally {
  Pop-Location
}
