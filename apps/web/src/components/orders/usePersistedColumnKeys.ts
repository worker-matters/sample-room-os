import { useEffect, useState } from "react";

function readColumnKeys<Key extends string>(
  storageKey: string,
  allowedKeys: readonly Key[],
  defaultKeys: readonly Key[]
) {
  if (typeof window === "undefined") {
    return [...defaultKeys];
  }

  try {
    const stored = JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
    if (!Array.isArray(stored)) {
      return [...defaultKeys];
    }
    const allowed = new Set<string>(allowedKeys);
    return stored.filter((value): value is Key => typeof value === "string" && allowed.has(value));
  } catch {
    return [...defaultKeys];
  }
}

export function usePersistedColumnKeys<Key extends string>(
  storageKey: string,
  allowedKeys: readonly Key[],
  defaultKeys: readonly Key[]
) {
  const [visibleKeys, setVisibleKeys] = useState<Key[]>(() =>
    readColumnKeys(storageKey, allowedKeys, defaultKeys)
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(visibleKeys));
    } catch {
      // Column preferences are optional; storage restrictions must not break the page.
    }
  }, [storageKey, visibleKeys]);

  return [visibleKeys, setVisibleKeys] as const;
}
