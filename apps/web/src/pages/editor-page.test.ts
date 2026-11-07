import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCESS_REVOKED_WS_CLOSE_CODE,
  EDIT_LOCK_WS_CLOSE_CODE,
} from "@miyulabmd/shared";

import { collabCloseAction } from "./editor-page.ts";

test("collabCloseAction maps DocumentRoom permanent close codes", () => {
  assert.equal(collabCloseAction(EDIT_LOCK_WS_CLOSE_CODE), "edit-locked");
  assert.equal(
    collabCloseAction(ACCESS_REVOKED_WS_CLOSE_CODE),
    "access-revoked",
  );
  assert.equal(collabCloseAction(1000), null);
  assert.equal(collabCloseAction(1006), null);
});
