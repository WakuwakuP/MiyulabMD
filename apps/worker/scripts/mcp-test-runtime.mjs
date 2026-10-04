import { AsyncLocalStorage } from "node:async_hooks";
import { registerHooks } from "node:module";

const auth = new AsyncLocalStorage();
const features = new Map();

// Only Workers bindings and the Agents auth accessor are substituted. The MCP
// SDK, schemas, server factory, protocol handling and tool callbacks are real.
export const env = {
  DB: {
    prepare(sql) {
      return {
        bind(userId) {
          return {
            async first() {
              await Promise.resolve();
              const configured = features.get(userId) ?? {};
              const enabled =
                (sql.includes("para_spaces") && configured.para) ||
                (sql.includes("medallion_sets") && configured.medallion) ||
                (sql.includes("scheme IS NOT NULL") && configured.schemes);
              return enabled ? { x: 1 } : null;
            },
          };
        },
      };
    },
  },
};

export function configureFeatures(userId, configured) {
  features.set(userId, configured);
}

export function getMcpAuthContext() {
  return auth.getStore();
}

export function runAs(user, fn) {
  return auth.run({ props: { user } }, fn);
}

export function setupMcpTestRuntime() {
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      if (
        specifier === "cloudflare:workers" ||
        specifier === "agents/mcp/server"
      ) {
        const name =
          specifier === "cloudflare:workers" ? "env" : "getMcpAuthContext";
        return {
          shortCircuit: true,
          url: `data:text/javascript,export { ${name} } from ${JSON.stringify(import.meta.url)};`,
        };
      }
      return nextResolve(specifier, context);
    },
  });
}
