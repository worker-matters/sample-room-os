const folderCodeDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function yyyymmdd(date: Date) {
  return folderCodeDateFormatter.format(date).replace(/-/g, "");
}

export function folderCodePrefixForDate(date = new Date()) {
  return `SR${yyyymmdd(date)}`;
}

export function formatFolderCode(prefix: string, sequence: number) {
  return `${prefix}${String(sequence).padStart(3, "0")}`;
}

export function nextFolderCode(existingCodes: Iterable<string | undefined>, date = new Date()) {
  const prefix = folderCodePrefixForDate(date);
  let maxSequence = 0;

  for (const code of existingCodes) {
    if (!code?.startsWith(prefix)) {
      continue;
    }

    const sequence = Number(code.slice(prefix.length));
    if (Number.isInteger(sequence) && sequence > maxSequence) {
      maxSequence = sequence;
    }
  }

  return formatFolderCode(prefix, maxSequence + 1);
}
