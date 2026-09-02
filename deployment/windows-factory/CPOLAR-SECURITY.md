# cpolar public access safety checklist

This repository is still in pre-deployment. The values below must be verified on
the eventual factory server; they must not be guessed from the development PC.

## Exposed service

- Publish only the application on TCP 3001.
- Do not publish PostgreSQL, Docker, SMB, RDP, SSH, WinRM, or the lifecycle
  runner on 3002.
- Port 5173 is a development-only Vite server. A formal build is served by the
  Node application on 3001.

## Trusted proxy verification

Express must not use `trust proxy=true`. Before setting
`SAMPLE_ROOM_TRUST_PROXY`, make one controlled request through the real cpolar
tunnel and record:

1. the socket peer address seen by Node;
2. the exact `X-Forwarded-For` chain;
3. the exact `X-Forwarded-Proto` value;
4. whether direct LAN requests contain either forwarded header.

Only the stable, verified proxy address or CIDR may be configured. Repeat this
check after changing the cpolar topology. A wrong trust setting lets an Internet
client forge its IP or HTTPS status; an overly strict setting prevents secure
cookies from being issued through the tunnel.

## Public HTTPS and LAN HTTP

- Put the final HTTPS host in `SAMPLE_ROOM_PUBLIC_HTTPS_HOSTS`.
- Put explicitly allowed browser origins in `SAMPLE_ROOM_CORS_ORIGINS`.
- HSTS is emitted only for a configured public HTTPS host.
- Session cookies are `Secure` only when the request is verified as HTTPS
  through the trusted proxy. Direct factory-LAN HTTP therefore remains usable.

## Before opening the tunnel

- Confirm the formal container refuses to start unless auth is `formal`,
  persistence is `prisma`, `DATABASE_URL` is present, and storage is writable.
- Confirm `/health` exposes only `ok` and `service`.
- Confirm the factory Compose file has no PostgreSQL host port and binds 3002
  only to `127.0.0.1`.
- Run the manual public HTTPS login, upload, download, and logout checklist.

Update-package digital signing remains a follow-up task. The package-size limit
is configurable through `SAMPLE_ROOM_UPDATE_MAX_BYTES`; changing the limit does
not replace signature verification.
