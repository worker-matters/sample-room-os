# Android V1 Scope

- This app is a mobile client for the existing Sample Room Express API.
- AccountSession, Account role, WorkerProfile, permissions, workflow state, and allowed actions come from the server.
- Never implement a second order state machine or client-side permission source.
- The client never submits a trusted accountId, role, WorkerProfile ID, or allowedActions.
- Order QR payloads are `SRS2|ORDER|<opaque-token>` and are resolved by the existing API.
- Keep UI structure and terminology aligned with `apps/wechat-miniprogram` and existing mobile Web pages.
- Real LAN/public API bases are runtime network settings stored in app-private preferences after
  scanning a validated `SRS2|NETWORK_CONFIG|1|...` QR. They must not be compiled into BuildConfig,
  committed, or mixed with credentials.
- Do not commit passwords, tokens, real API addresses, signing keys, or customer data.
