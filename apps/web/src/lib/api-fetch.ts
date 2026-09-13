import { notifyDriveChanged } from "./drive-changed.ts";
import { runMutation } from "./viewing-access.ts";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const DRIVE_API_PREFIXES = ["/api/notes", "/api/folders"];

function isDriveMutation(input: RequestInfo | URL, method: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  let requestUrl: string | URL;
  if (typeof Request !== "undefined" && input instanceof Request) {
    requestUrl = input.url;
  } else if (input instanceof URL) {
    requestUrl = input.href;
  } else {
    requestUrl = input as string | URL;
  }
  let url: URL;
  try {
    url = new URL(requestUrl, window.location.href);
  } catch {
    return false;
  }
  return (
    url.origin === window.location.origin &&
    DRIVE_API_PREFIXES.some(
      (prefix) =>
        url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
    ) &&
    !READ_METHODS.has(method)
  );
}

export function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const method =
    init?.method?.toUpperCase() ??
    (typeof Request !== "undefined" && input instanceof Request
      ? input.method.toUpperCase()
      : "GET");
  const send = () => globalThis.fetch(input, init);
  const response = READ_METHODS.has(method) ? send() : runMutation(send);
  if (!isDriveMutation(input, method)) {
    return response;
  }
  return response.then((result) => {
    if (result.status >= 200 && result.status < 300 && !result.redirected) {
      notifyDriveChanged();
    }
    return result;
  });
}
