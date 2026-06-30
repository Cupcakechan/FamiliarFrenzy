@echo off
REM ===========================================================================
REM  package_kongregate.bat - Familiar Frenzy Kongregate packager
REM
REM  Kongregate's upload form has TWO areas, so this produces TWO artifacts:
REM
REM    builds\index.html                                -> "Game Files" area
REM        The main entry file: index.kongregate.html (the API-script variant)
REM        copied in AS index.html, since that slot only accepts a bare .html.
REM
REM    builds\familiar-frenzy-kongregate-otherfiles.zip -> "Other Files" area
REM        style.css + src\ + assets\ at the ZIP ROOT, WITHOUT index.html.
REM
REM  Kongregate serves index.html and extracts the Other Files zip into the SAME
REM  directory, so index.html's relative paths resolve as they do locally.
REM
REM  *** ZIP SEPARATORS (the thing that bit us): ***
REM  ZIP entry paths MUST use forward slashes (src/main.js). Kongregate's servers
REM  are Linux, where a backslash is a normal filename char - so a zip whose
REM  entries read "src\main.js" extracts as ONE flat mis-named file, every
REM  subfolder asset 404s, and the game loads to a black screen.
REM  .NET's ZipFile.CreateFromDirectory, under Windows PowerShell 5.1 / .NET
REM  Framework, writes BACKSLASH entries - so we do NOT use it. Instead we open a
REM  ZipArchive and add each file with an entry name we build ourselves, forcing
REM  forward slashes. The verify step then REJECTS any backslash entry.
REM  (Manual fallback if ever needed: Windows Explorer "Send to -> Compressed
REM   folder" also writes forward slashes.)
REM
REM  Publish: MANUAL. Developer portal -> Add/Edit game -> Game Type HTML5/WebGL
REM    Game Files  -> builds\index.html
REM    Other Files -> builds\familiar-frenzy-kongregate-otherfiles.zip
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
REM Entry SOURCE is index.kongregate.html (copied in as index.html below).
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

REM --- 4. Zip the OTHER files with EXPLICIT forward-slash entries -------------
REM We add each staged file by hand, replacing \ (char 92) with / (char 47) in
REM the entry name. This makes the separator impossible to get wrong, unlike
REM CreateFromDirectory which would copy the OS backslash on Windows.
powershell -NoProfile -Command ^
  "Add-Type -AssemblyName System.IO.Compression; " ^
  "Add-Type -AssemblyName System.IO.Compression.FileSystem; " ^
  "$stage = (Resolve-Path '.\builds\package_kongregate').Path; " ^
  "$zipPath = Join-Path $pwd 'builds\familiar-frenzy-kongregate-otherfiles.zip'; " ^
  "if (Test-Path $zipPath) { Remove-Item $zipPath }; " ^
  "$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create'); " ^
  "Get-ChildItem -Path $stage -Recurse -File | ForEach-Object { $rel = $_.FullName.Substring($stage.Length + 1).Replace([char]92, [char]47); [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel) | Out-Null }; " ^
  "$zip.Dispose()"
if errorlevel 1 ( echo [ERROR] Zip creation failed. & goto :fail )
if not exist "%OTHERZIP%" ( echo [ERROR] Zip file not found after creation. & goto :fail )
echo [OK] Created %OTHERZIP%

REM --- 5. Verify the zip: REJECT backslashes, confirm structure --------------
REM A backslash entry is the exact failure that 404s on Kongregate, so we FAIL
REM on it here rather than normalizing it away (which would hide the bug). The
REM src/ and assets/ checks use forward slashes, so a backslash zip fails twice.
powershell -NoProfile -Command ^
  "Add-Type -AssemblyName System.IO.Compression.FileSystem; " ^
  "$z = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path '.\builds\familiar-frenzy-kongregate-otherfiles.zip').Path); " ^
  "$names = $z.Entries | ForEach-Object { $_.FullName }; $z.Dispose(); " ^
  "$ok = $true; " ^
  "$bad = $names | Where-Object { $_.IndexOf([char]92) -ge 0 }; " ^
  "if ($bad) { Write-Host '[ERROR] Zip has BACKSLASH separators - it WILL 404 on Kongregate. First few:'; $bad | Select-Object -First 5 | ForEach-Object { Write-Host ('   ' + $_) }; $ok = $false }; " ^
  "if ($names -notcontains 'style.css') { Write-Host '[ERROR] style.css missing from zip root.'; $ok = $false }; " ^
  "if (-not ($names | Where-Object { $_ -like 'src/*' })) { Write-Host '[ERROR] src/ (forward-slash) missing from zip.'; $ok = $false }; " ^
  "if (-not ($names | Where-Object { $_ -like 'assets/*' })) { Write-Host '[ERROR] assets/ (forward-slash) missing from zip.'; $ok = $false }; " ^
  "if ($names -contains 'index.html') { Write-Host '[ERROR] index.html must NOT be in the Other Files zip.'; $ok = $false }; " ^
  "if ($ok) { Write-Host ('[OK] Zip verified: ' + $names.Count + ' entries, forward-slash paths, index.html excluded.') } else { exit 1 }"
if errorlevel 1 goto :fail

echo.
echo ============================================
echo  [SUCCESS] Two upload artifacts ready.
echo ============================================
echo    Game Files  -^>  %INDEXOUT%
echo    Other Files -^>  %OTHERZIP%
echo.
echo  Developer portal -^> Add/Edit game -^> Game Type = HTML5/WebGL
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