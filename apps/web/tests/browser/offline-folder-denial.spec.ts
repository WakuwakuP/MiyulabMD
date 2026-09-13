import type { FolderAccess, FolderCrumb } from "@miyulabmd/shared";
import { expect, test } from "@playwright/test";
import { note } from "./fixtures/note.ts";

function sharedFolder(
  id: string,
  name: string,
  parentId: string | null,
  crumbs: FolderCrumb[],
): FolderAccess {
  return {
    children: [],
    crumbs,
    effectiveReadScope: "all",
    effectiveWriteScope: "self",
    flags: { canAdmin: false, canEdit: false, canView: true },
    grants: [],
    id,
    inherit: false,
    name,
    parentId,
    readScope: "all",
    source: "folder",
    sourceFolder: null,
    writeScope: "self",
  };
}

test("folder denial hides stale navigation references without denying independent children or notes", async ({
  page,
}) => {
  const parentCrumb = { id: "shared", name: "Shared parent" };
  const deniedCrumb = { id: "denied", name: "Previously shared folder" };
  const childCrumb = { id: "child", name: "Independent child" };
  const siblingCrumb = { id: "sibling", name: "Sibling" };
  const parent = {
    ...sharedFolder("shared", parentCrumb.name, null, [parentCrumb]),
    children: [
      { ...deniedCrumb, parentId: "shared" },
      { ...siblingCrumb, parentId: "shared" },
    ],
  };
  const denied = {
    ...sharedFolder("denied", deniedCrumb.name, "shared", [
      parentCrumb,
      deniedCrumb,
    ]),
    children: [{ ...childCrumb, parentId: "denied" }],
  };
  const child = sharedFolder("child", childCrumb.name, "denied", [
    parentCrumb,
    deniedCrumb,
    childCrumb,
  ]);
  const sibling = sharedFolder("sibling", siblingCrumb.name, "shared", [
    parentCrumb,
    siblingCrumb,
  ]);
  const publicNote = {
    ...note,
    access: {
      ...note.access,
      effectiveReadScope: "all" as const,
      flags: { canAdmin: false, canEdit: false, canView: true },
      inherit: false,
      readScope: "all" as const,
    },
    folderId: "denied",
    ownerId: "bob",
    permission: "public" as const,
  };
  const moduleUrl = "/src/lib/offline-cache.ts";
  await page.goto("/tests/browser/fixtures/storage.html");
  await page.evaluate(
    async ({ moduleUrl, parent, denied, child, sibling, publicNote }) => {
      const { openOfflineCache } = await import(moduleUrl);
      const alice = await openOfflineCache({ userId: "alice" });
      const bob = await openOfflineCache({ userId: "bob" });
      try {
        for (const folder of [parent, denied, child, sibling]) {
          await alice.putFolder(folder);
          await bob.putFolder(folder);
        }
        await alice.putNote(publicNote);
        const { markdown: _markdown, ...summary } = publicNote;
        await alice.putNoteList([summary]);
        await alice.denyFolder("denied");
        // A storage write alone is not an authoritative access revalidation.
        await alice.putFolder(denied);
      } finally {
        alice.close();
        bob.close();
      }
    },
    { child, denied, moduleUrl, parent, publicNote, sibling },
  );
  await page.reload();
  const snapshots = await page.evaluate(async (moduleUrl) => {
    const { openOfflineCache } = await import(moduleUrl);
    const alice = await openOfflineCache({ userId: "alice" });
    const bob = await openOfflineCache({ userId: "bob" });
    try {
      return {
        child: (await alice.getFolder("child"))?.folder,
        denied: await alice.getFolder("denied"),
        note: (await alice.getNote("note-1"))?.note,
        notes: (await alice.getNoteList())?.notes,
        otherViewer: (await bob.getFolder("denied"))?.folder,
        parent: (await alice.getFolder("shared"))?.folder,
        sibling: (await alice.getFolder("sibling"))?.folder,
      };
    } finally {
      alice.close();
      bob.close();
    }
  }, moduleUrl);
  expect(snapshots.denied).toBeNull();
  expect(snapshots.parent?.children).toEqual([
    { ...siblingCrumb, parentId: "shared" },
  ]);
  expect(snapshots.child).toMatchObject({
    crumbs: [childCrumb],
    id: "child",
    parentId: null,
  });
  expect(snapshots.sibling).toEqual(sibling);
  expect(snapshots.otherViewer).toEqual(denied);
  expect(snapshots.note).toEqual(publicNote);
  expect(snapshots.notes?.map((summary) => summary.id)).toEqual(["note-1"]);
});
