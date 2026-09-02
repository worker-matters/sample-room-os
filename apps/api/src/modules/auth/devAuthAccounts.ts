import { CLIENT_ACCESS_SCOPES, ROLES } from "@sample-room/shared";
import type { AuthAccountRecord } from "./authTypes.js";

// Local memory-mode seed password for development and tests only.
// Production account creation/reset must generate or receive a non-hardcoded password.
export const FORMAL_LOGIN_DEV_PASSWORD = "SampleRoom@123";

export const FORMAL_LOGIN_DEV_ACCOUNTS: AuthAccountRecord[] = [
  {
    id: "formal-user-client-own",
    username: "client-own@sample-room.test",
    displayName: "Customer A Business User",
    role: ROLES.clientBusinessUser,
    status: "active",
    customerId: "mock-customer-active",
    clientUserId: "mock-client-user-active",
    clientAccessScope: CLIENT_ACCESS_SCOPES.own,
    passwordHash:
      "scrypt$formal-login-client-own$tqBxMRsQ75je4fkqnXU4_ROlbDnMjx6-cadKXfdWfcags5o0hPMxBKJdoklJKCYoMrhVR0rz_JOc9ywC-4Uz1Q"
  },
  {
    id: "formal-user-client-admin",
    username: "client-admin@sample-room.test",
    displayName: "Customer A Supervisor",
    role: ROLES.clientAdmin,
    status: "active",
    customerId: "mock-customer-active",
    clientUserId: "mock-client-user-admin",
    clientAccessScope: CLIENT_ACCESS_SCOPES.customerAll,
    passwordHash:
      "scrypt$formal-login-client-admin$_nUkX6bs2QhZtWxWhPd_a397hNNi_KEUxifxpY2RzdvMCmgejLWxf7iPfOXqB0cjFgivCfQoSMqwagW1RHR1ww"
  },
  {
    id: "formal-user-client-second",
    username: "client-second@sample-room.test",
    displayName: "Customer A Second Business User",
    role: ROLES.clientBusinessUser,
    status: "active",
    customerId: "mock-customer-active",
    clientUserId: "mock-client-user-second",
    clientAccessScope: CLIENT_ACCESS_SCOPES.own,
    passwordHash:
      "scrypt$formal-login-client-second$vgggscHl0v5RKNp28b3Q06IGVmwmf507lAwt1wxonupxFUheLCjqSommcTOTqBHGBaFj2P14HBh04oGsleVYcw"
  },
  {
    id: "formal-user-client-other",
    username: "client-other@sample-room.test",
    displayName: "Customer B Business User",
    role: ROLES.clientBusinessUser,
    status: "active",
    customerId: "mock-customer-other",
    clientUserId: "mock-client-user-other",
    clientAccessScope: CLIENT_ACCESS_SCOPES.own,
    passwordHash:
      "scrypt$formal-login-client-other$XyVYnUUevmJtUGGSOrq21IHVBIzj9eCURfLl7ERGQrtmWl27Exaho2ZSX6uYSldI_MIyxLS24ZOQYzpz5LPMzA"
  },
  {
    id: "formal-user-receiver",
    username: "receiver@sample-room.test",
    displayName: "Receiver",
    role: ROLES.receiver,
    status: "active",
    passwordHash:
      "scrypt$formal-login-receiver$T8NZ-wxT3mM9qSe96GgUZXMxFjo1bYLi4AXMbPIEmyDC746gp7PvFNtLL717IYa2_oPhcUsEXWAMJSVnjZLIMQ"
  },
  {
    id: "formal-user-pattern-maker",
    username: "pattern-maker@sample-room.test",
    displayName: "Pattern Maker",
    role: ROLES.patternMaker,
    status: "active",
    passwordHash:
      "scrypt$formal-login-pattern-maker$p3eT1IV1C2dtcpcVDeTXF3v-fRWohADKFtGzPEbZatwxnWWZ0pBkLMteLAXTfFOuIHf0czYAX5RvT7Cx1jifew"
  },
  {
    id: "formal-user-planner",
    username: "planner@sample-room.test",
    displayName: "Planner",
    role: ROLES.planner,
    status: "active",
    passwordHash:
      "scrypt$formal-login-receiver$T8NZ-wxT3mM9qSe96GgUZXMxFjo1bYLi4AXMbPIEmyDC746gp7PvFNtLL717IYa2_oPhcUsEXWAMJSVnjZLIMQ"
  },
  {
    id: "formal-user-boss",
    username: "boss@sample-room.test",
    displayName: "Boss",
    role: ROLES.boss,
    status: "active",
    passwordHash:
      "scrypt$formal-login-boss$iRT7u3Z6OgivQ6Xb7iiy-FUz1tRETT5LEVCo-0jxgf2fXQ52BqplYtf1bUU4ARqbw7rXuss-L6jwUQPN5G0Z8g"
  },
  {
    id: "formal-user-system-owner",
    username: "system-owner@sample-room.test",
    displayName: "System Owner",
    role: ROLES.systemOwner,
    status: "active",
    passwordHash:
      "scrypt$formal-login-system-owner$WIf76L06JP4Ly3LIJgpAH882-YoR8jFEHpoMUbnVs5wCp6jxy6w3RnlK3qWvH6j0vRKcwJq-5f_7mY2F9xlupA"
  },
  {
    id: "formal-user-disabled",
    username: "disabled@sample-room.test",
    displayName: "Disabled User",
    role: ROLES.receiver,
    status: "disabled",
    passwordHash:
      "scrypt$formal-login-disabled$0J6YN-lnS_Hur0WDnvNvw0qXN-LtikowYRrFqLlaPexfqVZ2TmKHpbossKCRm81AX5ESWFFvXlRJWP0PgSEQAw"
  }
];
