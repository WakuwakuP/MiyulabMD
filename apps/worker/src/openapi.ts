const errorSchema = {
  type: "object",
  required: ["error"],
  properties: {
    error: { type: "string" },
  },
} as const;

const schemaField = {
  type: "object",
  required: ["key", "type"],
  properties: {
    key: { type: "string" },
    type: {
      type: "string",
      enum: ["string", "number", "boolean", "date", "string[]"],
    },
    required: { type: "boolean" },
    fixed: { type: "boolean" },
    default: {},
    enum: {
      type: "array",
      items: { type: "string" },
    },
  },
} as const;

const collection = {
  type: "object",
  required: ["id", "name", "folder", "schema"],
  properties: {
    id: { type: "string", format: "uuid" },
    name: { type: "string" },
    folder: { type: "string" },
    schema: { type: "array", items: schemaField },
  },
} as const;

const entry = {
  type: "object",
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
  properties: {
    id: { type: "string", format: "uuid" },
    slug: { type: "string" },
    title: { type: "string" },
    folder: { type: "string" },
    createdAt: { type: "integer" },
    updatedAt: { type: "integer" },
    data: { type: "object", additionalProperties: true },
    editUrl: { type: "string", format: "uri" },
    markdown: { type: "string" },
  },
} as const;

const unauthorized = {
  description: "Bearer トークンが無い、または無効",
  content: {
    "application/json": {
      schema: errorSchema,
    },
  },
} as const;

export function openApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "MiyulabMD Article API",
      version: "1.0.0",
      description:
        "Astro など外部サイト向けの記事 API。メタデータはノート先頭の YAML frontmatter。Personal Access Token を Bearer で送る。Elysia の OpenAPI Type Gen は Workers では使えないため、この文書は手書き。",
    },
    servers: [{ url: "/" }],
    tags: [{ name: "Articles", description: "PAT で読む公開記事" }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "PAT",
          description: "設定の MCP 画面で発行した mlb_ トークン",
        },
      },
      schemas: {
        Error: errorSchema,
        ArticleSchemaField: schemaField,
        ArticleCollection: collection,
        ArticleEntry: entry,
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      "/openapi.json": {
        get: {
          tags: ["Articles"],
          summary: "この OpenAPI 文書",
          security: [],
          responses: {
            "200": {
              description: "OpenAPI 3.1",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
      },
      "/api/articles/collections": {
        get: {
          tags: ["Articles"],
          summary: "記事コレクション一覧",
          responses: {
            "200": {
              description: "トークン所有者のソース",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["collections"],
                    properties: {
                      collections: {
                        type: "array",
                        items: {
                          $ref: "#/components/schemas/ArticleCollection",
                        },
                      },
                    },
                  },
                },
              },
            },
            "401": unauthorized,
          },
        },
      },
      "/api/articles/collections/{id}/entries": {
        get: {
          tags: ["Articles"],
          summary: "コレクション配下の記事一覧",
          description:
            "ソースディレクトリ直下と、何階層下のノートも含む。folder で配下の特定パスに絞れる。",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
            {
              name: "page",
              in: "query",
              required: false,
              description: "1 始まり。省略時は 1",
              schema: { type: "integer", minimum: 1, default: 1 },
            },
            {
              name: "perPage",
              in: "query",
              required: false,
              description: "1 ページ件数。省略時 50、上限 100",
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 100,
                default: 50,
              },
            },
            {
              name: "folder",
              in: "query",
              required: false,
              description:
                "コレクション配下のパス。指定するとそのディレクトリと子孫だけを返す",
              schema: { type: "string", example: "work/infra/db" },
            },
          ],
          responses: {
            "200": {
              description: "本文なしのエントリ（ページネーション付き）",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: [
                      "collection",
                      "entries",
                      "page",
                      "perPage",
                      "total",
                      "hasMore",
                    ],
                    properties: {
                      collection: {
                        $ref: "#/components/schemas/ArticleCollection",
                      },
                      entries: {
                        type: "array",
                        items: { $ref: "#/components/schemas/ArticleEntry" },
                      },
                      page: { type: "integer", minimum: 1 },
                      perPage: { type: "integer", minimum: 1, maximum: 100 },
                      total: { type: "integer", minimum: 0 },
                      hasMore: { type: "boolean" },
                    },
                  },
                },
              },
            },
            "400": {
              description: "page / perPage / folder が不正",
              content: {
                "application/json": { schema: errorSchema },
              },
            },
            "401": unauthorized,
            "404": {
              description: "コレクションが無い",
              content: {
                "application/json": { schema: errorSchema },
              },
            },
          },
        },
      },
      "/api/articles/collections/{id}/entries/{slug}": {
        get: {
          tags: ["Articles"],
          summary: "記事本文とメタデータ",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
            {
              name: "slug",
              in: "path",
              required: true,
              description: "alias または short_id",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description:
                "data は YAML frontmatter。markdown は frontmatter を除いた本文",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["collection", "entry"],
                    properties: {
                      collection: {
                        $ref: "#/components/schemas/ArticleCollection",
                      },
                      entry: { $ref: "#/components/schemas/ArticleEntry" },
                    },
                  },
                },
              },
            },
            "401": unauthorized,
            "404": {
              description: "記事またはコレクションが無い",
              content: {
                "application/json": { schema: errorSchema },
              },
            },
          },
        },
      },
    },
  };
}
