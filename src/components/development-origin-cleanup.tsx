"use client";

import { useEffect } from "react";

const RELOAD_MARKER = "relaybuy-live-migration-reloaded-v1";

async function clearDevelopmentOrigin(): Promise<boolean> {
  const registrations =
    "serviceWorker" in navigator
      ? await navigator.serviceWorker.getRegistrations()
      : [];

  const cacheNames = "caches" in window ? await caches.keys() : [];

  await Promise.all([
    ...registrations.map((registration) => registration.unregister()),
    ...cacheNames.map((cacheName) => caches.delete(cacheName)),
  ]);

  return registrations.length > 0 || cacheNames.length > 0;
}

export function DevelopmentOriginCleanup() {
  useEffect(() => {
    let cancelled = false;

    void clearDevelopmentOrigin()
      .then((clearedStaleState) => {
        if (
          cancelled ||
          !clearedStaleState ||
          sessionStorage.getItem(RELOAD_MARKER) === "true"
        ) {
          return;
        }

        sessionStorage.setItem(RELOAD_MARKER, "true");
        window.location.reload();
      })
      .catch(() => {
        // Some privacy modes deny service-worker or Cache Storage access.
        // RelayBuy remains usable; the user can clear localhost site data.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
