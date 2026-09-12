const RELOAD_GUARD = "miyulabmd:sw-unregistered";

/** Drop leftover #104 service workers so the revert can take effect. */
export async function unregisterServiceWorkers(): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  const registrations = await navigator.serviceWorker.getRegistrations();
  if (registrations.length === 0) {
    return;
  }
  await Promise.all(
    registrations.map((registration) => registration.unregister()),
  );
  if ("caches" in globalThis) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
  try {
    if (sessionStorage.getItem(RELOAD_GUARD) === "1") {
      return;
    }
    sessionStorage.setItem(RELOAD_GUARD, "1");
  } catch {
    /* ignore quota / private mode */
  }
  window.location.reload();
}
