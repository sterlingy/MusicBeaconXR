# Copies the SynthKit addon (D:\Godot_Projects\SynthKit, or -From) into addons\synthkit.
# SynthKit is the shared home of the instruments: engine source, binaries, scripts,
# panels and presets. This project uses the addon part only (no engine source).
#   tools\sync_synthkit.ps1            copy the addon as it is
#   tools\sync_synthkit.ps1 -Build     build SynthKit's Windows debug engine first
param([string]$From = "", [switch]$Build)
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
if ($From -eq "") { $From = Join-Path (Split-Path $root -Parent) "SynthKit" }
if (-not (Test-Path "$From\plugin.cfg")) { throw "SynthKit not found at $From" }
if ($Build) { & "$From\engine\tools\build.ps1" }
$dest = "$root\addons\synthkit"
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Force $dest | Out-Null
# Everything Godot needs; not the engine source, third-party clones, docs or git data.
$skip = @("engine", "docs", ".git", ".gitignore", ".gitattributes")
Get-ChildItem $From -Force | Where-Object { $skip -notcontains $_.Name } | ForEach-Object {
    Copy-Item $_.FullName -Destination $dest -Recurse -Force
}
Get-ChildItem "$dest\bin" -Include *.exp, *.lib, *.pdb, *.ilk -Recurse | Remove-Item -Force
$rev = "uncommitted"
try { $r = & git -C $From rev-parse --short HEAD 2>$null; if ($LASTEXITCODE -eq 0 -and $r) { $rev = $r } } catch {}
"Synced SynthKit ($rev) into addons\synthkit"
