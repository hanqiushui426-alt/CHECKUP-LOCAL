# 一键制作「绿色免安装版」
# 产物：dist\检查数据统计-绿色版\（拷到任意 Windows 10/11 电脑双击 start.bat 即用）
# 说明：本脚本需要在有网络的机器上运行一次；目标机无需 Python / Node / 联网。
param(
    [string]$PythonVersion = "3.12.10",
    [string]$Mirror = "https://pypi.tuna.tsinghua.edu.cn/simple"
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$build = Join-Path $root "build"
$dst = Join-Path $root "dist\检查数据统计-绿色版"

function Say($msg) { Write-Host "[build] $msg" -ForegroundColor Cyan }

New-Item -ItemType Directory -Force -Path $build | Out-Null

# ---------- 1. 内嵌 Python ----------
$zip = Join-Path $build "python-embed.zip"
if (-not (Test-Path $zip)) {
    Say "下载 Python $PythonVersion embeddable ..."
    $urls = @(
        "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip",
        "https://registry.npmmirror.com/-/binary/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
    )
    $ok = $false
    foreach ($u in $urls) {
        try {
            Invoke-WebRequest -Uri $u -OutFile $zip -TimeoutSec 300 -UseBasicParsing
            if ((Get-Item $zip).Length -gt 5MB) { $ok = $true; break }
        } catch { Say "  下载失败，换源: $u" }
    }
    if (-not $ok) { throw "Python embeddable 下载失败" }
}
$pyDir = Join-Path $build "runtime\python"
Say "解压内嵌 Python ..."
Expand-Archive -Path $zip -DestinationPath $pyDir -Force

# 启用 site-packages（embeddable 默认关闭）
$pth = Join-Path $pyDir "python312._pth"
Set-Content -Path $pth -Value "python312.zip`n.`nLib\site-packages`n`nimport site`n" -Encoding ascii
$py = Join-Path $pyDir "python.exe"
Say "内嵌解释器: $(& $py -c 'import sys;print(sys.version.split()[0])')"

# ---------- 2. pip ----------
$getpip = Join-Path $build "get-pip.py"
if (-not (Test-Path $getpip)) {
    Say "下载 get-pip.py ..."
    Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $getpip -TimeoutSec 180 -UseBasicParsing
}
if (-not (Test-Path (Join-Path $pyDir "Lib\site-packages\pip"))) {
    Say "安装 pip ..."
    & $py $getpip --no-warn-script-location -i $Mirror | Select-Object -Last 2
}

# ---------- 3. 依赖 ----------
Say "安装依赖（约 1-3 分钟）..."
& $py -m pip install -r (Join-Path $root "requirements.lock.txt") --no-warn-script-location -i $Mirror
if ($LASTEXITCODE -ne 0) { throw "依赖安装失败" }

# rapidocr 会依赖 GUI 版 opencv，卸掉后强制重装 headless 版本以减小体积
Say "精简 opencv（仅保留 headless）..."
& $py -m pip uninstall -y opencv-python 2>&1 | Out-Null
& $py -m pip install --force-reinstall --no-deps opencv-python-headless -i $Mirror -q
if ($LASTEXITCODE -ne 0) { throw "opencv 精简失败" }

# ---------- 4. 自检 ----------
Say "自检关键模块 ..."
& $py -c "import sqlite3, cv2, pymupdf, onnxruntime, fastapi, uvicorn, openpyxl; print('  模块自检通过')"

# ---------- 5. 组装 ----------
Say "组装绿色版目录 ..."
New-Item -ItemType Directory -Force -Path "$dst\backend\data\uploads","$dst\backend\data\page_images","$dst\backend\data\templates" | Out-Null
robocopy $pyDir "$dst\runtime\python" /E /NFL /NDL /NJH /NJS /NP | Out-Null
robocopy (Join-Path $root "backend\app") "$dst\backend\app" /E /NFL /NDL /NJH /NJS /NP | Out-Null
robocopy (Join-Path $root "frontend\dist") "$dst\web" /E /NFL /NDL /NJH /NJS /NP | Out-Null
Copy-Item (Join-Path $root "start.bat") "$dst\start.bat" -Force
if (-not (Test-Path "$dst\使用说明.txt")) {
    Say "警告：未找到 使用说明.txt，请从仓库 tools\使用说明.txt 复制"
}

$size = (Get-ChildItem $dst -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
Say "完成：$dst（{0:N0} MB）" -f $size
Write-Host ""
Write-Host "提示：确认无误后可将整个文件夹压缩为 zip 分发；也可删除 build\ 释放空间。" -ForegroundColor Yellow
