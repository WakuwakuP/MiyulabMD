import assert from "node:assert/strict";
import { test } from "node:test";
import type { Note } from "@miyulabmd/shared";
import {
  injectNotePage,
  isPublicGuestCacheable,
  jsonForScript,
  notePageId,
} from "./inject-note-page.ts";

function sampleNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "note-1",
    shortId: "abc123",
    alias: null,
    ownerId: "owner-1",
    title: "Hello",
    folder: "",
    folderId: null,
    permission: "locked",
    access: {
      inherit: false,
      readScope: "public",
      writeScope: "self",
      effectiveReadScope: "public",
      effectiveWriteScope: "self",
      source: "note",
      sourceFolder: null,
      grants: [],
      flags: {
        canView: true,
        canEdit: false,
        canAdmin: false,
      },
    },
    markdown: "# Hello\n\n<script>alert(1)</script>",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

test("notePageId reads /n and /s ids", () => {
  assert.equal(
    notePageId("/n/6d6859b4-e763-4fa3-bdc4-0614d094d238"),
    "6d6859b4-e763-4fa3-bdc4-0614d094d238",
  );
  assert.equal(notePageId("/s/abc123"), "abc123");
  assert.equal(notePageId("/n/abc123/"), "abc123");
  assert.equal(notePageId("/n/"), null);
  assert.equal(notePageId("/"), null);
});

test("injectNotePage writes bootstrap outside #root and escapes script", () => {
  const html = injectNotePage(
    '<html><head><title>MiyulabMD</title></head><body><div id="root"></div></body></html>',
    sampleNote(),
    '<h1 id="user-content-hello">Hello</h1>',
  );
  assert.match(html, /<title>Hello · MiyulabMD<\/title>/);
  assert.match(html, /id="ssr-preview"/);
  assert.match(html, /id="note-bootstrap"/);
  assert.doesNotMatch(html, /id="og-bootstrap"/);
  assert.match(html, /user-content-hello/);
  const rootAt = html.indexOf('<div id="root"></div>');
  const ssrAt = html.indexOf('id="ssr-preview"');
  assert.ok(rootAt >= 0 && ssrAt > rootAt);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /\\u003cscript\\u003e/);
});

test("isPublicGuestCacheable only for anonymous public notes", () => {
  const note = sampleNote();
  assert.equal(isPublicGuestCacheable(note, false), true);
  assert.equal(isPublicGuestCacheable(note, true), false);
  assert.equal(
    isPublicGuestCacheable(
      sampleNote({
        access: {
          ...note.access,
          effectiveReadScope: "self",
        },
      }),
      false,
    ),
    false,
  );
});

test("injectNotePage writes og-bootstrap when cards exist", () => {
  const html = injectNotePage(
    '<html><head><title>MiyulabMD</title></head><body><div id="root"></div></body></html>',
    sampleNote(),
    "<p>card</p>",
    {
      "https://x.com/norotororo": {
        url: "https://x.com/norotororo",
        title: "noro",
        description: null,
        image: null,
        siteName: "X",
      },
    },
  );
  assert.match(html, /id="og-bootstrap"/);
  assert.match(html, /norotororo/);
});

test("jsonForScript escapes HTML delimiters", () => {
  assert.equal(jsonForScript("<br>"), '"\\u003cbr\\u003e"');
});
