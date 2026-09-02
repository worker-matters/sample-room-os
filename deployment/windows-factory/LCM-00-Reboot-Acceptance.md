# LCM-00 Windows Restart Acceptance

Complete this checklist on the factory server. Do not treat configuration inspection as proof
that restart recovery works.

## Report references

- Pre-restart LCM-00 report ID/path:
- Post-login LCM-00 report ID/path:
- Factory run account:
- Windows restart time:
- Operator:

## Checklist

- [ ] 1. Record the pre-restart `postgres` and `api` container states.
- [ ] 2. Restart Windows.
- [ ] 3. Log in with the fixed factory run account.
- [ ] 4. Do not run `docker compose up` or manually start the containers.
- [ ] 5. Wait for Docker Desktop to start automatically.
- [ ] 6. Confirm `postgres` and `api` recover automatically.
- [ ] 7. Confirm the `SampleRoomLifecycleRunner` scheduled task started under the fixed factory run account without manually starting PowerShell.
- [ ] 8. From the current deployment package, run `Factory-Deploy.ps1 -Action Status` with the existing environment/config path overrides and record the Runner task state.
- [ ] 9. Confirm `http://127.0.0.1:3001/health` returns HTTP 200 with only `ok` and `service`.
- [ ] 10. Confirm `http://<factory-ip>:3001` is reachable from the factory LAN.
- [ ] 11. Create one read-only `diagnostic` maintenance task and confirm the scheduled Runner completes it after restart/login. Do not use restore, update, or storage migration as acceptance tasks.
- [ ] 12. Confirm the `FACTORY_DATA_ROOT_HOST\application` and `SAMPLE_ROOM_STORAGE_ROOT` mounts work, and an existing authorized attachment can still be read through the application.
- [ ] 13. Attach the scheduled-task state, diagnostic result, and this completed checklist to the LCM-00 report or record their paths/results against the report ID.

## Manual result

- Result: PASS / WARN / FAIL
- Observed problems:
- Required deployment prerequisites:
- Follow-up owner and date:
