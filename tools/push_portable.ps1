# Push the portable build to branch "portable" in small batches.
# ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 as ANSI unless it has a BOM.
$ErrorActionPreference = "Continue"

$root = Split-Path -Parent $PSScriptRoot
$wd = (Get-ChildItem (Join-Path $root "dist") -Directory | Select-Object -First 1).FullName
$log = Join-Path $PSScriptRoot "push_portable.log"
$id = @("-c", "user.name=hanqiushui426-alt", "-c", "user.email=hanqiushui426-alt@users.noreply.github.com")

function Log($m) {
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $m
  Add-Content -Path $log -Value $line -Encoding UTF8
}

Set-Location $wd
Log "work dir: $wd"

# Start from a clean, empty index so each batch commits only its own paths.
git update-ref -d refs/heads/master 2>&1 | Out-Null
git read-tree --empty 2>&1 | Out-Null
Log "index cleared"

$readme = (Get-ChildItem $wd -File -Filter *.txt | Select-Object -First 1).Name
$sp = "runtime/python/Lib/site-packages"
$big = @("cv2", "pymupdf", "onnxruntime", "numpy", "numpy.libs", "rapidocr_onnxruntime", "PIL", "pip")
$small = @(Get-ChildItem (Join-Path $wd $sp) -Directory |
  Where-Object { $big -notcontains $_.Name } | ForEach-Object { "$sp/$($_.Name)" })
# site-packages 根目录下还有零散的单文件（six.py、typing_extensions.py 等），不能漏
$small += @(Get-ChildItem (Join-Path $wd $sp) -File | ForEach-Object { "$sp/$($_.Name)" })

$batches = [ordered]@{
  "app files (backend / web / launcher)" = @(".gitignore", "start.bat", $readme, "web", "backend")
  "runtime core (interpreter + stdlib)"  = @("runtime/python/Scripts", "runtime/python/*.dll", "runtime/python/*.pyd",
                                             "runtime/python/*.exe", "runtime/python/python312.zip",
                                             "runtime/python/python312._pth", "runtime/python/python.cat",
                                             "runtime/python/LICENSE.txt")
  "deps: common packages"                = $small
  "deps: numpy"                          = @("$sp/numpy", "$sp/numpy.libs")
  "deps: onnxruntime / PIL / pip"        = @("$sp/onnxruntime", "$sp/PIL", "$sp/pip")
  "deps: pymupdf / rapidocr"             = @("$sp/pymupdf", "$sp/rapidocr_onnxruntime")
  "deps: cv2"                            = @("$sp/cv2")
}

$failed = @()
foreach ($name in $batches.Keys) {
  $paths = @($batches[$name])
  Log "---- batch: $name ($($paths.Count) paths)"
  git add -- $paths 2>&1 | Out-Null
  git @id commit -m "portable build - $name" 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Log "  commit skipped (no change)"; continue }

  $ok = $false
  for ($i = 1; $i -le 6; $i++) {
    $out = git -c http.version=HTTP/1.1 -c http.postBuffer=1048576000 push -f origin HEAD:portable 2>&1
    if ($LASTEXITCODE -eq 0) { Log "  pushed (attempt $i)"; $ok = $true; break }
    Log "  attempt $i failed: $($out | Select-Object -Last 1)"
    Start-Sleep -Seconds 8
  }
  if (-not $ok) { Log "  !! FAILED: $name"; $failed += $name }
}

Log "==== done, failed batches: $($failed.Count) ===="
