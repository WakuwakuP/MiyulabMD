import type { SessionUser } from "@miyulabmd/shared";

import { ApiCommunicationError, requestJson } from "./api-transport.ts";
import { persistCachedViewerId, readCachedViewerId } from "./offline-cache.ts";

export type ViewerContext = {
  mode: "authenticated" | "guest" | "cached" | "unavailable";
  user: SessionUser | null;
  cacheViewerId: string | null;
};

type MeResponse = {
  user: SessionUser | null;
};

function isSessionUser(value: unknown): value is SessionUser {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const user = value as Record<string, unknown>;
  return (
    typeof user.id === "string" &&
    user.id.length > 0 &&
    typeof user.email === "string" &&
    (typeof user.displayName === "string" || user.displayName === null)
  );
}

function isMeResponse(value: unknown): value is MeResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "user" in value &&
    (value.user === null || isSessionUser(value.user))
  );
}

function context(
  mode: ViewerContext["mode"],
  cacheViewerId: string | null,
  user: SessionUser | null = null,
): ViewerContext {
  return { cacheViewerId, mode, user };
}

async function cachedOrUnavailable(
  signal?: AbortSignal,
): Promise<ViewerContext> {
  try {
    const cacheViewerId = await readCachedViewerId({ signal });
    return cacheViewerId
      ? context("cached", cacheViewerId)
      : context("unavailable", null);
  } catch {
    if (signal?.aborted) {
      throw signal.reason;
    }
    return context("unavailable", null);
  }
}

async function authenticatedContext(
  user: SessionUser,
  signal?: AbortSignal,
): Promise<ViewerContext> {
  try {
    await persistCachedViewerId(user.id, { signal });
    if (signal?.aborted) {
      throw signal.reason;
    }
    return context("authenticated", user.id, user);
  } catch {
    if (signal?.aborted) {
      throw signal.reason;
    }
    return context("authenticated", null, user);
  }
}

export async function resolveViewerContext(
  options: { signal?: AbortSignal } = {},
): Promise<ViewerContext> {
  const { signal } = options;
  let result: Awaited<ReturnType<typeof requestJson<MeResponse>>>;
  try {
    result = await requestJson<MeResponse>("/api/me", {
      credentials: "include",
      signal,
    });
  } catch (error) {
    if (error instanceof ApiCommunicationError) {
      return cachedOrUnavailable(signal);
    }
    throw error;
  }

  if (result.ok) {
    if (!isMeResponse(result.data)) {
      return context("unavailable", null);
    }
    if (!result.data.user) {
      return cachedOrUnavailable(signal).then((cached) =>
        cached.mode === "cached"
          ? cached
          : context("guest", cached.cacheViewerId),
      );
    }
    return authenticatedContext(result.data.user, signal);
  }

  if (result.status === 401) {
    return cachedOrUnavailable(signal).then((cached) =>
      cached.mode === "cached"
        ? cached
        : context("guest", cached.cacheViewerId),
    );
  }
  if (result.status >= 500 && result.status <= 599) {
    return cachedOrUnavailable(signal);
  }
  return context("unavailable", null);
}
