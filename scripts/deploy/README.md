# Deploy Scripts

Deployment helpers must follow `docs/current/CURRENT_PROJECT_RULES.md`.

Current deployment direction is factory local server first, with Oray/FRP only as a Web/API public entry and optional HTTPS reverse proxy. Do not add archived deployment experiment helpers here.

Do not expose PostgreSQL, SMB, RDP, SSH, WinRM, or other management ports through Oray/FRP.
