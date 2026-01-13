import { test } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import { CssVariableManager } from "../src/cssVariableManager";
import { collectDocumentColors } from "../src/colorProvider";

const shouldRun = process.env.CSS_LSP_PERF === "1";

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function toHex(value: number): string {
  return value.toString(16).padStart(2, "0");
}

function colorFor(fileIndex: number, varIndex: number): string {
  const r = (fileIndex * 31 + varIndex * 17) % 256;
  const g = (fileIndex * 47 + varIndex * 13) % 256;
  const b = (fileIndex * 19 + varIndex * 29) % 256;
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function buildCssContent(fileIndex: number, varsPerFile: number): string {
  const lines = [":root {"];
  for (let i = 0; i < varsPerFile; i++) {
    lines.push(`  --perf-${fileIndex}-${i}: ${colorFor(fileIndex, i)};`);
  }
  lines.push("}");
  lines.push(
    `.demo-${fileIndex} { color: var(--perf-${fileIndex}-0); background: var(--perf-${fileIndex}-1); }`,
  );
  return lines.join("\n");
}

function buildHtmlContent(fileIndex: number): string {
  const varName = `--perf-${fileIndex}-0`;
  return `<!doctype html>
<html>
  <head>
    <style>
      :root { ${varName}: ${colorFor(fileIndex, 0)}; }
      .demo-${fileIndex} { color: var(${varName}); }
    </style>
  </head>
  <body>
    <div class="demo-${fileIndex}" style="background: var(${varName});">
      Perf
    </div>
  </body>
</html>
`;
}

function writeFixtureFiles(
  root: string,
  cssFileCount: number,
  varsPerFile: number,
  htmlFileCount: number,
): void {
  for (let i = 0; i < cssFileCount; i++) {
    const filePath = path.join(
      root,
      `packages/pkg-${i % 10}`,
      "src",
      `file-${i}.css`,
    );
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buildCssContent(i, varsPerFile));
  }

  for (let i = 0; i < htmlFileCount; i++) {
    const filePath = path.join(root, "pages", `page-${i}.html`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buildHtmlContent(i));
  }

  const ignoredPath = path.join(root, "node_modules", "pkg", "ignored.css");
  fs.mkdirSync(path.dirname(ignoredPath), { recursive: true });
  fs.writeFileSync(ignoredPath, ":root { --ignored: #000; }");
}

function buildUsageDocument(
  totalVars: number,
  varsPerFile: number,
  usageCount: number,
): string {
  const lines = [":root { }", ".usage {"];
  for (let i = 0; i < usageCount; i++) {
    const varIndex = i % totalVars;
    const fileIndex = Math.floor(varIndex / varsPerFile);
    const localIndex = varIndex % varsPerFile;
    const varName = `--perf-${fileIndex}-${localIndex}`;
    lines.push(`  color: var(${varName});`);
  }
  lines.push("}");
  return lines.join("\n");
}

if (!shouldRun) {
  test("perf checks (skipped)", { skip: true }, () => {});
} else {
  test("perf: workspace scan and color collection budgets", async () => {
    const cssFileCount = readNumber("CSS_LSP_PERF_FILES", 400);
    const varsPerFile = readNumber("CSS_LSP_PERF_VARS_PER_FILE", 20);
    const htmlFileCount = readNumber("CSS_LSP_PERF_HTML_FILES", 50);
    const usageCount = readNumber("CSS_LSP_PERF_COLOR_USAGES", 2000);

    const scanMsPerFile = readNumber("CSS_LSP_PERF_SCAN_MS_PER_FILE", 15);
    const colorMsPerUsage = readNumber("CSS_LSP_PERF_COLOR_MS_PER_USAGE", 1);

    assert.ok(
      cssFileCount > 0 && varsPerFile > 0,
      "CSS_LSP_PERF_FILES and CSS_LSP_PERF_VARS_PER_FILE must be > 0",
    );
    assert.ok(
      usageCount > 0,
      "CSS_LSP_PERF_COLOR_USAGES must be > 0",
    );

    const totalFiles = cssFileCount + htmlFileCount;
    const totalVars = cssFileCount * varsPerFile;
    const scanBudgetMs = scanMsPerFile * totalFiles;
    const colorBudgetMs = colorMsPerUsage * usageCount;

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "css-lsp-perf-"));

    try {
      writeFixtureFiles(tempDir, cssFileCount, varsPerFile, htmlFileCount);

      const manager = new CssVariableManager();
      const scanStart = performance.now();
      await manager.scanWorkspace([URI.file(tempDir).toString()]);
      const scanDuration = performance.now() - scanStart;

      const usageDoc = TextDocument.create(
        "file:///perf.css",
        "css",
        1,
        buildUsageDocument(totalVars, varsPerFile, usageCount),
      );
      const colorsStart = performance.now();
      const colors = collectDocumentColors(usageDoc, manager, {
        enabled: true,
        onlyVariables: true,
      });
      const colorsDuration = performance.now() - colorsStart;

      assert.equal(
        colors.length,
        usageCount,
        `Expected ${usageCount} colors, got ${colors.length}`,
      );
      assert.ok(
        scanDuration <= scanBudgetMs,
        `scanWorkspace took ${scanDuration.toFixed(1)}ms for ${totalFiles} files (budget ${scanBudgetMs}ms)`,
      );
      assert.ok(
        colorsDuration <= colorBudgetMs,
        `collectDocumentColors took ${colorsDuration.toFixed(1)}ms for ${usageCount} usages (budget ${colorBudgetMs}ms)`,
      );

      console.log(
        `perf: scan ${scanDuration.toFixed(1)}ms (${(scanDuration / totalFiles).toFixed(2)}ms/file),`,
        `colors ${colorsDuration.toFixed(1)}ms (${(colorsDuration / usageCount).toFixed(2)}ms/usage)`,
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
}
