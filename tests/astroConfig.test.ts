import { test } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import { CssVariableManager } from "../src/cssVariableManager";

class SilentLogger {
  log(_message: string) {}
  error(_message: string) {}
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

test("workspace discovery recognizes every supported Astro config extension", async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "css-lsp-astro-extensions-"),
  );
  const extensions = ["js", "mjs", "cjs", "ts", "mts", "cts"];
  try {
    for (const extension of extensions) {
      writeFile(
        path.join(directory, `astro.config.${extension}`),
        `export default defineConfig({ fonts: [{ cssVariable: "--font-${extension}" }] });`,
      );
    }
    const manager = new CssVariableManager(new SilentLogger(), ["**/*.css"]);
    await manager.scanWorkspace([URI.file(directory).toString()]);
    assert.deepEqual(
      manager
        .getAllVariables()
        .map((variable) => variable.name)
        .sort(),
      extensions.map((extension) => `--font-${extension}`).sort(),
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("workspace scan extracts static Astro font variables from config files", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "css-lsp-astro-"));
  const configPath = path.join(tempDir, "astro.config.mjs");
  const config = `
import { defineConfig } from "astro/config";
const dynamic = "--font-dynamic";
const unrelated = { cssVariable: "--font-unrelated" };
const unknownFont = getFont();

export default defineConfig({
  "fonts": [
    { name: "Roboto", "cssVariable": "--font-roboto" },
    { name: "Body", cssVariable: '--font-body' },
    { name: "Template", cssVariable: \`--font-template\` },
    { name: "Dynamic", cssVariable: dynamic },
    { name: "Call", cssVariable: getVariable() },
    { name: "TemplateExpr", cssVariable: \`--font-\${dynamic}\` },
    { name: "Computed", ["cssVariable"]: "--font-computed" },
    { name: "Overridden", cssVariable: "--font-overridden", cssVariable: dynamic },
    { name: "Spread", cssVariable: "--font-spread", ...unknownFont },
  ],
  experimental: {
    "fonts": [{ cssVariable: "--font-legacy" }],
  },
});
`;

  try {
    writeFile(configPath, config);
    writeFile(
      path.join(tempDir, "src", "ordinary.ts"),
      `const value = { cssVariable: "--font-ordinary" };`,
    );
    writeFile(
      path.join(tempDir, "node_modules", "pkg", "astro.config.js"),
      `export default defineConfig({ fonts: [{ cssVariable: "--font-node" }] });`,
    );
    writeFile(
      path.join(tempDir, "dist", "astro.config.ts"),
      `export default defineConfig({ fonts: [{ cssVariable: "--font-dist" }] });`,
    );

    const manager = new CssVariableManager(new SilentLogger());
    await manager.scanWorkspace([URI.file(tempDir).toString()]);

    assert.deepEqual(
      manager
        .getAllVariables()
        .map((variable) => variable.name)
        .sort(),
      ["--font-body", "--font-legacy", "--font-roboto", "--font-template"],
    );

    const configUri = URI.file(configPath).toString();
    const roboto = manager.getVariables("--font-roboto")[0];
    assert.equal(roboto.uri, configUri);
    const document = TextDocument.create(configUri, "javascript", 1, config);
    const literalStart = config.indexOf('"--font-roboto"');
    const literalEnd = literalStart + '"--font-roboto"'.length;
    assert.equal(document.offsetAt(roboto.range.start), literalStart);
    assert.equal(document.offsetAt(roboto.range.end), literalEnd);
    assert.equal(document.getText(roboto.nameRange), "--font-roboto");
    assert.equal(document.getText(roboto.valueRange), "--font-roboto");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Astro config discovery deduplicates overlapping workspace roots", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "css-lsp-astro-"));
  const nestedDir = path.join(tempDir, "packages", "site");

  try {
    writeFile(
      path.join(nestedDir, "astro.config.ts"),
      `export default defineConfig({ fonts: [{ cssVariable: "--font-site" }] });`,
    );
    const manager = new CssVariableManager(new SilentLogger());
    await manager.scanWorkspace([
      URI.file(tempDir).toString(),
      URI.file(nestedDir).toString(),
    ]);

    assert.equal(manager.getVariables("--font-site").length, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Astro config definitions update and remove with file lifecycle", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "css-lsp-astro-"));
  const configPath = path.join(tempDir, "astro.config.cts");
  const configUri = URI.file(configPath).toString();

  try {
    writeFile(
      configPath,
      `export default defineConfig({ fonts: [{ cssVariable: "--font-old" }] });`,
    );
    const manager = new CssVariableManager(new SilentLogger());
    await manager.updateFile(configUri);
    assert.equal(manager.getVariables("--font-old").length, 1);

    const updated = `export default defineConfig({ fonts: [{ cssVariable: "--font-new" }] });`;
    writeFile(configPath, updated);
    await manager.updateFile(configUri);
    assert.equal(manager.getVariables("--font-old").length, 0);
    assert.equal(manager.getVariables("--font-new").length, 1);

    fs.rmSync(configPath);
    await manager.updateFile(configUri);
    assert.equal(manager.getVariables("--font-new").length, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("incomplete Astro string literals are ignored safely", () => {
  const manager = new CssVariableManager(new SilentLogger());
  manager.parseContent(
    `export default defineConfig({ fonts: [{ cssVariable: "--font-broken }] });`,
    "file:///tmp/astro.config.ts",
    "typescript",
  );

  assert.equal(manager.getVariables("--font-broken").length, 0);
});

test("CommonJS Astro configs use the same static extraction", () => {
  const manager = new CssVariableManager(new SilentLogger());
  manager.parseContent(
    `module.exports = defineConfig({ fonts: [{ cssVariable: "--font-cjs" }] });`,
    "file:///tmp/astro.config.cjs",
    "javascript",
  );

  assert.equal(manager.getVariables("--font-cjs").length, 1);
});

test("watcher-style updates keep ignored Astro configs out of the index", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "css-lsp-astro-"));
  const configPath = path.join(
    tempDir,
    "node_modules",
    "pkg",
    "astro.config.js",
  );
  const configUri = URI.file(configPath).toString();
  const configText = `export default defineConfig({ fonts: [{ cssVariable: "--font-ignored" }] });`;

  try {
    writeFile(configPath, configText);
    const manager = new CssVariableManager(new SilentLogger());

    // Explicitly opened documents are still parsed, even if their path is in
    // an ignored directory; a disk watcher update must then honor ignores.
    manager.parseContent(configText, configUri, "javascript");
    assert.equal(manager.getVariables("--font-ignored").length, 1);
    await manager.updateFile(configUri);
    assert.equal(manager.getVariables("--font-ignored").length, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("watcher updates apply root-relative custom ignore globs", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "css-lsp-astro-"));
  const configPath = path.join(tempDir, "generated", "astro.config.ts");
  const configUri = URI.file(configPath).toString();
  const configText = `export default defineConfig({ fonts: [{ cssVariable: "--font-generated" }] });`;

  try {
    writeFile(configPath, configText);
    const manager = new CssVariableManager(new SilentLogger(), undefined, [
      "generated/**",
    ]);
    await manager.scanWorkspace([URI.file(tempDir).toString()]);
    assert.equal(manager.getVariables("--font-generated").length, 0);

    manager.parseContent(configText, configUri, "typescript");
    assert.equal(manager.getVariables("--font-generated").length, 1);
    await manager.updateFile(configUri);
    assert.equal(manager.getVariables("--font-generated").length, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
