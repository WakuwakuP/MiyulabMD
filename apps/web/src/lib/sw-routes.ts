const SERVER_PREFIXES = ["/api", "/auth", "/ws", "/mcp"] as const;

export type SwRouteClass =
  | "server-endpoint"
  | "local-navigation"
  | "app-navigation"
  | "precache-candidate";

function pathnameMatchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isServerEndpointPathname(pathname: string): boolean {
  return SERVER_PREFIXES.some((prefix) =>
    pathnameMatchesPrefix(pathname, prefix),
  );
}

export function isOpenApiJsonGet(pathname: string, method: string): boolean {
  return pathname === "/openapi.json" && method === "GET";
}

/** Same-origin API, auth, WebSocket upgrade paths, and OpenAPI spec. */
export function isServerEndpointRequest(
  pathname: string,
  method: string,
): boolean {
  return (
    isServerEndpointPathname(pathname) || isOpenApiJsonGet(pathname, method)
  );
}

export function isLocalNavigationPathname(pathname: string): boolean {
  return /^\/n\/local-[^/]+(?:\/.*)?$/.test(pathname);
}

export function isLocalNavigationRequest(
  pathname: string,
  method: string,
): boolean {
  return method === "GET" && isLocalNavigationPathname(pathname);
}

export function isAppNavigationPathname(pathname: string): boolean {
  if (pathname === "/") {
    return true;
  }
  if (
    pathname === "/shared" ||
    pathname.startsWith("/shared/") ||
    pathname === "/shared-by-me" ||
    pathname.startsWith("/shared-by-me/")
  ) {
    return true;
  }
  if (pathname === "/settings" || pathname.startsWith("/settings/")) {
    return true;
  }
  if (isLocalNavigationPathname(pathname)) {
    return false;
  }
  if (/^\/n\/[^/]+(?:\/.*)?$/.test(pathname)) {
    return true;
  }
  if (/^\/s\/[^/]+(?:\/.*)?$/.test(pathname)) {
    return true;
  }
  if (/^\/f\/[^/]+(?:\/.*)?$/.test(pathname)) {
    return true;
  }
  return false;
}

export function isAppNavigationRequest(
  pathname: string,
  method: string,
): boolean {
  if (method !== "GET") {
    return false;
  }
  if (isServerEndpointRequest(pathname, method)) {
    return false;
  }
  return isAppNavigationPathname(pathname);
}

export function classifySwRoute(input: {
  pathname: string;
  method: string;
  sameOrigin: boolean;
  mode: RequestMode;
}): SwRouteClass {
  if (!input.sameOrigin) {
    return "precache-candidate";
  }
  if (isServerEndpointRequest(input.pathname, input.method)) {
    return "server-endpoint";
  }
  if (
    input.mode === "navigate" &&
    isLocalNavigationRequest(input.pathname, input.method)
  ) {
    return "local-navigation";
  }
  if (
    input.mode === "navigate" &&
    isAppNavigationRequest(input.pathname, input.method)
  ) {
    return "app-navigation";
  }
  return "precache-candidate";
}
