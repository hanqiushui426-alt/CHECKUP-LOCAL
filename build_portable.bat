@echo off
chcp 65001 >nul
title 制作绿色免安装版
cd /d "%~dp0"

echo ================================================
echo   制作「检查数据统计工作台」绿色免安装版
echo   产物: dist\检查数据统计-绿色版
echo   需联网下载约 100MB（仅本机制作时需要）
echo ================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\build_portable.ps1"
if errorlevel 1 (
    echo.
    echo [!] 制作失败，请查看上方错误信息
) else (
    echo.
    echo 制作完成，可把 dist\检查数据统计-绿色版 整个文件夹拷贝走。
)

echo.
pause
