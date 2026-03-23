/**
 * Tests for memory leak in validation timeouts.
 *
 * These tests verify that when documents are closed, the validation
 * timeouts are properly cleaned up from the Map.
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "fs";
import * as path from "path";

const serverCode = fs.readFileSync(
  path.join(__dirname, "../src/server.ts"),
  "utf-8"
);

test("onDidClose clears validation timeout (no memory leak)", () => {
  // Extract the onDidClose handler - match from the event to the closing brace
  const onDidClosePattern = /documents\.onDidClose\(async \(e\) => \{[\s\S]*?^}\);/m;
  const match = serverCode.match(onDidClosePattern);

  assert.ok(match, "Should find onDidClose handler");

  const handler = match![0];

  // The handler should clear the timeout
  const clearsTimeout = handler.includes("validationTimeouts.delete");

  console.log("\nonDidClose handler:");
  console.log(handler);
  console.log(`\nClears validation timeout: ${clearsTimeout}`);

  // Assert correct behavior - onDidClose SHOULD clear the timeout
  assert.strictEqual(clearsTimeout, true, "onDidClose should clear validation timeout");
});

test("scheduleValidation correctly manages timeout lifecycle", () => {
  // Verify that scheduleValidation DOES clear timeouts (via delete in callback)
  const scheduleValidationPattern = /function scheduleValidation[\s\S]*?^}/m;
  const match = serverCode.match(scheduleValidationPattern);

  assert.ok(match, "Should find scheduleValidation function");

  const func = match![0];

  // scheduleValidation should set and delete timeouts
  const setsTimeout = func.includes("validationTimeouts.set");
  const deletesInCallback = func.includes("validationTimeouts.delete");

  console.log("\nscheduleValidation:");
  console.log(`  Sets timeout: ${setsTimeout}`);
  console.log(`  Deletes in callback: ${deletesInCallback}`);

  assert.strictEqual(setsTimeout, true);
  assert.strictEqual(deletesInCallback, true);
});

test("validateAllTimeout cleanup is handled", () => {
  // There's also a validateAllTimeout that might need cleanup
  const hasValidateAllTimeout = serverCode.includes("validateAllTimeout");

  if (hasValidateAllTimeout) {
    console.log("\nvalidateAllTimeout exists: true");
    console.log("(This is a single timeout, not per-document, so different handling)");

    // This is a single timeout, not per-document, so we don't expect
    // cleanup in onDidClose for this one
  }
});
