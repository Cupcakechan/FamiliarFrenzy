@echo off
REM ===========================================================================
REM  package_kongregate.bat - Familiar Frenzy Kongregate packager
REM
REM  Sibling of package_itch.bat. SAME staging/zip approach, with two changes:
REM    - It copies index_kongregate.html in AS index.html (that file's extra
REM      Kongregate API <script> line is the ONLY difference from the itch build).
REM    - It does NOT push anywhere. Kongregate has no CLI, so this just produces
REM      a zip you upload by hand.
REM
REM  What it does:
REM    1. Validates that all required game files exist (incl. index_kongregate.html).
REM    2. Cleans previous package output.
REM    3. Stages ONLY the files the game needs into builds\package_kongregate\,
REM       copying index_kongregate.html in AS index.html.
REM    4. Zips the staged files so index.html sits at the ZIP ROOT.
REM    5. Verifies the zip actually contains index.html at the root.
REM
REM  Output:  builds\familiar-frenzy-kongregate.zip
REM  Publish: MANUAL. Kongregate developer portal -> Upload step ->
REM           Game Type = HTML5/WebGL -> upload this zip (index.html at root).
REM
REM  Rerun any time after making changes. Uses built-in Windows commands and
REM  .NET zip (Win10/11). No butler (that's itch-only).
REM ===========================================================================
setlocal enabledelayedexpansion
title Familiar Frenzy - Kongregate packager

REM Always run from the folder this .bat lives in (the project root).
cd /d "%~dp0"

set ZIP=builds\familiar-frenzy-kongregate.zip
set STAGE=builds\package_kongregate

echo ============================================
echo  Familiar Frenzy - Kongregate packaging
echo ============================================
echo.

REM --- 1. Validate required files -------------------------------------------
REM Note: the SOURCE index here is index_kongregate.html (not index.html); it is
REM copied in as index.html during staging.
set MISSING=0
if not exist "index_kongregate.html" ( echo [ERROR] Missing required file: index_kongregate.html & set MISSING=1 )
if not exist "style.css"  ( echo [ERROR] Missing required file: style.css  & set MISSING=1 )
if not exist "src\"       ( echo [ERROR] Missing required folder: src\     & set MISSING=1 )
if not exist "assets\"    ( echo [ERROR] Missing required folder: assets\  & set MISSING=1 )

for %%F in (main.js game.js input.js assets.js player.js familiar.js enemies.js pickups.js upgrades.js ui.js audio.js utils.js) do (
  if not exist "src\%%F" ( echo [ERROR] Missing required file: src\%%F & set MISSING=1 )
)

if !MISSING!==1 (
  echo.
  echo [FAILED] Required files are missing - nothing was packaged.
  goto :fail
)
echo [OK] All required files present.

REM --- 2. Clean previous output ----------------------------------------------
if exist "%STAGE%" rmdir /s /q "%STAGE%"
if exist "%ZIP%" del /q "%ZIP%"
mkdir "%STAGE%" >nul 2>&1
echo [OK] Cleaned previous package output.

REM --- 3. Stage files ----------------------------------------------------------
REM index_kongregate.html becomes index.html at the zip root. Everything else
REM (style.css, src\, assets\) is byte-identical to the itch build. Dev-only
REM files (README/CREDITS/AI_USAGE, the base index.html) are simply never copied.
copy /y "index_kongregate.html" "%STAGE%\index.html" >nul
copy /y "style.css"  "%STAGE%\" >nul

robocopy "src" "%STAGE%\src" /e /njh /njs /ndl /nc /ns /nfl >nul
if errorlevel 8 ( echo [ERROR] Failed copying src\ & goto :fail )

robocopy "assets" "%STAGE%\assets" /e /njh /njs /ndl /nc /ns /nfl >nul
if errorlevel 8 ( echo [ERROR] Failed copying assets\ & goto :fail )

echo [OK] Files staged to %STAGE%\  (index_kongregate.html -^> index.html)

REM --- 4. Zip (contents of the staging folder = entries at the ZIP root) ------
REM Uses .NET ZipFile directly: on Win10/11 it writes forward-slash entry paths,
REM which is the safest format for Kongregate's server.
powershell -NoProfile -Command ^
  "Add-Type -AssemblyName System.IO.Compression.FileSystem; " ^
  "[IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $pwd 'builds\package_kongregate'), (Join-Path $pwd 'builds\familiar-frenzy-kongregate.zip'))"
if errorlevel 1 ( echo [ERROR] Zip creation failed. & goto :fail )
if not exist "%ZIP%" ( echo [ERROR] Zip file not found after creation. & goto :fail )
echo [OK] Created %ZIP%

REM --- 5. Verify index.html is at the ZIP ROOT --------------------------------
powershell -NoProfile -Command ^
  "Add-Type -AssemblyName System.IO.Compression.FileSystem; " ^
  "$z=[IO.Compression.ZipFile]::OpenRead((Join-Path $pwd 'builds\familiar-frenzy-kongregate.zip')); " ^
  "$names=$z.Entries | ForEach-Object { $_.FullName }; $z.Dispose(); " ^
  "if ($names -notcontains 'index.html') { Write-Host '[ERROR] index.html is NOT at the zip root.'; exit 1 } " ^
  "else { Write-Host ('[OK] Zip verified: index.html at root, ' + $names.Count + ' entries total.') }"
if errorlevel 1 goto :fail

echo.
echo ============================================
echo  [SUCCESS] Kongregate zip ready.
echo    Upload this file by hand:
echo      %ZIP%
echo    Kongregate portal -^> Upload -^> Game Type = HTML5/WebGL
echo ============================================
echo.
pause
exit /b 0

:fail
echo.
echo ============================================
echo  [FAILED] Packaging did not complete.
echo ============================================
echo.
pause
exit /b 1
