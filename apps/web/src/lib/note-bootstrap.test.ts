import assert from "node:assert/strict";
import { test } from "node:test";
import { peekOgPreview } from "./api.ts";
import {
  consumeOgBootstrap,
  dismissStaleSsrPreview,
  readNoteBootstrap,
  removeSsrPreview,
} from "./note-bootstrap.ts";

type FakeEl = {
  textContent: string | null;
  attrs: Record<string, string>;
  getAttribute(name: string): string | null;
  remove(): void;
};

function installDocument(elements: Record<string, FakeEl | null>) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  const document = {
    getElementById(id: string) {
      return elements[id] ?? null;
    },
  };
  Object.defineProperty(globalThis, "document", {
    value: document,
    configurable: true,
  });
  return () => {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
  };
}

function el(
  attrs: Record<string, string> = {},
  textContent: string | null = null,
): FakeEl {
  return {
    textContent,
    attrs,
    getAttribute(name: string) {
      return this.attrs[name] ?? null;
    },
    remove() {
      for (const key of Object.keys(elementsRef)) {
        if (elementsRef[key] === this) elementsRef[key] = null;
      }
    },
  };
}

let elementsRef: Record<string, FakeEl | null> = {};

test("readNoteBootstrap accepts matching id or shortId", () => {
  const note = { id: "note-1", shortId: "abc123", markdown: "# Hi" };
  elementsRef = {
    "note-bootstrap": el({}, JSON.stringify(note)),
  };
  const restore = installDocument(elementsRef);
  try {
    assert.equal(readNoteBootstrap("note-1")?.id, "note-1");
    assert.equal(readNoteBootstrap("abc123")?.id, "note-1");
    assert.equal(readNoteBootstrap("other"), null);
  } finally {
    restore();
  }
});

test("consumeOgBootstrap seeds the client OG cache", () => {
  elementsRef = {
    "og-bootstrap": el(
      {},
      JSON.stringify({
        "https://x.com/norotororo": {
          url: "https://x.com/norotororo",
          title: "noro",
          description: null,
          image: null,
          siteName: "X",
        },
      }),
    ),
  };
  const restore = installDocument(elementsRef);
  try {
    consumeOgBootstrap();
    assert.equal(peekOgPreview("https://x.com/norotororo")?.title, "noro");
  } finally {
    restore();
  }
});

test("dismissStaleSsrPreview keeps the matching note and drops others", () => {
  elementsRef = {
    "ssr-preview": el({ "data-note-id": "note-1", "data-short-id": "abc123" }),
  };
  const restore = installDocument(elementsRef);
  try {
    dismissStaleSsrPreview("note-1");
    assert.ok(document.getElementById("ssr-preview"));
    dismissStaleSsrPreview("other");
    assert.equal(document.getElementById("ssr-preview"), null);
    elementsRef["ssr-preview"] = el({ "data-note-id": "note-1" });
    removeSsrPreview();
    assert.equal(document.getElementById("ssr-preview"), null);
  } finally {
    restore();
  }
});
