const errorSchema = {
  properties: {
    code: { type: "string" },
    error: { type: "string" },
  },
  required: ["error"],
  type: "object",
} as const;

const noteSchema = {
  properties: {
    createdAt: { type: "integer" },
    folder: { type: "string" },
    folderId: { nullable: true, type: "string" },
    id: { format: "uuid", type: "string" },
    markdown: { type: "string" },
    ownerId: { type: "string" },
    shortId: { type: "string" },
    title: { type: "string" },
    updatedAt: { type: "integer" },
  },
  required: ["id", "shortId", "ownerId", "title", "markdown"],
  type: "object",
} as const;

const schemaField = {
  properties: {
    default: {},
    enum: {
      items: { type: "string" },
      type: "array",
    },
    fixed: { type: "boolean" },
    key: { type: "string" },
    required: { type: "boolean" },
    type: {
      enum: ["string", "number", "boolean", "date", "string[]"],
      type: "string",
    },
  },
  required: ["key", "type"],
  type: "object",
} as const;

const collection = {
  properties: {
    folder: { type: "string" },
    id: { format: "uuid", type: "string" },
    name: { type: "string" },
    schema: { items: schemaField, type: "array" },
  },
  required: ["id", "name", "folder", "schema"],
  type: "object",
} as const;

const entry = {
  properties: {
    createdAt: { type: "integer" },
    data: { additionalProperties: true, type: "object" },
    editUrl: { format: "uri", type: "string" },
    folder: { type: "string" },
    id: { format: "uuid", type: "string" },
    markdown: { type: "string" },
    slug: { type: "string" },
    title: { type: "string" },
    updatedAt: { type: "integer" },
  },
  required: [
    "id",
    "slug",
    "title",
    "folder",
    "createdAt",
    "updatedAt",
    "data",
    "editUrl",
  ],
  type: "object",
} as const;

const unauthorized = {
  content: {
    "application/json": {
      schema: errorSchema,
    },
  },
  description: "Bearer トークンが無い、または無効",
} as const;

export function openApiDocument() {
  return {
    components: {
      schemas: {
        ArticleCollection: collection,
        ArticleEntry: entry,
        ArticleSchemaField: schemaField,
        Error: errorSchema,
        Note: noteSchema,
      },
      securitySchemes: {
        bearerAuth: {
          bearerFormat: "PAT",
          description: "設定の MCP 画面で発行した mlb_ トークン",
          scheme: "bearer",
          type: "http",
        },
      },
    },
    info: {
      description:
        "Astro など外部サイト向けの記事 API。メタデータはノート先頭の YAML frontmatter。Personal Access Token を Bearer で送る。Elysia の OpenAPI Type Gen は Workers では使えないため、この文書は手書き。",
      title: "MiyulabMD Article API",
      version: "1.0.0",
    },
    openapi: "3.1.0",
    paths: {
      "/api/articles/collections": {
        get: {
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    properties: {
                      collections: {
                        items: {
                          $ref: "#/components/schemas/ArticleCollection",
                        },
                        type: "array",
                      },
                    },
                    required: ["collections"],
                    type: "object",
                  },
                },
              },
              description: "トークン所有者のソース",
            },
            "401": unauthorized,
          },
          summary: "記事コレクション一覧",
          tags: ["Articles"],
        },
      },
      "/api/articles/collections/{id}/entries": {
        get: {
          description:
            "ソースディレクトリ直下と、何階層下のノートも含む。folder で配下の特定パスに絞れる。",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { format: "uuid", type: "string" },
            },
            {
              description: "1 始まり。省略時は 1",
              in: "query",
              name: "page",
              required: false,
              schema: { default: 1, minimum: 1, type: "integer" },
            },
            {
              description: "1 ページ件数。省略時 50、上限 100",
              in: "query",
              name: "perPage",
              required: false,
              schema: {
                default: 50,
                maximum: 100,
                minimum: 1,
                type: "integer",
              },
            },
            {
              description:
                "コレクション配下のパス。指定するとそのディレクトリと子孫だけを返す",
              in: "query",
              name: "folder",
              required: false,
              schema: { example: "work/infra/db", type: "string" },
            },
          ],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    properties: {
                      collection: {
                        $ref: "#/components/schemas/ArticleCollection",
                      },
                      entries: {
                        items: { $ref: "#/components/schemas/ArticleEntry" },
                        type: "array",
                      },
                      hasMore: { type: "boolean" },
                      page: { minimum: 1, type: "integer" },
                      perPage: { maximum: 100, minimum: 1, type: "integer" },
                      total: { minimum: 0, type: "integer" },
                    },
                    required: [
                      "collection",
                      "entries",
                      "page",
                      "perPage",
                      "total",
                      "hasMore",
                    ],
                    type: "object",
                  },
                },
              },
              description: "本文なしのエントリ（ページネーション付き）",
            },
            "400": {
              content: {
                "application/json": { schema: errorSchema },
              },
              description: "page / perPage / folder が不正",
            },
            "401": unauthorized,
            "404": {
              content: {
                "application/json": { schema: errorSchema },
              },
              description: "コレクションが無い",
            },
          },
          summary: "コレクション配下の記事一覧",
          tags: ["Articles"],
        },
      },
      "/api/articles/collections/{id}/entries/{slug}": {
        get: {
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { format: "uuid", type: "string" },
            },
            {
              description: "alias または short_id",
              in: "path",
              name: "slug",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    properties: {
                      collection: {
                        $ref: "#/components/schemas/ArticleCollection",
                      },
                      entry: { $ref: "#/components/schemas/ArticleEntry" },
                    },
                    required: ["collection", "entry"],
                    type: "object",
                  },
                },
              },
              description:
                "data は YAML frontmatter。markdown は frontmatter を除いた本文",
            },
            "401": unauthorized,
            "404": {
              content: {
                "application/json": { schema: errorSchema },
              },
              description: "記事またはコレクションが無い",
            },
          },
          summary: "記事本文とメタデータ",
          tags: ["Articles"],
        },
      },
      "/api/notes": {
        post: {
          description:
            "Create a note. Omit clientDraftId/draftOwnerId for a fresh UUID each time. With both draft keys, creation is idempotent for recovery sync.",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  properties: {
                    clientDraftId: {
                      description: "Offline local id (`local-{uuid}`)",
                      type: "string",
                    },
                    draftOwnerId: {
                      description: "Authenticated owner of the local draft",
                      type: "string",
                    },
                    folder: { type: "string" },
                    folderId: { format: "uuid", type: "string" },
                    inheritAccess: { type: "boolean" },
                    markdown: { type: "string" },
                    permission: { type: "string" },
                    readScope: { type: "string" },
                    title: { type: "string" },
                    writeScope: { type: "string" },
                  },
                  type: "object",
                },
              },
            },
          },
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Note" },
                },
              },
              description: "Idempotent replay of an existing mapped note",
            },
            "201": {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Note" },
                },
              },
              description: "New note (or first mapped create)",
            },
            "400": {
              content: { "application/json": { schema: errorSchema } },
              description: "Invalid draft keys or scopes",
            },
            "401": {
              content: { "application/json": { schema: errorSchema } },
              description: "Draft create requires authentication",
            },
            "409": {
              content: { "application/json": { schema: errorSchema } },
              description: "owner_mismatch or idempotency_conflict",
            },
            "410": {
              content: { "application/json": { schema: errorSchema } },
              description:
                "draft_deleted — mapping exists but note was removed",
            },
          },
          summary: "Create note (optional idempotent draft keys)",
          tags: ["Notes"],
        },
      },
      "/api/notes/{id}": {
        patch: {
          description:
            "Update note metadata and/or markdown. With expectedMarkdown or draft keys, markdown updates are conditional and wait for DocumentRoom persistence.",
          parameters: [
            {
              in: "path",
              name: "id",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  properties: {
                    clientDraftId: { type: "string" },
                    draftOwnerId: { type: "string" },
                    expectedMarkdown: { type: "string" },
                    markdown: { type: "string" },
                    title: { type: "string" },
                  },
                  type: "object",
                },
              },
            },
          },
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Note" },
                },
              },
              description: "Updated note",
            },
            "400": {
              content: { "application/json": { schema: errorSchema } },
              description: "Invalid body or draft keys",
            },
            "401": unauthorized,
            "403": {
              content: { "application/json": { schema: errorSchema } },
              description: "Forbidden",
            },
            "404": {
              content: { "application/json": { schema: errorSchema } },
              description: "Not found",
            },
            "409": {
              content: { "application/json": { schema: errorSchema } },
              description:
                "owner_mismatch, mapping_mismatch, or content_conflict",
            },
            "410": {
              content: { "application/json": { schema: errorSchema } },
              description: "draft_deleted mapping",
            },
          },
          summary: "Update note",
          tags: ["Notes"],
        },
      },
      "/openapi.json": {
        get: {
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
              description: "OpenAPI 3.1",
            },
          },
          security: [],
          summary: "この OpenAPI 文書",
          tags: ["Articles"],
        },
      },
    },
    security: [{ bearerAuth: [] }],
    servers: [{ url: "/" }],
    tags: [
      { description: "PAT で読む公開記事", name: "Articles" },
      { description: "ノート作成・復帰同期（#97 A）", name: "Notes" },
    ],
  };
}
