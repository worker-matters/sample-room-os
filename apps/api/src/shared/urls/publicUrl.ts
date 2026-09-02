export function normalizeBaseUrl(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/+$/, "") : undefined;
}

export function pathWithLeadingSlash(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}

export function publicUrlForPath(path: string, env: NodeJS.ProcessEnv = process.env) {
  const publicBaseUrl = normalizeBaseUrl(env.SAMPLE_ROOM_PUBLIC_BASE_URL);
  return publicBaseUrl ? `${publicBaseUrl}${pathWithLeadingSlash(path)}` : undefined;
}
