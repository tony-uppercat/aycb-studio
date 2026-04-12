Write-Host ""
Write-Host "  AYCB Studio   http://localhost:5100"
Write-Host "  Review Hub    http://localhost:5100/review"
Write-Host ""
$ips = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -match '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)' } |
    ForEach-Object { $_.IPAddress }
foreach ($ip in $ips) {
    Write-Host "  LAN           http://${ip}:5100/review"
}
Write-Host ""
