# Build the portable (no-install) package into dist\<DstName>.
# ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 as ANSI unless it has a BOM,
# so the folder name (Chinese) is passed in as a parameter from build_portable.bat.
param(
  [string]$DstName = "checkup-portable",
  [string]$PythonVersion = "3.12.10",
  [string]$Mirror = "https://pypi.tuna.tsinghua.edu.cn/simple"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$build = Join-Path $root "build"
$dist = Join-Path $root "dist"
$dst = Join-Path $dist $DstName

function Say($m) { Write-Host "[build] $m" -ForegroundColor Cyan }

New-Item -ItemType Directory -Force -Path $build | Out-Null

# ---------- 1. embedded python ----------
$zip = Join-Path $build "python-embed.zip"
if (-not (Test-Path $zip)) {
  Say "downloading python $PythonVersion (embeddable) ..."
  $urls = @(
    "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip",
    "https://registry.npmmirror.com/-/binary/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
  )
  $ok = $false
  foreach ($u in $urls) {
    try {
      Invoke-WebRequest -Uri $u -OutFile $zip -TimeoutSec 300 -UseBasicParsing
      if ((Get-Item $zip).Length -gt 5MB) { $ok = $true; break }
    } catch { Say "  failed, trying next mirror" }
  }
  if (-not $ok) { throw "cannot download python embeddable package" }
}

$pyDir = Join-Path $build "runtime\python"
Say "extracting interpreter ..."
Expand-Archive -Path $zip -DestinationPath $pyDir -Force
Set-Content -Path (Join-Path $pyDir "python312._pth") `
  -Value "python312.zip`n.`nLib\site-packages`n`nimport site`n" -Encoding ascii
$py = Join-Path $pyDir "python.exe"
Say "interpreter: $(& $py -c 'import sys;print(sys.version.split()[0])')"

# ---------- 2. pip ----------
$getpip = Join-Path $build "get-pip.py"
if (-not (Test-Path $getpip)) {
  Say "downloading get-pip.py ..."
  Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $getpip -TimeoutSec 180 -UseBasicParsing
}
if (-not (Test-Path (Join-Path $pyDir "Lib\site-packages\pip"))) {
  Say "installing pip ..."
  & $py $getpip --no-warn-script-location -i $Mirror | Select-Object -Last 2
}

# ---------- 3. dependencies ----------
Say "installing dependencies (1-3 minutes) ..."
& $py -m pip install -r (Join-Path $root "requirements.lock.txt") --no-warn-script-location -i $Mirror
if ($LASTEXITCODE -ne 0) { throw "dependency installation failed" }

Say "slimming opencv (keep headless only) ..."
& $py -m pip uninstall -y opencv-python 2>&1 | Out-Null
& $py -m pip install --force-reinstall --no-deps opencv-python-headless -i $Mirror -q
if ($LASTEXITCODE -ne 0) { throw "opencv slimming failed" }

Say "self check ..."
& $py -c "import sqlite3, cv2, pymupdf, onnxruntime, fastapi, uvicorn, openpyxl; print('  modules ok')"

# ---------- 4. frontend must be built already ----------
$webSrc = Join-Path $root "frontend\dist"
if (-not (Test-Path (Join-Path $webSrc "index.html"))) {
  Say "frontend not built, running npm build ..."
  Push-Location (Join-Path $root "frontend")
  npm run build
  Pop-Location
}

# ---------- 5. assemble ----------
Say "assembling $dst ..."
New-Item -ItemType Directory -Force -Path "$dst\backend\data\uploads", "$dst\backend\data\page_images", `
  "$dst\backend\data\templates" | Out-Null
robocopy $pyDir "$dst\runtime\python" /E /NFL /NDL /NJH /NJS /NP | Out-Null
robocopy (Join-Path $root "backend\app") "$dst\backend\app" /E /NFL /NDL /NJH /NJS /NP | Out-Null
robocopy $webSrc "$dst\web" /MIR /NFL /NDL /NJH /NJS /NP | Out-Null

Copy-Item (Join-Path $root "start.bat") $dst -Force
$readme = Get-ChildItem (Join-Path $root "tools") -File -Filter *.txt | Select-Object -First 1
if ($readme) { Copy-Item $readme.FullName (Join-Path $dst ($readme.Name)) -Force }

$size = (Get-ChildItem $dst -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
Say ("done: {0} ({1:N0} MB)" -f $dst, $size)
