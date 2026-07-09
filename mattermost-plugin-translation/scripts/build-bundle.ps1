# Builds plugin tar.gz with Linux executable permissions (required for Docker Mattermost)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

Write-Host "Building Linux server binary..."
Set-Location server
$env:CGO_ENABLED = "0"
$env:GOOS = "linux"
$env:GOARCH = "amd64"
go build -trimpath -o dist/plugin-linux-amd64 .
Set-Location ..

if (-not (Test-Path "webapp/dist/main.js")) {
    Write-Host "Building webapp..."
    if (-not (Test-Path "webapp/src/manifest.ts")) {
        .\build\bin\manifest.exe apply
    }
    Set-Location webapp
    npm run build
    Set-Location ..
} else {
    Write-Host "Building webapp..."
    Set-Location webapp
    npm run build
    Set-Location ..
}

$pluginId = "com.transchecker.translation"
$version = "3.5.7"
$staging = "dist/staging/$pluginId"
Remove-Item -Recurse -Force "dist/staging" -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path "$staging/server/dist", "$staging/webapp/dist", "$staging/assets" | Out-Null
Copy-Item plugin.json $staging
Copy-Item assets/* "$staging/assets/"
Copy-Item server/dist/plugin-linux-amd64 "$staging/server/dist/"
Copy-Item webapp/dist/* "$staging/webapp/dist/"

$tarName = "$pluginId-$version.tar.gz"
$tarPath = Join-Path $root "dist/$tarName"

# Python sets chmod 755 on the binary inside the tar (Windows tar omits execute bit)
python -c @"
import tarfile, os
root = r'$staging'
out = r'$tarPath'
plugin_id = '$pluginId'
with tarfile.open(out, 'w:gz') as tar:
    for folder, _, files in os.walk(root):
        for name in files:
            full = os.path.join(folder, name)
            arc = os.path.join(plugin_id, os.path.relpath(full, root)).replace('\\\\', '/')
            info = tar.gettarinfo(full, arcname=arc)
            if name == 'plugin-linux-amd64':
                info.mode = 0o755
            with open(full, 'rb') as f:
                tar.addfile(info, f)
print('Created', out)
"@

Write-Host "Done: dist/$tarName"
