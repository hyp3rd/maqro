import { getAppUrl } from "@/lib/app-url";
import type { MetadataRoute } from "next";

/** XML sitemap for crawlers.
 *
 *  Lists only the publicly-indexable routes — anything behind auth
 *  (`/app`, `/admin`, anything under `/api`) is intentionally
 *  excluded; the matching `robots.ts` `disallow` block backstops
 *  that exclusion.
 *
 *  `lastModified` uses the deploy time (best signal we have without
 *  per-page content versioning). Most marketing pages move
 *  infrequently; the privacy and terms pages move on schedule, so
 *  we tag them with explicit dates from their last edit.
 *
 *  Routes are returned in priority order — most-important first.
 *  Search engines treat this as a hint, not a directive. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = getAppUrl();
  const now = new Date();

  return [
    {
      url: `${base}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${base}/pricing`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${base}/about`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${base}/status`,
      lastModified: now,
      changeFrequency: "always",
      priority: 0.6,
    },
    {
      url: `${base}/login`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${base}/help`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${base}/contact`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.5,
    },
    {
      url: `${base}/changelog`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${base}/privacy`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.4,
    },
    {
      url: `${base}/terms`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.4,
    },
  ];
}
