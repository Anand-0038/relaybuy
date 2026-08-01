import { getSiteUrl } from "../../../config/site";

export const dynamic = "force-static";

export function GET(): Response {
  const siteUrl = getSiteUrl();
  const contact =
    process.env.RELAYBUY_SECURITY_EMAIL?.trim() || "security@a2zbtc.com";
  const body = [
    `Contact: mailto:${contact}`,
    `Canonical: ${new URL("/.well-known/security.txt", siteUrl).toString()}`,
    "Preferred-Languages: en",
    "Policy: https://www.prava.space/security",
    "Expires: 2027-08-31T23:59:59.000Z",
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
