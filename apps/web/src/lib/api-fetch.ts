import { runMutation } from "./viewing-access.ts";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const method =
    init?.method?.toUpperCase() ??
    (input instanceof Request ? input.method.toUpperCase() : "GET");
  const send = () => globalThis.fetch(input, init);
  return READ_METHODS.has(method) ? send() : runMutation(send);
}
