import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifySwRoute,
  isAppNavigationPathname,
  isAppNavigationRequest,
  isOpenApiJsonGet,
  isServerEndpointPathname,
  isServerEndpointRequest,
} from "./sw-routes.ts";

test("server endpoint prefixes match exact path and subpaths", () => {
  for (const prefix of ["/api", "/auth", "/ws", "/mcp"] as const) {
    assert.equal(isServerEndpointPathname(prefix), true);
    assert.equal(isServerEndpointPathname(`${prefix}/nested`), true);
  }
  assert.equal(isServerEndpointPathname("/api/notes/x/images/y"), true);
});

test("server endpoint prefixes reject lookalike paths", () => {
  assert.equal(isServerEndpointPathname("/apifoo"), false);
  assert.equal(isServerEndpointPathname("/authx/login"), false);
  assert.equal(isServerEndpointPathname("/wsocket"), false);
});

test("openapi.json is a server endpoint for GET only", () => {
  assert.equal(isOpenApiJsonGet("/openapi.json", "GET"), true);
  assert.equal(isOpenApiJsonGet("/openapi.json", "POST"), false);
});

test("query strings do not bypass server endpoint classification", () => {
  assert.equal(isServerEndpointRequest("/auth/login?next=%2F", "GET"), true);
  assert.equal(isServerEndpointRequest("/api/notes/abc?draft=1", "GET"), true);
});

test("non-GET methods on server paths stay server endpoints", () => {
  assert.equal(isServerEndpointRequest("/api/notes", "POST"), true);
  assert.equal(isServerEndpointRequest("/auth/logout", "POST"), true);
  assert.equal(isServerEndpointRequest("/mcp", "DELETE"), true);
});

test("auth login navigation is not app navigation", () => {
  assert.equal(isAppNavigationRequest("/auth/login", "GET"), false);
  assert.equal(isAppNavigationPathname("/auth/login"), false);
});

test("app navigation covers core routes and subpaths", () => {
  const paths = [
    "/",
    "/n/note-id",
    "/n/note-id/history",
    "/s/share-id",
    "/f/folder-id",
    "/shared",
    "/shared/recent",
    "/shared-by-me",
    "/shared-by-me/outgoing",
    "/settings",
    "/settings/profile",
  ];
  for (const pathname of paths) {
    assert.equal(isAppNavigationPathname(pathname), true, pathname);
    assert.equal(isAppNavigationRequest(pathname, "GET"), true, pathname);
  }
});

test("app navigation ignores non-GET methods", () => {
  assert.equal(isAppNavigationRequest("/n/note-id", "POST"), false);
  assert.equal(isAppNavigationRequest("/settings/profile", "PATCH"), false);
});

test("app navigation rejects API-like paths", () => {
  assert.equal(isAppNavigationPathname("/api/notes/x"), false);
  assert.equal(isAppNavigationRequest("/api/notes/x/images/y", "GET"), false);
});

test("classifySwRoute respects same-origin and mode", () => {
  assert.equal(
    classifySwRoute({
      method: "GET",
      mode: "navigate",
      pathname: "/n/abc",
      sameOrigin: true,
    }),
    "app-navigation",
  );
  assert.equal(
    classifySwRoute({
      method: "GET",
      mode: "navigate",
      pathname: "/auth/login",
      sameOrigin: true,
    }),
    "server-endpoint",
  );
  assert.equal(
    classifySwRoute({
      method: "GET",
      mode: "cors",
      pathname: "/n/abc",
      sameOrigin: true,
    }),
    "precache-candidate",
  );
  assert.equal(
    classifySwRoute({
      method: "GET",
      mode: "navigate",
      pathname: "/n/abc",
      sameOrigin: false,
    }),
    "precache-candidate",
  );
});
