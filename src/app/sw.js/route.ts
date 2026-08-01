const cleanupWorker = `
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((names) =>
        Promise.all(names.map((name) => caches.delete(name))),
      ),
      self.registration.unregister(),
    ]).then(() =>
      self.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((clients) =>
          Promise.all(
            clients.map((client) =>
              "navigate" in client ? client.navigate(client.url) : undefined,
            ),
          ),
        ),
    ),
  );
});
`;

export function GET(): Response {
  return new Response(cleanupWorker, {
    headers: {
      "cache-control": "no-store, max-age=0",
      "content-type": "text/javascript; charset=utf-8",
      "service-worker-allowed": "/",
    },
  });
}
