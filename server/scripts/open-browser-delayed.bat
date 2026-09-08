@echo off
REM baslat.bat tarafindan ayri/arka planda calistirilir: sunucunun ayaga
REM kalkmasi icin kisa bir sure bekleyip tarayicida paneli acar. Ayri bir
REM dosya olmasinin nedeni: ana script npm start'i ON PLANDA (foreground)
REM calistirir ki pencereyi kapatinca sunucu dursun; bu bekleme/acma islemi
REM o yuzden PARALEL, ayri bir surecte olmak zorunda.
ping -n 3 127.0.0.1 >nul
start "" http://localhost:3000
