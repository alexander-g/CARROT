@echo off
setlocal

SET ROOT_PATH=%~dp0

rem check if we are running from within a zip archive
echo %~dp0 | findstr /I /C:".zip" /C:"\Temp\7z" > nul
if %errorlevel% equ 0 (
    echo Error: Please unzip the archive before running this file.
    pause
    exit /b
) 

rem else run normally
main\main.exe
pause
