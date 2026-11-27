$ErrorActionPreference = "Stop"

Write-Host "=== GENDEV Worship Media Player Windows Build ==="
python -m pip install --upgrade pip
pip install -r requirements.txt

Write-Host "Running unit tests..."
python -m unittest discover -s desktop/tests -p "test_*.py" -v

Write-Host "Building PyInstaller Portable & Directory bundle..."
pyinstaller --clean --noconfirm gendev.spec

if (-not (Test-Path "dist\GENDEV Worship Media Player Portable.exe")) {
    throw "Portable EXE build missing!"
}

$iscc = Get-Command iscc.exe -ErrorAction SilentlyContinue
if ($iscc) {
    Write-Host "Building Inno Setup Installer..."
    & $iscc.Source "installer\gendev_setup.iss"
} else {
    Write-Warning "Inno Setup (iscc.exe) not found in PATH; skipping Setup EXE."
}

Write-Host "Build completed cleanly. Artifacts in dist\"
