import type { AccountRepository } from "../../db/repositories/contracts/index.js";

export type AccountDisplayNameMap = ReadonlyMap<string, string>;

export async function loadAccountDisplayNames(
  accounts: AccountRepository
): Promise<AccountDisplayNameMap> {
  return new Map(
    (await accounts.listAccounts()).map((account) => [account.id, account.displayName])
  );
}

export function currentAccountDisplayName(
  accountNames: AccountDisplayNameMap,
  accountId: string | undefined,
  historicalName?: string
) {
  return (accountId ? accountNames.get(accountId) : undefined) ?? historicalName;
}
