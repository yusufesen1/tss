@echo off
chcp 65001 >nul 2>&1
title TSS Rota Planlama Paneli
cd /d "%~dp0server"

echo ============================================
echo   TSS Rota Planlama Paneli baslatiliyor...
echo ============================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [HATA] Node.js bulunamadi.
    echo.
    echo Bu programin calismasi icin once Node.js kurmaniz gerekiyor:
    echo   https://nodejs.org  ^(LTS surumunu indirin^)
    echo.
    echo Kurulumdan sonra bu dosyaya tekrar cift tiklayin.
    echo.
    pause
    exit /b 1
)

for /f "delims=" %%v in ('node -v') do echo Node.js bulundu: %%v

if not exist ".env" (
    echo .env dosyasi olusturuluyor ^(.env.example sablonundan^)...
    copy ".env.example" ".env" >nul
)

if not exist "node_modules" (
    echo.
    echo Ilk calistirma - bagimliliklar kuruluyor, bu birkac dakika surebilir...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo [HATA] npm install basarisiz oldu - yukaridaki hata mesajina bakin.
        pause
        exit /b 1
    )
)

echo.
echo Sunucu baslatiliyor, tarayicida panel birazdan acilacak...
echo Bu pencereyi kapatirsaniz sunucu durur.
echo.

start "" /min cmd /c "%~dp0server\scripts\open-browser-delayed.bat"

call npm start

echo.
echo Sunucu durdu.
pause
