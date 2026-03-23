import { test } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { CssVariableManager } from "../src/cssVariableManager";
import { Logger } from "../src/logger";

interface LogCall {
  level: "debug" | "info" | "warn" | "error";
  label: string;
  payload?: unknown;
}

class MockLogger implements Logger {
  public calls: LogCall[] = [];

  debug = (label: string, payload?: unknown) => {
    this.calls.push({ level: "debug", label, payload });
  };

  info = (label: string, payload?: unknown) => {
    this.calls.push({ level: "info", label, payload });
  };

  warn = (label: string, payload?: unknown) => {
    this.calls.push({ level: "warn", label, payload });
  };

  error = (label: string, payload?: unknown) => {
    this.calls.push({ level: "error", label, payload });
  };

  getDebugCalls(): LogCall[] {
    return this.calls.filter((c) => c.level === "debug");
  }

  getInfoCalls(): LogCall[] {
    return this.calls.filter((c) => c.level === "info");
  }

  getErrorCalls(): LogCall[] {
    return this.calls.filter((c) => c.level === "error");
  }
}

async function withDebugEnv(
  value: string | undefined,
  fn: () => Promise<void> | void,
) {
  const previous = process.env.CSS_LSP_DEBUG;
  if (value === undefined) {
    delete process.env.CSS_LSP_DEBUG;
  } else {
    process.env.CSS_LSP_DEBUG = value;
  }

  try {
    await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.CSS_LSP_DEBUG;
    } else {
      process.env.CSS_LSP_DEBUG = previous;
    }
  }
}

test("debug logging disabled by default", async () => {
  await withDebugEnv(undefined, () => {
    const mockLogger = new MockLogger();
    const manager = new CssVariableManager(mockLogger);

    const cssContent = ":root { --color: red; }";
    manager.parseContent(cssContent, "file:///test.css", "css");

    const debugCalls = mockLogger.getDebugCalls();
    assert.ok(debugCalls.length === 0);
  });
});

test("debug logging gated by env var", async () => {
  const mockLogger = new MockLogger();

  await withDebugEnv("1", () => {
    mockLogger.debug("test", { data: "test" });
  });

  const debugCalls = mockLogger.getDebugCalls();
  assert.ok(debugCalls.length === 1);
  assert.strictEqual(debugCalls[0].label, "test");
});

test("production mode does not write log files", async () => {
  await withDebugEnv(undefined, () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "css-lsp-test-"));
    const testLogFile = path.join(testDir, "css.log");

    try {
      const mockLogger = new MockLogger();
      const manager = new CssVariableManager(mockLogger);

      manager.parseContent(":root { --a: red; }", "file:///test1.css", "css");
      manager.parseContent(".test { --b: blue; }", "file:///test2.css", "css");
      manager.parseContent(
        "<style>:root { --c: green; }</style>",
        "file:///test.html",
        "html",
      );

      assert.ok(!fs.existsSync(testLogFile));

      const logCallsBefore = mockLogger.getDebugCalls().length;
      manager.parseContent(":root { --d: yellow; }", "file:///test3.css", "css");
      const logCallsAfter = mockLogger.getDebugCalls().length;

      assert.ok(logCallsAfter === logCallsBefore);
    } finally {
      try {
        fs.rmSync(testDir, { recursive: true });
      } catch (e) {
      }
    }
  });
});

test("errors can still be logged in production", async () => {
  const mockLogger = new MockLogger();

  await withDebugEnv(undefined, () => {
    mockLogger.error("testError", { message: "test error message" });
  });

  const errorCalls = mockLogger.getErrorCalls();
  assert.ok(errorCalls.length === 1);
  assert.strictEqual(errorCalls[0].label, "testError");
});

test("no hardcoded debug file writes", () => {
  const serverPath = path.join(__dirname, "..", "src", "server.ts");
  const managerPath = path.join(
    __dirname,
    "..",
    "src",
    "cssVariableManager.ts",
  );

  let hasIssues = false;

  const serverContent = fs.readFileSync(serverPath, "utf-8");
  const managerContent = fs.readFileSync(managerPath, "utf-8");

  const problematicPatterns = ["/tmp/", "appendFileSync", "writeFileSync"];

  for (const pattern of problematicPatterns) {
    if (serverContent.includes(pattern) || managerContent.includes(pattern)) {
      hasIssues = true;
    }
  }

  assert.ok(!hasIssues);
});

test("CSS_LSP_DEBUG environment variable truthiness", async () => {
  const testCases = [
    { value: undefined, expected: false, desc: "undefined" },
    { value: "", expected: false, desc: "empty string" },
    { value: "0", expected: true, desc: "0 (truthy string)" },
    { value: "1", expected: true, desc: "1" },
    { value: "true", expected: true, desc: "true" },
    { value: "false", expected: true, desc: "false (truthy string)" },
  ];

  for (const testCase of testCases) {
    await withDebugEnv(testCase.value, () => {
      const isDebugEnabled = !!process.env.CSS_LSP_DEBUG;
      assert.strictEqual(
        isDebugEnabled,
        testCase.expected,
        `CSS_LSP_DEBUG=${testCase.desc}`,
      );
    });
  }
});
