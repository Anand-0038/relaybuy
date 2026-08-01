import type { MetadataRoute } from "next";

import { getSiteUrl } from "../config/site";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getSiteUrl();

  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/privacy"],
      disallow: ["/api/", "/approve/", "/requests/", "/receipt/", "/internal/"],
    },
    sitemap: new URL("/sitemap.xml", baseUrl).toString(),
    host: baseUrl.origin,
  };
}
