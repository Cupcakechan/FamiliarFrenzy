@echo off
REM ===========================================================================
REM  package_kongregate.bat - Familiar Frenzy Kongregate packager
REM
REM  Kongregate's upload form has TWO areas, so this produces TWO artifacts:
REM
REM    builds\index.html                                -> "Game Files" area
REM        The main entry file. This is index.kongregate.html (the variant with
REM        the Kongregate API <script> line) copied in AS index.html, since the
REM        Game Files slot only accepts a bare .html (not a zip).
REM
REM    builds\familiar-frenzy-kongregate-otherfiles.zip -> "Other Files" area
REM        A zip of everything else the game needs - style.css, src\, assets\ -
REM        at the ZIP ROOT, and deliberately WITHOUT index.html.
REM
REM  Kongregate serves index.html and extracts the Other Files zip into the SAME
REM  directory, so index.html's relative paths (style.css, src\..., assets\...)
REM  resolve exactly as they do under Live Server / on itch. That's why the zip
REM  must hold those at its root and must NOT contain index.html (which would
REM  collide with the separately-uploaded Game File).
REM
REM  Publish: MANUAL. Kongregate developer portal -> Add/Edit game ->
REM    Game Type = HTML5/WebGL
REM    Game Files  -> upload  builds\index.html
REM    Other Files -> upload  builds\familiar-frenzy-kongregate-otherfiles.zip
REM
REM  Rerun any time after making changes. Uses built-in Windows commands and
REM  .NET zip (Win10/11). No butler (that's itch-only).
REM ===========================================================================
setlocal enabledelayedexpansion
title Familiar Frenzy - Kongregate packager

REM Always run from the folder this .bat lives in (the project root).
cd /d "%~dp0"

set INDEXOUT=builds\index.html
set OTHERZIP=builds\familiar-frenzy-kongregate-otherfiles.zip
set STAGE=builds\package_kongregate

echo ============================================
echo  Familiar Frenzy - Kongregate packaging
echo ============================================
echo.

REM --- 1. Validate required files -------------------------------------------
REM The entry SOURCE is index.kongregate.html (copied in as index.html below).
REM Quoted set "MISSING=1" avoids a trailing space so the halt check fires.
set MISSING=0
if not exist "index.kongregate.html" ( echo [ERROR] Missing required file: index.kongregate.html & set "MISSING=1" )
if not exist "style.css"  ( echo [ERROR] Missing required file: style.css  & set "MISSING=1" )
if not exist "src\"       ( echo [ERROR] Missing required folder: src\     & set "MISSING=1" )
if not exist "assets\"    ( echo [ERROR] Missing required folder: assets\  & set "MISSING=1" )

for %%F in (main.js game.js input.js assets.js player.js familiar.js enemies.js pickups.js upgrades.js ui.js audio.js utils.js) do (
  if not exist "src\%%F" ( echo [ERROR] Missing required file: src\%%F & set "MISSING=1" )
)

if "!MISSING!"=="1" (
  echo.
  echo [FAILED] Required files are missing - nothing was packaged.
  goto :fail
)
echo [OK] All required files present.

REM --- 2. Clean previous output ----------------------------------------------
if exist "%STAGE%" rmdir /s /q "%STAGE%"
if exist "%OTHERZIP%" del /q "%OTHERZIP%"
if exist "%INDEXOUT%" del /q "%INDEXOUT%"
mkdir "%STAGE%" >nul 2>&1
echo [OK] Cleaned previous package output.

REM --- 3a. Entry file -> Game Files -------------------------------------------
REM index.kongregate.html becomes builds\index.html (correct name for the slot).
copy /y "index.kongregate.html" "%INDEXOUT%" >nul
if errorlevel 1 ( echo [ERROR] Failed to copy index.kongregate.html as index.html & goto :fail )
echo [OK] Entry file ready: %INDEXOUT%   (upload to "Game Files")

REM --- 3b. Stage OTHER files (everything EXCEPT index.html) -------------------
copy /y "style.css"  "%STAGE%\" >nul
if errorlevel 1 ( echo [ERROR] Failed copying style.css & goto :fail )

robocopy "src" "%STAGE%\src" /e /njh /njs /ndl /nc /ns /nfl >nul
if errorlevel 8 ( echo [ERROR] Failed copying src\ & goto :fail )

robocopy "assets" "%STAGE%\assets" /e /njh /njs /ndl /nc /ns /nfl >nul
if errorlevel 8 ( echo [ERROR] Failed copying assets\ & goto :fail )

echo [OK] Other files staged (style.css, src\, assets\ - no index.html)

REM --- 4. Zip the OTHER files (contents at the ZIP ROOT) ----------------------
REM .NET ZipFile (not Compress-Archive) writes forward-slash entry paths, which
REM is what Kongregate's Linux extraction expects.
powershell -NoProfile -Command ^
  "Add-Type -AssemblyName System.IO.Compression.FileSystem; " ^
  "[IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $pwd 'builds\package_kongregate'), (Join-Path $pwd 'builds\familiar-frenzy-kongregate-otherfiles.zip'))"
if errorlevel 1 ( echo [ERROR] Zip creation failed. & goto :fail )
if not exist "%OTHERZIP%" ( echo [ERROR] Zip file not found after creation. & goto :fail )
echo [OK] Created %OTHERZIP%

REM --- 5. Verify the Other Files zip is correct ------------------------------
REM   - style.css at the root
REM   - src\ and assets\ present (separators normalized to / for the check)
REM   - index.html is NOT inside (it must live only in the Game Files slot)
powershell -NoProfile -Command ^
  "Add-Type -AssemblyName System.IO.Compression.FileSystem; " ^
  "$z=[IO.Compression.ZipFile]::OpenRead((Join-Path $pwd 'builds\familiar-frenzy-kongregate-otherfiles.zip')); " ^
  "$names=$z.Entries | ForEach-Object { $_.FullName -replace '\\','/' }; $z.Dispose(); " ^
  "$ok=$true; " ^
  "if ($names -notcontains 'style.css') { Write-Host '[ERROR] style.css missing from zip root.'; $ok=$false } " ^
  "if (-not ($names | Where-Object { $_ -like 'src/*' })) { Write-Host '[ERROR] src/ missing from zip.'; $ok=$false } " ^
  "if (-not ($names | Where-Object { $_ -like 'assets/*' })) { Write-Host '[ERROR] assets/ missing from zip.'; $ok=$false } " ^
  "if ($names -contains 'index.html') { Write-Host '[ERROR] index.html must NOT be in the Other Files zip.'; $ok=$false } " ^
  "if ($ok) { Write-Host ('[OK] Other Files zip verified: ' + $names.Count + ' entries, index.html excluded.') } else { exit 1 }"
if errorlevel 1 goto :fail

echo.
echo ============================================
echo  [SUCCESS] Two upload artifacts ready.
echo ============================================
echo    Game Files  -^>  %INDEXOUT%
echo    Other Files -^>  %OTHERZIP%
echo.
echo  Kongregate portal -^> Add/Edit game -^> Game Type = HTML5/WebGL
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