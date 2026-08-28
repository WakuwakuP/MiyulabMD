interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  DOCUMENT_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
  ALLOW_ANONYMOUS: string;
  ALLOW_ANONYMOUS_EDITS: string;
  ALLOW_ANONYMOUS_VIEWS: string;
  DEFAULT_PERMISSION: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD?: string;
  SESSION_SECRET?: string;
}
