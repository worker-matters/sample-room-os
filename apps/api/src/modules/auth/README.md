# Auth Module

Owns login, logout, current user, session boundaries, and password policy. It must separate `system_owner` from `boss`.

Current slice uses mock session headers:

- `x-mock-role`
- `x-mock-user-id`
- `x-mock-customer-id`
- `x-mock-client-user-id`

This is for API and service tests only. Real authentication is still pending.
