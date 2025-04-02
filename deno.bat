@echo off

setlocal

for %%I in ("%~dp0") do set "BASE_DIR=%%~fI"
set "DENO_DIR=%BASE_DIR%\.deno"
set "DENO_PATH=%DENO_DIR%\deno.exe"
set "PATH=%DENO_DIR%;%PATH%"
set "DENO_NO_UPDATE_CHECK=1"
set "DENO_NO_PROMPT"="1"
set "HTTPS_PROXY=%DENO_HTTPS_PROXY%"

if not exist "%DENO_PATH%" (
    echo Downloading deno...
    powershell -command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/denoland/deno/releases/download/v2.0.6/deno-x86_64-pc-windows-msvc.zip' -OutFile .\deno.zip"
    powershell -command "Expand-Archive -Path .\deno.zip -DestinationPath %DENO_DIR%"
    del .\deno.zip
)

set "DENO_DIR=%DENO_DIR%"
"%DENO_PATH%" %*
