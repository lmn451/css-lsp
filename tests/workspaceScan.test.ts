import { test } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { URI } from "vscode-uri";
import { CssVariableManager } from "../src/cssVariableManager";

class SilentLogger {
  log(_message: string) {}
  error(_message: string) {}
}

function writeFile(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

test("scanWorkspace applies lookup globs and ignores node_modules", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "css-lsp-scan-"));

  try {
    writeFile(
      path.join(tempDir, "src", "main.css"),
      ":root { --scan-var: red; }",
    );
    writeFile(
      path.join(tempDir, "src", "partial.scss"),
      ":root { --scan-scss: blue; }",
    );
    writeFile(
      path.join(tempDir, "node_modules", "pkg", "ignored.css"),
      ":root { --ignored-var: green; }",
    );
    writeFile(
      path.join(tempDir, "src", "notes.txt"),
      ":root { --not-css: black; }",
    );

    const manager = new CssVariableManager(new SilentLogger(), [
      "**/*.{css,scss}",
    ]);
    await manager.scanWorkspace([URI.file(tempDir).toString()]);

    assert.equal(manager.getVariables("--scan-var").length, 1);
    assert.equal(manager.getVariables("--scan-scss").length, 1);
    assert.equal(manager.getVariables("--ignored-var").length, 0);
    assert.equal(manager.getVariables("--not-css").length, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
