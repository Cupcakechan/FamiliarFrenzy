@echo off
REM ===========================================================================
REM  package_itch.bat - Familiar Frenzy itch.io packager
REM
REM  What it does:
REM    1. Validates that all required game files exist.
REM    2. Cleans previous package output.
REM    3. Stages ONLY the files the game needs into builds\package\
REM       (dev-only files are excluded simply by never being copied).
REM    4. Zips the staged files so index.html sits at the ZIP ROOT.
REM    5. Verifies the zip actually contains index.html at the root.
REM
REM  Output:  builds\familiar-frenzy-itch.zip   (manual-upload backup)
REM  Publish: pushes builds\package\ to itch.io via butler automatically.
REM           Optional version:  package_itch.bat 1.0.1
REM  Rerun any time after making changes. Uses built-in Windows commands,
REM  .NET zip (Win10/11), and butler (already installed + logged in).
REM ===========================================================================
setlocal enabledelayedexpansion
title Familiar Frenzy - itch.io packager

REM Always run from the folder this .bat lives in (the project root).
cd /d "%~dp0"

REM ---- EDIT THIS if your itch project URL slug differs -----------------------
REM Your project URL is https://mrcanela.itch.io/<slug>  ->  mrcanela/<slug>:html
set ITCH_TARGET=mrcanela/familiar-frenzy:html

set ZIP=builds\familiar-frenzy-itch.zip
set STAGE=builds\package

echo ============================================
echo  Familiar Frenzy - itch.io packaging
echo ============================================
echo.

REM --- 1. Validate required files -------------------------------------------
set MISSING=0
if not exist "index.html" ( echo [ERROR] Missing required file: index.html & set MISSING=1 )
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
copy /y "index.html" "%STAGE%\" >nul
copy /y "style.css"  "%STAGE%\" >nul
if exist "README.md"   copy /y "README.md"   "%STAGE%\" >nul
if exist "CREDITS.md"  copy /y "CREDITS.md"  "%STAGE%\" >nul
if exist "AI_USAGE.md" copy /y "AI_USAGE.md" "%STAGE%\" >nul

robocopy "src" "%STAGE%\src" /e /njh /njs /ndl /nc /ns /nfl >nul
if errorlevel 8 ( echo [ERROR] Failed copying src\ & goto :fail )

robocopy "assets" "%STAGE%\assets" /e /njh /njs /ndl /nc /ns /nfl >nul
if errorlevel 8 ( echo [ERROR] Failed copying assets\ & goto :fail )

echo [OK] Files staged to %STAGE%\

REM --- 4. Zip (contents of the staging folder = entries at the ZIP root) ------
REM Uses .NET ZipFile directly: on Win10/11 it writes forward-slash entry paths,
REM which is the safest format for itch.io's server.
powershell -NoProfile -Command ^
  "Add-Type -AssemblyName System.IO.Compression.FileSystem; " ^
  "[IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $pwd 'builds\package'), (Join-Path $pwd 'builds\familiar-frenzy-itch.zip'))"
if errorlevel 1 ( echo [ERROR] Zip creation failed. & goto :fail )
if not exist "%ZIP%" ( echo [ERROR] Zip file not found after creation. & goto :fail )
echo [OK] Created %ZIP%

REM --- 5. Verify index.html is at the ZIP ROOT --------------------------------
powershell -NoProfile -Command ^
  "Add-Type -AssemblyName System.IO.Compression.FileSystem; " ^
  "$z=[IO.Compression.ZipFile]::OpenRead((Join-Path $pwd 'builds\familiar-frenzy-itch.zip')); " ^
  "$names=$z.Entries | ForEach-Object { $_.FullName }; $z.Dispose(); " ^
  "if ($names -notcontains 'index.html') { Write-Host '[ERROR] index.html is NOT at the zip root.'; exit 1 } " ^
  "else { Write-Host ('[OK] Zip verified: index.html at root, ' + $names.Count + ' entries total.') }"
if errorlevel 1 goto :fail

REM --- 6. Push to itch.io with butler -----------------------------------------
REM butler diffs against the previous build, so updates upload fast. We push
REM the staged FOLDER (butler's preferred input); the zip above remains as a
REM manual-upload backup if butler is ever unavailable.
where butler >nul 2>&1
if errorlevel 1 (
  echo.
  echo [WARN] butler not found on PATH - skipping auto-upload.
  echo        Upload %ZIP% manually on itch.io instead.
  goto :done
)

echo.
echo Pushing to itch.io: %ITCH_TARGET%
if "%~1"=="" (
  butler push "%STAGE%" %ITCH_TARGET%
) else (
  butler push "%STAGE%" %ITCH_TARGET% --userversion %~1
)
if errorlevel 1 (
  echo [ERROR] butler push failed. The zip is still available for manual upload:
  echo         %ZIP%
  goto :fail
)
echo [OK] butler push complete - itch.io project updated.

:done
echo.
echo ============================================
echo  [SUCCESS] Packaged + published.
echo    Backup zip: %ZIP%
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
