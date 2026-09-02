export const ROLES = {
  systemOwner: "system_owner",
  boss: "boss",
  receiver: "receiver",
  patternMaker: "pattern_maker",
  planner: "planner",
  clientAdmin: "client_admin",
  clientBusinessUser: "client_business_user",
  worker: "worker"
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const CLIENT_ROLES = [ROLES.clientAdmin, ROLES.clientBusinessUser] as const;

export type ClientRole = (typeof CLIENT_ROLES)[number];

export function isClientRole(role: Role): role is ClientRole {
  return CLIENT_ROLES.includes(role as ClientRole);
}

export const ROLE_LABELS: Record<Role, string> = {
  system_owner: "System Owner",
  boss: "老板",
  receiver: "接单员",
  pattern_maker: "版师",
  planner: "计划员",
  client_admin: "客户主管",
  client_business_user: "客户业务员",
  worker: "生产员工"
};
