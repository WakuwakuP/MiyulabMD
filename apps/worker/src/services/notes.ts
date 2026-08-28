import type { CreateNoteInput, Note, NoteSummary, SessionUser, UpdateNoteMetaInput } from "@miyulabmd/shared";

/** HTTP と MCP が共有するノートドメイン。実装はフェーズ 1〜2。 */
export function createNoteService(_env: Env) {
  return {
    async listForUser(_user: SessionUser): Promise<NoteSummary[]> {
      return [];
    },
    async get(_id: string, _user?: SessionUser): Promise<Note | null> {
      return null;
    },
    async create(_user: SessionUser, _input: CreateNoteInput): Promise<Note> {
      throw new Error("not implemented");
    },
    async updateMeta(_id: string, _user: SessionUser, _input: UpdateNoteMetaInput): Promise<Note> {
      throw new Error("not implemented");
    },
    async updateMarkdown(_id: string, _user: SessionUser, _markdown: string): Promise<Note> {
      throw new Error("not implemented");
    },
    async remove(_id: string, _user: SessionUser): Promise<void> {
      throw new Error("not implemented");
    },
  };
}
