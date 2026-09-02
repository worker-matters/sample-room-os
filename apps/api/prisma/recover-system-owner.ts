import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import {
  listRecoverableSystemOwners,
  recoverSystemOwner,
  SystemOwnerRecoveryError
} from "../src/modules/system-owner/systemOwnerRecovery.js";

const prisma = new PrismaClient();

async function main() {
  const command = process.argv[2];
  if (command === "list") {
    const accounts = await listRecoverableSystemOwners(prisma);
    console.log(`RECOVERY_ACCOUNTS_JSON=${JSON.stringify(accounts)}`);
    return;
  }

  if (command === "recover") {
    const input = JSON.parse(readFileSync(0, "utf8").replace(/^\uFEFF/, "")) as {
      accountId?: unknown;
      newPassword?: unknown;
    };
    if (typeof input.accountId !== "string" || typeof input.newPassword !== "string") {
      throw new Error("invalid_recovery_input");
    }
    const result = await recoverSystemOwner(prisma, input.accountId, input.newPassword);
    console.log(`RECOVERY_RESULT_JSON=${JSON.stringify({
      username: result.username,
      recoveredAt: result.recoveredAt
    })}`);
    return;
  }

  throw new Error("invalid_recovery_command");
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error: unknown) => {
    const safeCode =
      error instanceof SystemOwnerRecoveryError
        ? error.code
        : error instanceof SyntaxError || (error instanceof Error && error.message === "invalid_recovery_input")
          ? "invalid_input"
          : error instanceof Error && error.message === "invalid_recovery_command"
            ? "invalid_command"
            : "operation_failed";
    console.error(`RECOVERY_ERROR=${safeCode}`);
    await prisma.$disconnect();
    process.exit(1);
  });
