/** Optional secrets (not listed under [vars] in wrangler.toml). */
declare namespace Cloudflare {
  interface Env {
    ACCESS_AUD?: string;
    SESSION_SECRET?: string;
  }
}

interface Env {
  ACCESS_AUD?: string;
  SESSION_SECRET?: string;
}

interface CacheStorage {
  readonly default: Cache;
}
