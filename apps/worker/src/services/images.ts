import type { SessionUser } from "@miyulabmd/shared";

export function createImageService(_env: Env) {
  return {
    async upload(_noteId: string, _user: SessionUser, _file: File): Promise<{ id: string; url: string }> {
      throw new Error("not implemented");
    },
    async get(_noteId: string, _imageId: string, _user?: SessionUser): Promise<ReadableStream | null> {
      return null;
    },
  };
}
