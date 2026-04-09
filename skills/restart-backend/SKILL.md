---
name: restart-backend
description: >
  Kill the running backend and relaunch with --reload.
  Trigger on: "restart", "riavvia", "backend morto", "non risponde".
---

# Restart Backend

## Steps

1. Kill all Python processes:
   ```powershell
   powershell.exe -Command "Get-Process python -ErrorAction SilentlyContinue | Stop-Process -Force"
   ```

2. Wait for port to free:
   ```bash
   sleep 2
   ```

3. Verify port is free:
   ```bash
   curl -s --max-time 2 http://localhost:5101/api/health && echo "ERROR: backend still alive" || echo "OK: port free"
   ```

4. Relaunch with --reload (background):
   ```bash
   cd C:/Users/upper/Documents/00_aycb_v2 && python -m uvicorn src.api:app --host 0.0.0.0 --port 5101 --reload &
   ```

5. Wait and verify:
   ```bash
   sleep 4 && curl -s http://localhost:5101/api/health
   ```

6. Confirm the `started_at` timestamp is recent (within last 30 seconds).

## If it fails

- Check if another process holds port 5101: `netstat -ano | grep :5101`
- Kill specific PID: `taskkill //PID <pid> //F`
- If nothing works, user must close the CMD window manually and relaunch AYCB Studio.bat
