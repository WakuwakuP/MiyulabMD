import assert from "node:assert/strict";
import { test } from "node:test";
import { withToolTiming } from "./tool-timing.ts";

test("timing preserves results and records only tool, outcome and elapsed time", async (t) => {
  const log = t.mock.method(console, "log", () => undefined);
  const result = { content: [{ text: "private note body", type: "text" }] };
  const handler = withToolTiming("get_note", async (_secret: string) => result);
  assert.equal(await handler("private token"), result);
  const event = log.mock.calls[0].arguments[0];
  assert.deepEqual(Object.keys(event).sort(), [
    "durationMs",
    "event",
    "outcome",
    "tool",
  ]);
  assert.equal(event.event, "mcp_tool_timing");
  assert.equal(event.tool, "get_note");
  assert.equal(event.outcome, "ok");
  assert.ok(event.durationMs >= 0);
});

test("tool errors and exceptions retain their behavior and get timing events", async (t) => {
  const log = t.mock.method(console, "log", () => undefined);
  const result = { isError: true };
  assert.equal(await withToolTiming("get_note", async () => result)(), result);
  assert.equal(log.mock.calls[0].arguments[0].outcome, "tool_error");
  const failure = new Error("private failure detail");
  const handler = withToolTiming("get_note", () => Promise.reject(failure));
  await assert.rejects(handler(), (error) => error === failure);
  assert.equal(log.mock.calls[1].arguments[0].outcome, "exception");
  assert.equal(JSON.stringify(log.mock.calls).includes(failure.message), false);
});
