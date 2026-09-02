import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/modules/auth/password.js";

const prisma = new PrismaClient();

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function main() {
  const existing = await prisma.account.findFirst({
    where: { role: "system_owner", status: { not: "archived" } },
    select: { id: true, username: true }
  });

  if (existing) {
    console.log(`System Owner already exists (${existing.username ?? existing.id}); no changes made.`);
    return;
  }

  const username = required("INITIAL_SYSTEM_OWNER_USERNAME");
  const displayName = required("INITIAL_SYSTEM_OWNER_DISPLAY_NAME");
  const password = required("INITIAL_SYSTEM_OWNER_PASSWORD");

  if (password.length < 12) {
    throw new Error("INITIAL_SYSTEM_OWNER_PASSWORD must contain at least 12 characters.");
  }

  await prisma.account.create({
    data: {
      username,
      displayName,
      accountType: "business",
      role: "system_owner",
      status: "active",
      passwordHash: hashPassword(password),
      mustChangePasswordAtNextLogin: true
    }
  });

  console.log(`Created initial System Owner account: ${username}`);
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
