@echo off
echo ========================================
echo   班级宠物养成系统 - 快速启动脚本
echo ========================================
echo.

:: 检查 Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js v16+
    echo 下载地址：https://nodejs.org/
    pause
    exit /b 1
)

echo [✓] Node.js 已安装
echo.

:: 启动后端
echo [提示] 正在启动后端服务器...
cd /d %~dp0backend
if not exist node_modules (
    echo [提示] 正在安装后端依赖...
    call npm install
)
if not exist data (
    mkdir data
    echo [提示] 正在初始化数据库...
    call node src/config/seed.js
)

start "后端服务器" cmd /k "npm run dev"
echo [✓] 后端服务器已启动 (http://localhost:3000)
echo.

:: 启动前端
echo [提示] 正在启动前端开发服务器...
cd /d %~dp0frontend
if not exist node_modules (
    echo [提示] 正在安装前端依赖...
    call npm install
)

start "前端服务器" cmd /k "npm run dev"
echo [✓] 前端服务器已启动 (http://localhost:5173)
echo.

echo ========================================
echo   启动完成！
echo ========================================
echo.
echo 后端地址：http://localhost:3000
echo 前端地址：http://localhost:5173
echo.
echo 按任意键查看使用说明...
pause >nul

start "" "https://github.com/your-repo/README.md"

exit /b 0
