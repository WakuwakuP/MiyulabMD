import { expect, type Page, test } from "@playwright/test";

import { note } from "./fixtures/note.ts";

const folder = {
  children: [],
  crumbs: [],
  effectiveReadScope: "all" as const,
  effectiveWriteScope: "self" as const,
  flags: { canAdmin: false, canEdit: false, canView: true },
  grants: [],
  id: "mounted-folder",
  inherit: false,
  name: "Mounted folder",
  parentId: null,
  readScope: "all" as const,
  source: "folder" as const,
  sourceFolder: null,
  writeScope: "self" as const,
};

function inCache(page: Page, body: string) {
  return page.evaluate(
    async ({ body, folder }) => {
      const module = await import("/src/lib/offline-cache.ts");
      const cache = await module.openOfflineCache({
        userId: "mounted-race",
      });
      try {
        return await new Function(
          "cache",
          "folder",
          `return (${body})(cache, folder);`,
        )(cache, folder);
      } finally {
        cache.close();
      }
    },
    { body, folder },
  );
}

async function open(page: Page) {
  await page.goto("/tests/browser/fixtures/storage.html");
}

test("delayed old deny cannot erase a newer verified folder", async ({
  page,
}) => {
  await open(page);
  const result = await inCache(
    page,
    `async (cache, folder) => {
      const events = [];
      const module = await import("/src/lib/offline-cache.ts");
      const stop = module.subscribeOfflineCacheFolderDenial(() => events.push(true));
      const old = await cache.beginFolderRead(folder.id);
      const fresh = await cache.beginFolderRead(folder.id);
      await cache.putFolder(folder, { orderingToken: fresh });
      const pending = cache.denyFolder(folder.id, old);
      const committed = await pending;
      stop();
      return { committed, events, retained: Boolean(await cache.getFolder(folder.id)) };
    }`,
  );
  expect(result).toEqual({ committed: false, events: [], retained: true });
});

test("current deny commits receipt authority and generation", async ({
  page,
}) => {
  await open(page);
  const result = await inCache(
    page,
    `async (cache, folder) => {
      await cache.putFolder(folder);
      const token = await cache.beginFolderRead(folder.id);
      const receipts = [];
      const module = await import("/src/lib/offline-cache.ts");
      const stop = module.subscribeOfflineCacheFolderDenial((event) => receipts.push(event));
      const committed = await cache.denyFolder(folder.id, token);
      stop();
      return { committed, receipt: receipts[0] };
    }`,
  );
  expect(result.committed).toBe(true);
  expect(result.receipt.resource).toMatchObject({
    aliases: ["mounted-folder"],
    generation: 2,
  });
  expect(result.receipt.resource.epoch).toBe("0");
});

test("null and canonical root aliases are denied together", async ({
  page,
}) => {
  await open(page);
  const result = await inCache(
    page,
    `async (cache, folder) => {
      await cache.putFolder({ ...folder, id: "canonical-root" }, { asDriveRoot: true });
      const token = await cache.beginFolderRead(null);
      await cache.denyFolder(null, token);
      return [await cache.getFolder(null), await cache.getFolder("canonical-root")];
    }`,
  );
  expect(result).toEqual([null, null]);
});

test("literal root and sentinel ids are not aliases", async ({ page }) => {
  await open(page);
  const result = await inCache(
    page,
    `async (cache, folder) => {
      await cache.putFolder({ ...folder, id: "root" });
      await cache.putFolder({ ...folder, id: "__root__" });
      return [Boolean(await cache.getFolder("root")), Boolean(await cache.getFolder("__root__"))];
    }`,
  );
  expect(result).toEqual([true, true]);
});

test("authority reads every alias when only alias one is missing", async ({
  page,
}) => {
  await open(page);
  const result = await inCache(
    page,
    `async (cache, folder) => {
      const token = await cache.beginFolderRead(folder.id);
      await cache.denyFolder(folder.id, token);
      const module = await import("/src/lib/offline-cache.ts");
      return module.readOfflineFolderDenial({
        type: "invalidate", userId: "mounted-race",
        resource: { type: "folder", aliases: ["missing", folder.id], epoch: "0", generation: 2 },
      });
    }`,
  );
  expect(result).toBe(true);
});

test("old receipt after fresh clear reports false and keeps mounted state", async ({
  page,
}) => {
  await open(page);
  const result = await inCache(
    page,
    `async (cache, folder) => {
      await cache.putFolder(folder);
      const token = await cache.beginFolderRead(folder.id);
      await cache.clearFolderDenial(folder.id, token);
      const module = await import("/src/lib/offline-cache.ts");
      const authority = await module.readOfflineFolderDenial({
        type: "invalidate", userId: "mounted-race",
        resource: { type: "folder", aliases: [folder.id], epoch: "0", generation: token },
      });
      return { authority, retained: Boolean(await cache.getFolder(folder.id)) };
    }`,
  );
  expect(result).toEqual({ authority: false, retained: true });
});

test("unrelated folder denial leaves current mounted target unchanged", async ({
  page,
}) => {
  await open(page);
  const result = await inCache(
    page,
    `async (cache, folder) => {
      await cache.putFolder(folder);
      const token = await cache.beginFolderRead("other");
      await cache.denyFolder("other", token);
      return (await cache.getFolder(folder.id))?.folder.id;
    }`,
  );
  expect(result).toBe("mounted-folder");
});

test("direct denied note is removed while descendant note remains", async ({
  page,
}) => {
  await open(page);
  const result = await inCache(
    page,
    `async (cache, folder) => {
      await cache.putNoteList([{ id: "direct", folderId: folder.id }, { id: "child", folderId: "descendant" }]);
      await cache.denyFolder(folder.id, await cache.beginFolderRead(folder.id));
      return (await cache.getNoteList())?.notes.map((note) => note.id);
    }`,
  );
  expect(result).toEqual(["child"]);
});

const sessionHeaders = { "X-MiyulabMD-Session-User": "user:alice" };
const authenticatedUser = {
  displayName: "Alice",
  email: "alice@example.test",
  id: "alice",
};

function folderFixture(
  id: string,
  name: string,
  parentId: string | null,
  children: { id: string; name: string; parentId: string | null }[],
  crumbs: { id: string; name: string }[] = [],
) {
  return {
    children,
    crumbs,
    effectiveReadScope: "all" as const,
    effectiveWriteScope: "self" as const,
    flags: { canAdmin: true, canEdit: true, canView: true },
    folder: crumbs
      .map((crumb) => crumb.name)
      .concat(parentId ? [name] : [])
      .join("/"),
    grants: [],
    id,
    inherit: false,
    name,
    parentId,
    readScope: "all" as const,
    source: "folder" as const,
    sourceFolder: null,
    writeScope: "self" as const,
  };
}

async function routeAuthenticatedHome(
  page: Page,
  folders: Record<string, ReturnType<typeof folderFixture>>,
  notes: unknown[],
) {
  await page.route("**/api/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/me") {
      return route.fulfill({
        headers: sessionHeaders,
        json: { user: authenticatedUser },
      });
    }
    if (pathname === "/api/auth/config") {
      return route.fulfill({
        headers: sessionHeaders,
        json: { access: false, mock: true },
      });
    }
    if (pathname === "/api/notes") {
      return route.fulfill({ headers: sessionHeaders, json: { notes } });
    }
    if (pathname === "/api/folders") {
      return route.fulfill({
        headers: sessionHeaders,
        json: folders.root,
      });
    }
    const folderId = pathname.match(/^\/api\/folders\/([^/]+)$/)?.[1];
    if (folderId && folders[folderId]) {
      return route.fulfill({
        headers: sessionHeaders,
        json: folders[folderId],
      });
    }
    return route.fulfill({
      headers: sessionHeaders,
      json: { error: "No fixture" },
      status: 404,
    });
  });
}

async function denyFolderFromPeer(peer: Page, id: string, token?: number) {
  await peer.goto("/tests/browser/fixtures/storage.html");
  await peer.evaluate(
    async ({ id, token }) => {
      const { openOfflineCache } = await import("/src/lib/offline-cache.ts");
      const cache = await openOfflineCache({ userId: "alice" });
      try {
        await cache.denyFolder(id, token);
      } finally {
        cache.close();
      }
    },
    { id, token },
  );
}

async function denyNoteFromPeer(peer: Page, id: string) {
  await peer.goto("/tests/browser/fixtures/storage.html");
  await peer.evaluate(async (noteId) => {
    const { openOfflineCache } = await import("/src/lib/offline-cache.ts");
    const cache = await openOfflineCache({ userId: "alice" });
    try {
      await cache.denyNote(noteId);
    } finally {
      cache.close();
    }
  }, id);
}

function trackApiRequests(page: Page) {
  const paths: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/")) {
      paths.push(pathname);
    }
  });
  return paths;
}

test("mounted network folder removes only the denied current view", async ({
  page,
  context,
}) => {
  const current = folderFixture(
    "mounted-current",
    "Mounted Current",
    null,
    [],
    [{ id: "mounted-current", name: "Mounted Current" }],
  );
  const other = folderFixture("mounted-other", "Mounted Other", null, []);
  const targetNote = {
    ...note,
    createdAt: 3,
    folderId: current.id,
    id: "mounted-target-note",
    shortId: "mounted-target-short",
    title: "Mounted Target Note",
    updatedAt: 4,
  };
  const unrelatedNote = {
    ...targetNote,
    createdAt: 5,
    id: "mounted-unrelated-note",
    shortId: "mounted-unrelated-short",
    title: "Mounted Unrelated Note",
    updatedAt: 6,
  };
  const apiRequests = trackApiRequests(page);
  await routeAuthenticatedHome(
    page,
    { root: current, [current.id]: current, [other.id]: other },
    [targetNote, unrelatedNote],
  );
  await page.goto(`/f/${current.id}`);
  await expect(
    page.getByRole("navigation", { name: "フォルダ" }).getByText(current.name),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: targetNote.title }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "フォルダ" })
      .getByText("マイドライブ"),
  ).toBeVisible();
  const folderRequestCount = apiRequests.filter((path) =>
    path.startsWith("/api/folders"),
  ).length;

  const peer = await context.newPage();
  try {
    const token = await peer.evaluate(async (id) => {
      const { openOfflineCache } = await import("/src/lib/offline-cache.ts");
      const cache = await openOfflineCache({ userId: "alice" });
      try {
        return await cache.beginFolderRead(id);
      } finally {
        cache.close();
      }
    }, current.id);
    await denyFolderFromPeer(peer, "not-current", token);
    await expect(
      page
        .getByRole("navigation", { name: "フォルダ" })
        .getByText(current.name),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: targetNote.title }),
    ).toBeVisible();
    await denyFolderFromPeer(peer, current.id, token);
    await expect
      .poll(
        () =>
          apiRequests.filter((path) => path.startsWith("/api/folders")).length,
      )
      .toBeGreaterThan(folderRequestCount);
    await expect(
      page.getByText(/キャッシュに保存されていません/),
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "フォルダ" })
        .getByText("マイドライブ"),
    ).toBeVisible();
  } finally {
    await peer.close();
  }
});

test("mounted root reprojects a denied child without hiding an allowed descendant", async ({
  page,
  context,
}) => {
  const deniedChild = folderFixture(
    "mounted-denied-child",
    "Denied Child",
    "mounted-root",
    [],
  );
  const allowedChild = folderFixture(
    "mounted-allowed-child",
    "Allowed Child",
    "mounted-root",
    [],
  );
  const root = folderFixture("mounted-root", "Mounted Network Root", null, [
    { id: deniedChild.id, name: deniedChild.name, parentId: "mounted-root" },
    { id: allowedChild.id, name: allowedChild.name, parentId: "mounted-root" },
  ]);
  const directNote = {
    ...note,
    createdAt: 7,
    folderId: deniedChild.id,
    id: "mounted-direct-note",
    shortId: "mounted-direct",
    title: "Denied Direct Note",
    updatedAt: 8,
  };
  const descendantNote = {
    ...note,
    createdAt: 9,
    folderId: allowedChild.id,
    id: "mounted-descendant-note",
    shortId: "mounted-descendant",
    title: "Allowed Descendant Note",
    updatedAt: 10,
  };
  const apiRequests = trackApiRequests(page);
  await routeAuthenticatedHome(
    page,
    { root, [deniedChild.id]: deniedChild, [allowedChild.id]: allowedChild },
    [directNote, descendantNote],
  );
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: deniedChild.name }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: allowedChild.name }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: directNote.title }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: descendantNote.title }),
  ).toBeVisible();
  const folderRequestCount = apiRequests.filter((path) =>
    path.startsWith("/api/folders"),
  ).length;
  const peer = await context.newPage();
  try {
    await denyFolderFromPeer(peer, deniedChild.id);
    await expect
      .poll(
        () =>
          apiRequests.filter((path) => path.startsWith("/api/folders")).length,
      )
      .toBeGreaterThan(folderRequestCount);
    await expect(
      page.getByRole("link", { name: deniedChild.name }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: directNote.title }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: allowedChild.name }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: descendantNote.title }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "フォルダ" })
        .getByText("マイドライブ"),
    ).toBeVisible();
  } finally {
    await peer.close();
  }
});

test("mounted note list removes only a peer-denied note", async ({
  page,
  context,
}) => {
  const root = folderFixture(
    "mounted-note-root",
    "Mounted Note Home",
    null,
    [],
  );
  const target = {
    ...note,
    createdAt: 11,
    folderId: root.id,
    id: "peer-denied-note",
    shortId: "peer-denied-short",
    title: "Peer Denied Note",
    updatedAt: 12,
  };
  const sibling = {
    ...note,
    createdAt: 13,
    folderId: root.id,
    id: "peer-kept-note",
    shortId: "peer-kept-short",
    title: "Peer Kept Note",
    updatedAt: 14,
  };
  const apiRequests = trackApiRequests(page);
  await routeAuthenticatedHome(page, { root, [root.id]: root }, [
    target,
    sibling,
  ]);
  await page.goto("/");
  await expect(page.getByRole("link", { name: target.title })).toBeVisible();
  await expect(page.getByRole("link", { name: sibling.title })).toBeVisible();
  const noteRequestCount = apiRequests.filter(
    (path) => path === "/api/notes",
  ).length;
  const peer = await context.newPage();
  try {
    await denyNoteFromPeer(peer, target.id);
    await expect
      .poll(() => apiRequests.filter((path) => path === "/api/notes").length)
      .toBeGreaterThan(noteRequestCount);
    await expect(page.getByRole("link", { name: target.title })).toHaveCount(0);
    await expect(page.getByRole("link", { name: sibling.title })).toBeVisible();
  } finally {
    await peer.close();
  }
});

test("route switch fences a delayed folder denial", async ({ page }) => {
  const folderA = folderFixture(
    "mounted-route-a",
    "Route A",
    null,
    [],
    [{ id: "mounted-route-a", name: "Route A" }],
  );
  const folderB = folderFixture(
    "mounted-route-b",
    "Route B",
    null,
    [],
    [{ id: "mounted-route-b", name: "Route B" }],
  );
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === `/api/folders/${folderA.id}`) {
      await gate;
      return route.fulfill({
        headers: sessionHeaders,
        json: { error: "Denied" },
        status: 403,
      });
    }
    if (pathname === "/api/me") {
      return route.fulfill({
        headers: sessionHeaders,
        json: { user: authenticatedUser },
      });
    }
    if (pathname === "/api/auth/config") {
      return route.fulfill({
        headers: sessionHeaders,
        json: { access: false, mock: true },
      });
    }
    if (pathname === `/api/folders/${folderB.id}`) {
      return route.fulfill({ headers: sessionHeaders, json: folderB });
    }
    if (pathname === "/api/notes") {
      return route.fulfill({ headers: sessionHeaders, json: { notes: [] } });
    }
    return route.fulfill({ headers: sessionHeaders, json: folderA });
  });
  const firstNavigation = page.goto(`/f/${folderA.id}`);
  await page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === `/api/folders/${folderA.id}`,
  );
  try {
    const secondNavigation = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === `/api/folders/${folderB.id}`,
    );
    await page.goto(`/f/${folderB.id}`);
    await secondNavigation;
    await expect(
      page
        .getByRole("navigation", { name: "フォルダ" })
        .getByText(folderB.name),
    ).toBeVisible();
    await expect(page.getByText(/キャッシュ|停止|警告/)).toHaveCount(0);
  } finally {
    release();
    await firstNavigation.catch(() => undefined);
  }
});
