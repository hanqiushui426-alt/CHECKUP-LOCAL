@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
title 检查数据统计工作台 - 启动器
cd /d "%~dp0"

echo ================================================
echo    检查数据统计工作台  Checkup Workbench
echo    数据与识别全部在本机完成，不上传任何网络服务
echo ================================================
echo.

rem ---------- 端口：从 8321 起自动避让已占用端口 ----------
set "PORT=8321"
:findport
netstat -ano | findstr /R /C:"LISTENING" | findstr /C:":%PORT% " >nul
if not errorlevel 1 (
    set /a PORT+=1
    if !PORT! gtr 8340 (
        echo [!] 8321-8340 端口均被占用，无法启动
        pause
        exit /b 1
    )
    goto findport
)
set "CHECKUP_PORT=%PORT%"

rem ---------- 1. 选择 Python 解释器 ----------
rem 绿色免安装版：runtime\python 已内置解释器与全部依赖，无需安装任何东西
set "PYEXE=%~dp0runtime\python\python.exe"
if exist "%PYEXE%" (
    echo [1/3] 使用内置运行环境 ^(免安装模式^)
    goto :frontend
)

rem 开发态：使用系统 Python 创建虚拟环境
set "PYVENV=%~dp0backend\.venv"
if not exist "%PYVENV%\Scripts\python.exe" (
    echo [1/3] 尚未创建后端虚拟环境，正在创建 ...
    if not exist "%~dp0backend" mkdir "%~dp0backend"
    py -3 -m venv "%PYVENV%" 2>nul
    if errorlevel 1 python -m venv "%PYVENV%"
    if errorlevel 1 (
        echo [!] 创建虚拟环境失败，请先安装 Python 3.11/3.12 并勾选 Add to PATH
        echo     或直接下载本项目的"绿色免安装版"，无需安装 Python
        pause
        exit /b 1
    )
)
echo [1/3] 后端虚拟环境就绪

echo [2/3] 检查并安装后端依赖（首次需联网下载）...
"%PYVENV%\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r "%~dp0requirements.txt"
if errorlevel 1 (
    echo [!] 后端依赖安装失败，请检查网络后重试
    pause
    exit /b 1
)
set "PYEXE=%PYVENV%\Scripts\python.exe"

rem ---------- 2. 前端页面 ----------
:frontend
if exist "%~dp0web\index.html" (
    echo [2/3] 前端页面就绪 ^(web^)
    goto :launch
)
if exist "%~dp0frontend\dist\index.html" (
    echo [2/3] 前端页面就绪 ^(frontend\dist^)
    goto :launch
)
echo [2/3] 未找到已构建的前端页面，正在构建 ...
if not exist "%~dp0frontend\node_modules" (
    cd /d "%~dp0frontend"
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo [!] 前端依赖安装失败，请确认已安装 Node.js 18+
        pause
        exit /b 1
    )
    cd /d "%~dp0"
)
cd /d "%~dp0frontend"
call npm run build
if errorlevel 1 (
    echo [!] 前端构建失败
    pause
    exit /b 1
)
cd /d "%~dp0"

rem ---------- 3. 启动服务 ----------
:launch
echo [3/3] 启动本机服务，浏览器将自动打开工作台 ...
echo.
echo       工作台地址:  http://127.0.0.1:%PORT%
echo       接口文档:    http://127.0.0.1:%PORT%/api/docs
echo       数据保存在:  backend\data
echo       关闭本窗口即停止服务
echo.

start "" "http://127.0.0.1:%PORT%"
"%PYEXE%" -X utf8 -m uvicorn app.main:app --host 127.0.0.1 --port %PORT% --app-dir "%~dp0backend"

echo.
echo 服务已停止。
pause
