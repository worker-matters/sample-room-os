type PublicUrlLike = {
  urlPath: string;
  recommendedUrl?: string;
  absoluteUrl?: string;
};

type OrderQrLinkLike = PublicUrlLike & {
  qrFormat?: "legacy_url" | "plain_text";
  qrPayload?: string;
};

export function urlForQrPath(link: PublicUrlLike) {
  return link.absoluteUrl ?? link.recommendedUrl ?? new URL(link.urlPath, window.location.origin).toString();
}

export function qrValueForOrderLink(link: OrderQrLinkLike) {
  if (link.qrFormat === "plain_text" && link.qrPayload) return link.qrPayload;
  return urlForQrPath(link);
}
