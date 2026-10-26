import assert from "node:assert/strict";
import { test } from "node:test";
import { recoverSettledImage } from "./settled-image";

test("a cached failure before hydration reaches fallback without another browser error event", () => {
  const actions: string[] = [];
  recoverSettledImage(
    { complete: true, naturalWidth: 0 },
    () => actions.push("loaded"),
    () => actions.push("fallback"),
  );
  assert.deepEqual(actions, ["fallback"]);
});

test("a cached success is measured while an unfinished or absent image keeps waiting", () => {
  const actions: string[] = [];
  const loaded = () => actions.push("loaded");
  const failed = () => actions.push("fallback");
  recoverSettledImage({ complete: false, naturalWidth: 0 }, loaded, failed);
  recoverSettledImage(null, loaded, failed);
  assert.deepEqual(actions, []);
  recoverSettledImage({ complete: true, naturalWidth: 1200 }, loaded, failed);
  assert.deepEqual(actions, ["loaded"]);
});
