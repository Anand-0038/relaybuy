import { parse } from "tldts";
import { z } from "zod";

function hasDelegatedPublicSuffix(hostname: string): boolean {
  const result = parse(hostname, { allowPrivateDomains: false });
  return Boolean(result.domain && result.isIcann);
}

export const pravaCustomerEmailSchema = z.email().refine((value) => {
  const domain = value.slice(value.lastIndexOf("@") + 1).toLowerCase();
  return hasDelegatedPublicSuffix(domain);
}, "Prava customer email must use a publicly delegated domain");

export const pravaMerchantOriginSchema = z.url().refine((value) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      hasDelegatedPublicSuffix(url.hostname)
    );
  } catch {
    return false;
  }
}, "Prava merchant URL must be a bare HTTPS origin on a publicly delegated domain");

export function toPravaMerchantOrigin(sourceUrl: string): string {
  return pravaMerchantOriginSchema.parse(new URL(sourceUrl).origin);
}
