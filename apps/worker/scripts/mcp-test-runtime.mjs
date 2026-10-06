import { AsyncLocalStorage } from "node:async_hooks";
import { registerHooks } from "node:module";

const auth = new AsyncLocalStorage();
const features = new Map();
let featureReads = 0;

// Only Workers bindings and the Agents auth accessor are substituted. The MCP
// SDK, schemas, server factory, protocol handling and tool callbacks are real.
export const env = {
  DB: {
    prepare(sql) {
      return {
        bind(userId) {
          return {
            async first() {
              featureReads += 1;
              await Promise.resolve();
              const configured = features.get(userId) ?? {};
              if (sql.includes("AS hasPara")) {
                return {
                  hasMedallion: Number(Boolean(configured.medallion)),
                  hasPara: Number(Boolean(configured.para)),
                  hasSchemes: Number(Boolean(configured.schemes)),
                };
              }
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

export function getFeatureReadCount() {
  return featureReads;
}

export function resetFeatureReadCount() {
  featureReads = 0;
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
