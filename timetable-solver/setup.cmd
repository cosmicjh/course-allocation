@echo off
setlocal
cd /d "%~dp0"
if exist runtime\installed.txt goto shortcut
if not exist runtime mkdir runtime
if not exist runtime\python.exe (
  curl.exe --fail --location --proto =https --tlsv1.2 "https://www.python.org/ftp/python/3.13.11/python-3.13.11-embed-amd64.zip" -o runtime\python.zip
  if errorlevel 1 goto fail
  certutil -hashfile runtime\python.zip SHA256 | findstr /i /c:"1ec066fb61ba5e8c73e29e048cd07c26850f74585e3a116005135b31b8004890" >nul
  if errorlevel 1 goto fail
  tar -xf runtime\python.zip -C runtime
  if errorlevel 1 goto fail
)
>runtime\python313._pth echo python313.zip
>>runtime\python313._pth echo .
>>runtime\python313._pth echo Lib/site-packages
>>runtime\python313._pth echo ..
>>runtime\python313._pth echo import site
if not exist runtime\Lib\site-packages\pip (
  curl.exe --fail --location --proto =https --tlsv1.2 "https://files.pythonhosted.org/packages/07/25/ee8c38ae72d66b844ce8eb9711ba905dba21ca1a8a0c960057c41cd23337/pip-26.3-py3-none-any.whl" -o runtime\pip.whl
  if errorlevel 1 goto fail
  certutil -hashfile runtime\pip.whl SHA256 | findstr /i /c:"f3b60b20ffaadd4415ed7957212a38ac63fa4c5fa375bd0f4a797777940fad13" >nul
  if errorlevel 1 goto fail
  runtime\python.exe -m zipfile -e runtime\pip.whl runtime\Lib\site-packages
  if errorlevel 1 goto fail
)
runtime\python.exe -m pip install --disable-pip-version-check --only-binary=:all: --require-hashes -r requirements.txt
if errorlevel 1 goto fail
runtime\python.exe -c "import ortools, openpyxl; print(ortools.__version__)"
if errorlevel 1 goto fail
>runtime\installed.txt echo Python 3.13.11 / OR-Tools 9.15.6755
:shortcut
cscript //nologo tools\shortcut.vbs "%cd%\start.cmd"
if errorlevel 1 goto fail
echo Setup complete. Open the desktop shortcut.
exit /b 0
:fail
echo Setup failed. Check the network, disk space and the preceding error.
exit /b 1
