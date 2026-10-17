@echo off
rem ============================================================
rem  KanaDance （ローカル版）起動
rem  これをダブルクリックするだけ。インストールは要りません。
rem ============================================================
chcp 65001 > nul
cd /d "%~dp0"

rem Python の出力を UTF-8 に固定する（既定の cp932 だと日本語で落ちることがある）
set PYTHONIOENCODING=utf-8

set PY=

rem 1) 同梱の Python（あればこれが一番確実。PATH も Store も関係ない）
if exist "%~dp0python\python.exe" set PY="%~dp0python\python.exe"

rem 2) PATH から探す
rem    ※ Windows は Python 未導入でも python.exe というダミーがあり、
rem      実行すると Microsoft Store が開く。バージョンを確かめて弾く。
if not defined PY (
  for %%C in (py python python3) do (
    if not defined PY (
      %%C -c "import sys; sys.exit(0 if sys.version_info >= (3,7) else 1)" > nul 2>&1
      if not errorlevel 1 set PY=%%C
    )
  )
)

rem 3) PATH に無いだけで入っていることがあるので、よくある場所も見る
if not defined PY (
  for %%D in (
    "%LOCALAPPDATA%\Programs\Python"
    "%ProgramFiles%"
    "%ProgramFiles(x86)%"
    "C:\"
  ) do (
    if not defined PY (
      for /f "delims=" %%F in ('dir /b /s "%%~D\python.exe" 2^>nul') do (
        if not defined PY (
          "%%F" -c "import sys; sys.exit(0 if sys.version_info >= (3,7) else 1)" > nul 2>&1
          if not errorlevel 1 set PY="%%F"
        )
      )
    )
  )
)

if not defined PY (
  echo.
  echo   Python が見つかりませんでした。
  echo.
  echo   このフォルダに python\python.exe が入っていれば、
  echo   インストールなしで動きます。Mac 側で
  echo       ./build.sh --with-python
  echo   として作り直してください。
  echo.
  pause
  exit /b 1
)

echo   %PY% で起動します...
%PY% server.py

echo.
pause
