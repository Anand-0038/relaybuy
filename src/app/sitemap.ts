import type { MetadataRoute } from "next";

import { getSiteUrl } from "../config/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = getSiteUrl();
  const lastModified = new Date("2026-07-28T00:00:00.000Z");

  return [
    {
      url: new URL("/", baseUrl).toString(),
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: new URL("/privacy", baseUrl).toString(),
      lastModified,
      changeFrequency: "monthly",
      priority: 0.3,
    },
  ];
}
