export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) {
    return;
  }
  if (!("serviceWorker" in navigator)) {
    return;
  }

  void import("virtual:pwa-register")
    .then(({ registerSW }) => {
      registerSW({
        immediate: true,
        onNeedRefresh() {
          // Prompt registration: apply after all tabs are closed (no auto reload).
        },
        onOfflineReady() {
          // Intentionally empty — do not advertise offline readiness before shell is verified.
        },
      });
    })
    .catch(() => {
      // SW registration failed; keep the React app running.
    });
}
