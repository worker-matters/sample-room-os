import { PrismaClient } from "@prisma/client";
import { FIXED_IDENTITY_ACCOUNTS, FIXED_WORKER_PROFILES } from "../src/db/fixtures/identityFixtures.js";

const prisma = new PrismaClient();

const customers = [
  { id: "mock-customer-active", name: "Mock Active Customer", status: "active" as const },
  { id: "mock-customer-other", name: "Mock Other Customer", status: "active" as const },
  { id: "mock-customer-archived", name: "Mock Archived Customer", status: "archived" as const }
];

const clientUsers = [
  { id: "mock-client-user-active", customerId: "mock-customer-active", accountId: "formal-account-client-business", displayName: "Customer A Business User", status: "active" as const, clientAccessScope: "own" as const },
  { id: "mock-client-user-admin", customerId: "mock-customer-active", accountId: "formal-account-client-admin", displayName: "Customer A Admin", status: "active" as const, clientAccessScope: "customer_all" as const },
  { id: "mock-client-user-second", customerId: "mock-customer-active", accountId: "formal-account-client-business-second", displayName: "Customer A Business User 2", status: "active" as const, clientAccessScope: "own" as const },
  { id: "mock-client-user-other", customerId: "mock-customer-other", accountId: "formal-account-client-business-other", displayName: "Customer B Business User", status: "active" as const, clientAccessScope: "own" as const },
  { id: "mock-client-user-archived", customerId: "mock-customer-active", accountId: "formal-account-client-business-archived", displayName: "Archived Client Business User", status: "archived" as const, clientAccessScope: "own" as const }
];

async function main() {
  for (const customer of customers) {
    await prisma.customer.upsert({ where: { id: customer.id }, update: customer, create: customer });
  }

  for (const account of FIXED_IDENTITY_ACCOUNTS) {
    const data = {
      username: account.username,
      phoneNumber: account.phoneNumber,
      displayName: account.displayName,
      accountType: account.accountType,
      role: account.role,
      status: account.status,
      passwordHash: account.passwordHash,
      mustChangePasswordAtNextLogin: account.mustChangePasswordAtNextLogin
    };
    await prisma.account.upsert({ where: { id: account.id }, update: data, create: { id: account.id, ...data } });
  }

  for (const clientUser of clientUsers) {
    await prisma.clientUser.upsert({ where: { id: clientUser.id }, update: clientUser, create: clientUser });
  }

  for (const profile of FIXED_WORKER_PROFILES) {
    const data = {
      accountId: profile.accountId,
      workerType: profile.workerType,
      status: profile.status,
      effectiveAt: new Date(profile.effectiveAt),
      endedAt: profile.endedAt ? new Date(profile.endedAt) : null
    };
    await prisma.workerProfile.upsert({ where: { id: profile.id }, update: data, create: { id: profile.id, ...data } });
  }
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
