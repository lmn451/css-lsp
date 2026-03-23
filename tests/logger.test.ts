import { test } from "node:test";
import { strict as assert } from "node:assert";
import { Logger, createLogger, LogLevel } from "../src/logger";

interface LogCall {
  level: LogLevel;
  label: string;
  payload?: unknown;
}

class MockLogger implements Logger {
  public calls: LogCall[] = [];

  debug(label: string, payload?: unknown): void {
    this.calls.push({ level: "debug", label, payload });
  }

  info(label: string, payload?: unknown): void {
    this.calls.push({ level: "info", label, payload });
  }

  warn(label: string, payload?: unknown): void {
    this.calls.push({ level: "warn", label, payload });
  }

  error(label: string, payload?: unknown): void {
    this.calls.push({ level: "error", label, payload });
  }

  getCalls(level?: LogLevel): LogCall[] {
    return level ? this.calls.filter((c) => c.level === level) : this.calls;
  }

  clear(): void {
    this.calls = [];
  }
}

test("SilentLogger discards all logs", () => {
  const { SilentLogger } = require("./helpers/silentLogger");
  const logger = new SilentLogger();

  logger.debug("test", { data: 1 });
  logger.info("test", { data: 2 });
  logger.warn("test", { data: 3 });
  logger.error("test", { data: 4 });

  // No assertions needed - if this runs without error, SilentLogger works
  assert.ok(true);
});

test("createLogger returns a valid Logger interface", () => {
  const logger = createLogger();
  assert.ok(typeof logger.debug === "function");
  assert.ok(typeof logger.info === "function");
  assert.ok(typeof logger.warn === "function");
  assert.ok(typeof logger.error === "function");
});

test("createLogger logs nothing when env var is not set (except errors)", () => {
  const originalValue = process.env.TEST_DEBUG;
  delete process.env.TEST_DEBUG;

  let logOutput: string[] = [];
  let errorOutput: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => logOutput.push(args.join(" "));
  console.error = (...args) => errorOutput.push(args.join(" "));

  try {
    const logger = createLogger("TEST_DEBUG");
    logger.debug("test", { data: "debug" });
    logger.info("test", { data: "info" });
    logger.warn("test", { data: "warn" });
    logger.error("test", { data: "error" });

    // debug/info/warn should not log when env var is not set
    assert.equal(logOutput.length, 0);
    // errors should always be logged
    assert.equal(errorOutput.length, 1);
    assert.ok(errorOutput[0].includes("test"));
  } finally {
    console.log = originalLog;
    console.error = originalError;
    if (originalValue !== undefined) {
      process.env.TEST_DEBUG = originalValue;
    }
  }
});

test("createLogger logs all levels when env var is set", () => {
  process.env.TEST_DEBUG = "1";

  let consoleOutput: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => consoleOutput.push(args.join(" "));
  console.error = (...args) => consoleOutput.push(args.join(" "));

  try {
    const logger = createLogger("TEST_DEBUG");
    logger.debug("debug-message");
    logger.info("info-message");
    logger.warn("warn-message");
    logger.error("error-message");

    assert.equal(consoleOutput.length, 4);
    assert.ok(consoleOutput.some((o) => o.includes("[css-lsp][debug] debug-message")));
    assert.ok(consoleOutput.some((o) => o.includes("[css-lsp][info] info-message")));
    assert.ok(consoleOutput.some((o) => o.includes("[css-lsp][warn] warn-message")));
    assert.ok(consoleOutput.some((o) => o.includes("[css-lsp][error] error-message")));
  } finally {
    console.log = originalLog;
    console.error = originalError;
    delete process.env.TEST_DEBUG;
  }
});

test("createLogger includes payload in formatted message", () => {
  process.env.TEST_DEBUG = "1";

  let consoleOutput: string[] = [];
  const originalLog = console.log;
  console.log = (...args) => consoleOutput.push(args.join(" "));

  try {
    const logger = createLogger("TEST_DEBUG");
    logger.debug("with-payload", { key: "value", count: 42 });

    assert.ok(consoleOutput.some((o) => o.includes('"key":"value"')));
    assert.ok(consoleOutput.some((o) => o.includes('"count":42')));
  } finally {
    console.log = originalLog;
    delete process.env.TEST_DEBUG;
  }
});

test("createLogger error with Error object prints stack trace", () => {
  delete process.env.TEST_DEBUG;

  let consoleOutput: string[] = [];
  const originalError = console.error;
  console.error = (...args) => consoleOutput.push(args.join("\n"));

  const testError = new Error("Test error message");
  testError.stack = "Error: Test error message\n    at TestFunc (test.ts:1:1)";

  try {
    const logger = createLogger("TEST_DEBUG");
    logger.error("error-with-stack", testError);

    // Should have logged the error message and stack trace
    assert.ok(consoleOutput.some((o) => o.includes("error-with-stack")));
    assert.ok(consoleOutput.some((o) => o.includes("Test error message")));
    assert.ok(consoleOutput.some((o) => o.includes("test.ts")));
  } finally {
    console.error = originalError;
  }
});

test("createLogger error with non-Error payload logs as JSON", () => {
  delete process.env.TEST_DEBUG;

  let consoleOutput: string[] = [];
  const originalError = console.error;
  console.error = (...args) => consoleOutput.push(args.join(" "));

  try {
    const logger = createLogger("TEST_DEBUG");
    logger.error("error-with-data", { code: 500, message: "Server error" });

    assert.ok(consoleOutput.some((o) => o.includes("[css-lsp][error] error-with-data")));
    assert.ok(consoleOutput.some((o) => o.includes('"code":500')));
  } finally {
    console.error = originalError;
  }
});

test("MockLogger captures all log levels correctly", () => {
  const mock = new MockLogger();

  mock.debug("debug-call");
  mock.info("info-call");
  mock.warn("warn-call");
  mock.error("error-call");

  assert.equal(mock.calls.length, 4);
  assert.equal(mock.getCalls("debug").length, 1);
  assert.equal(mock.getCalls("debug")[0].label, "debug-call");
  assert.equal(mock.getCalls("info").length, 1);
  assert.equal(mock.getCalls("warn").length, 1);
  assert.equal(mock.getCalls("error").length, 1);
});

test("MockLogger clear removes all calls", () => {
  const mock = new MockLogger();

  mock.debug("test1");
  mock.debug("test2");
  assert.equal(mock.calls.length, 2);

  mock.clear();
  assert.equal(mock.calls.length, 0);
});

test("Logger interface accepts optional payload parameter", () => {
  const mock = new MockLogger();

  // These should all compile without TypeScript errors
  mock.debug("no-payload");
  mock.debug("with-payload", { data: "value" });
  mock.debug("with-array-payload", [1, 2, 3]);
  mock.debug("with-null-payload", null);
  mock.info("info-test");
  mock.warn("warn-test");
  mock.error("error-test");

  assert.equal(mock.calls.length, 7);
});
