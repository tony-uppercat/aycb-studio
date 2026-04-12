@echo off
:: Self-elevate to admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

netsh advfirewall firewall delete rule name="AYCB 5100" >nul 2>&1
netsh advfirewall firewall delete rule name="AYCB 5101" >nul 2>&1

netsh advfirewall firewall add rule name="AYCB 5100" dir=in action=allow protocol=tcp localport=5100 profile=any
netsh advfirewall firewall add rule name="AYCB 5101" dir=in action=allow protocol=tcp localport=5101 profile=any

echo.
echo  Firewall rules added for ports 5100 and 5101
echo.
pause
