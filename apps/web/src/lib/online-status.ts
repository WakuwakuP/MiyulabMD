let online = typeof navigator === "undefined" ? true : navigator.onLine;

/** Last known browser online hint. Not proof of reachability. */
export function isOnline(): boolean {
  return online;
}

/** Subscribe to `navigator.onLine` changes. Returns an unsubscribe function. */
export function subscribeOnlineStatus(
  listener: (nextOnline: boolean) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {
      /* SSR: no listeners */
    };
  }
  const onOnline = () => {
    online = true;
    listener(true);
  };
  const onOffline = () => {
    online = false;
    listener(false);
  };
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
  };
}
