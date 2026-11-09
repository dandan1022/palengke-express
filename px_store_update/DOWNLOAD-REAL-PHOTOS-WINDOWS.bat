@echo off
cd /d "%~dp0"
echo Downloading real product photos into assets\products...
node scripts\download-product-photos.js
pause
