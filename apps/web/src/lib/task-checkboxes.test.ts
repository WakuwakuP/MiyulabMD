import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  __testSetSessionState,
  resetOfflineSessionForTests,
} from "./offline-session.ts";
import { accountScopeFromUserId } from "./offline-types.ts";
import { taskCheckboxMutationsAllowed } from "./task-checkboxes.ts";

afterEach(() => {
  resetOfflineSessionForTests();
});

test("taskCheckboxMutationsAllowed blocks offline-known session", () => {
  __testSetSessionState({
    offlineReadable: true,
    scope: accountScopeFromUserId("me"),
    status: "online-confirmed",
    user: { displayName: "Me", email: "me@example.com", id: "me" },
  });
  assert.equal(taskCheckboxMutationsAllowed(), true);

  __testSetSessionState({
    offlineReadable: true,
    scope: accountScopeFromUserId("me"),
    status: "offline-known",
    user: { displayName: "Me", email: "me@example.com", id: "me" },
  });
  assert.equal(taskCheckboxMutationsAllowed(), false);
});
