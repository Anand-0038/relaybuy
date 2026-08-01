const DEFAULT_SITE_URL = "https://relaybuy.a2zbtc.com";

export const siteName = "RelayBuy";
export const siteDescription =
  "RelayBuy binds verified merchant facts, deterministic policy, and explicit approval before Prava issues payment credentials.";

export function getSiteUrl(): URL {
  const candidate = process.env.APP_BASE_URL?.trim() || DEFAULT_SITE_URL;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.hostname !== "localhost") {
      throw new Error("Public site URLs must use HTTPS");
    }
    return url;
  } catch (error) {
    throw new Error("APP_BASE_URL must be an absolute HTTPS URL", {
      cause: error,
    });
  }
}
