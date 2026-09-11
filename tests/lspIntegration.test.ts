import { test } from "node:test";
import { strict as assert } from "node:assert";
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";

interface LspMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

interface LspClientOptions {
  workspaceFolders?: Array<{ uri: string; name: string }> | null;
  workspaceFoldersError?: boolean;
}

class LspClient {
  private buffer = Buffer.alloc(0);
  private queue: LspMessage[] = [];
  private waiters: Array<{
    matches: (message: LspMessage) => boolean;
    resolve: (message: LspMessage) => void;
  }> = [];
  private nextId = 1;
  private serverRequestCounts = new Map<string, number>();
  private serverRequests: LspMessage[] = [];
  private notifications: LspMessage[] = [];

  constructor(
    private child: ChildProcessWithoutNullStreams,
    private options: LspClientOptions = {},
  ) {
    this.child.stdout.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drainBuffer();
    });
  }

  private drainBuffer() {
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        return;
      }

      const header = this.buffer.slice(0, headerEnd).toString("ascii");
      const match = header.match(/Content-Length: (\d+)/i);
      if (!match) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }

      const length = Number.parseInt(match[1], 10);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + length;
      if (this.buffer.length < messageEnd) {
        return;
      }

      const payload = this.buffer
        .slice(messageStart, messageEnd)
        .toString("utf8");
      this.buffer = this.buffer.slice(messageEnd);
      const message = JSON.parse(payload) as LspMessage;
      void this.handleMessage(message);
    }
  }

  private async handleMessage(message: LspMessage) {
    if (message.method && message.id !== undefined) {
      await this.respondToServerRequest(message);
      return;
    }

    if (message.method) {
      this.notifications.push(message);
    }
    const waiterIndex = this.waiters.findIndex((waiter) =>
      waiter.matches(message),
    );
    if (waiterIndex !== -1) {
      this.waiters.splice(waiterIndex, 1)[0].resolve(message);
      return;
    }

    this.queue.push(message);
  }

  private async respondToServerRequest(message: LspMessage) {
    this.serverRequests.push(message);
    const method = message.method as string;
    this.serverRequestCounts.set(
      method,
      (this.serverRequestCounts.get(method) ?? 0) + 1,
    );

    let result: unknown = null;
    switch (message.method) {
      case "workspace/workspaceFolders":
        if (this.options.workspaceFoldersError) {
          this.send({
            jsonrpc: "2.0",
            id: message.id,
            error: {
              code: -32603,
              message: "workspace folders unavailable",
            },
          });
          return;
        }
        result =
          this.options.workspaceFolders === undefined
            ? []
            : this.options.workspaceFolders;
        break;
      case "workspace/configuration":
        result = [];
        break;
      case "client/registerCapability":
        result = null;
        break;
      default:
        result = null;
        break;
    }

    this.send({
      jsonrpc: "2.0",
      id: message.id,
      result,
    });
  }

  private send(message: LspMessage) {
    const json = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n`;
    this.child.stdin.write(header + json);
  }

  notify(method: string, params?: unknown) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  getServerRequestCount(method: string): number {
    return this.serverRequestCounts.get(method) ?? 0;
  }

  getServerRequests(method: string): LspMessage[] {
    return this.serverRequests.filter((message) => message.method === method);
  }

  diagnosticCount(uri: string): number {
    return this.notifications.filter(
      (message) =>
        message.method === "textDocument/publishDiagnostics" &&
        (message.params as { uri: string }).uri === uri,
    ).length;
  }

  waitForNotification(
    method: string,
    predicate?: (params: unknown) => boolean,
    timeoutMs = 2000,
  ): Promise<LspMessage> {
    return this.nextMessage(
      (message) =>
        message.method === method && (!predicate || predicate(message.params)),
      timeoutMs,
      method,
    );
  }

  async request(method: string, params?: unknown): Promise<LspMessage> {
    const id = this.nextId++;
    this.send({ jsonrpc: "2.0", id, method, params });

    const response = await this.nextMessage(
      (message) => message.id === id,
      15000,
      method,
    );
    assert.equal(
      response.error,
      undefined,
      `${method}: ${JSON.stringify(response.error)}`,
    );
    return response;
  }

  private async nextMessage(
    matches: (message: LspMessage) => boolean,
    timeoutMs: number,
    description: string,
  ): Promise<LspMessage> {
    const index = this.queue.findIndex(matches);
    if (index !== -1) {
      return this.queue.splice(index, 1)[0];
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        matches,
        resolve: (message: LspMessage) => {
          clearTimeout(timeout);
          resolve(message);
        },
      };
      const timeout = setTimeout(() => {
        this.waiters = this.waiters.filter((pending) => pending !== waiter);
        reject(new Error(`Timed out waiting for ${description}`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  async shutdown() {
    try {
      await this.request("shutdown");
    } catch {
      // Ignore shutdown errors during cleanup
    }
    this.notify("exit");
  }
}

function startServer(args: string[] = [], options: LspClientOptions = {}) {
  const serverPath = path.join(__dirname, "..", "src", "server.ts");
  const child = spawn(
    process.execPath,
    ["--require", "ts-node/register", serverPath, "--stdio", ...args],
    {
      cwd: path.join(__dirname, ".."),
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        TS_NODE_PROJECT: path.join(__dirname, "..", "tsconfig.json"),
      },
    },
  ) as ChildProcessWithoutNullStreams;

  return { child, client: new LspClient(child, options) };
}

async function stopServer(
  child: ChildProcessWithoutNullStreams,
  client: LspClient,
) {
  await client.shutdown();
  if (!child.killed) {
    child.kill();
  }
}

async function initializeClient(
  client: LspClient,
  overrides: Record<string, unknown> = {},
) {
  const response = await client.request("initialize", {
    processId: null,
    rootUri: null,
    capabilities: {},
    workspaceFolders: null,
    ...overrides,
  });
  client.notify("initialized");
  return response;
}

async function createWorkspace(variableName: string) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "css-lsp-integration-"),
  );
  const cssPath = path.join(directory, "variables.css");
  await writeFile(cssPath, `:root { ${variableName}: #663399; }\n`, "utf8");
  return { directory, cssPath };
}

async function waitForWorkspaceScan(client: LspClient) {
  await client.waitForNotification(
    "window/logMessage",
    (params) => {
      const message = (params as { message?: unknown }).message;
      return (
        typeof message === "string" &&
        message.includes("Workspace scan complete")
      );
    },
    5000,
  );
}

function fullDocumentRange(text: string) {
  const doc = TextDocument.create("file:///range.css", "css", 1, text);
  return {
    start: { line: 0, character: 0 },
    end: doc.positionAt(text.length),
  };
}

function openDocument(
  client: LspClient,
  uri: string,
  text: string,
  languageId = "css",
) {
  client.notify("textDocument/didOpen", {
    textDocument: { uri, languageId, version: 1, text },
  });
}

function changeDocument(
  client: LspClient,
  uri: string,
  version: number,
  text: string,
) {
  client.notify("textDocument/didChange", {
    textDocument: { uri, version },
    contentChanges: [{ text }],
  });
}

async function expectUndefined(
  client: LspClient,
  uri: string,
  names: string[],
) {
  await client.waitForNotification(
    "textDocument/publishDiagnostics",
    (params) => {
      const payload = params as {
        uri: string;
        diagnostics: Array<{ message: string }>;
      };
      return (
        payload.uri === uri &&
        payload.diagnostics.length === names.length &&
        names.every((name) =>
          payload.diagnostics.some((diagnostic) =>
            diagnostic.message.includes(`'${name}'`),
          ),
        )
      );
    },
    5000,
  );
}

test("definition add, remove, rename and rapid edits revalidate all dependents only", async () => {
  const { child, client } = startServer();
  const varsUri = "file:///transition-vars.scss";
  const secondVarsUri = "file:///second-vars.css";
  const oldConsumer = "file:///old-consumer.scss";
  const newConsumer = "file:///new-consumer.scss";
  const otherConsumer = "file:///other-consumer.css";
  const scriptConsumer = "file:///script-consumer.js";
  const unrelated = "file:///unrelated.css";
  try {
    await initializeClient(client);
    openDocument(client, varsUri, ":root { --old: red; }", "scss");
    openDocument(client, secondVarsUri, ":root { --other: red; }");
    openDocument(client, oldConsumer, ".old { color: var(--old); }", "scss");
    openDocument(client, newConsumer, ".new { color: var(--new); }", "scss");
    openDocument(client, otherConsumer, ".other { color: var(--other); }");
    openDocument(
      client,
      scriptConsumer,
      'const style = "var(--old)";',
      "javascript",
    );
    openDocument(client, unrelated, ".plain { color: red; }");
    await expectUndefined(client, oldConsumer, []);
    await expectUndefined(client, newConsumer, ["--new"]);
    await expectUndefined(client, otherConsumer, []);
    await expectUndefined(client, scriptConsumer, []);
    await expectUndefined(client, unrelated, []);
    const unrelatedCount = client.diagnosticCount(unrelated);

    changeDocument(client, varsUri, 2, ":root { --new: blue; }");
    await expectUndefined(client, oldConsumer, ["--old"]);
    await expectUndefined(client, scriptConsumer, ["--old"]);
    await expectUndefined(client, newConsumer, []);

    changeDocument(client, varsUri, 3, ":root {}");
    await expectUndefined(client, newConsumer, ["--new"]);

    changeDocument(client, varsUri, 4, ":root { --old: red; --new: blue; }");
    await expectUndefined(client, oldConsumer, []);
    await expectUndefined(client, newConsumer, []);

    // A later edit with no definitions must not discard removed names, even
    // when another file changes in the same debounce window.
    changeDocument(client, varsUri, 5, ":root {}");
    changeDocument(client, secondVarsUri, 2, ":root {}");
    changeDocument(client, varsUri, 6, ":root { /* still empty */ }");
    await expectUndefined(client, oldConsumer, ["--old"]);
    await expectUndefined(client, newConsumer, ["--new"]);
    await expectUndefined(client, otherConsumer, ["--other"]);
    assert.equal(client.diagnosticCount(unrelated), unrelatedCount);
  } finally {
    await stopServer(child, client);
  }
});

test("watched changes, deletion and closing an unsaved definition refresh dependents", async () => {
  const workspace = await createWorkspace("--disk");
  const { child, client } = startServer();
  const varsUri = URI.file(workspace.cssPath).toString();
  const mainUri = URI.file(
    path.join(workspace.directory, "main.css"),
  ).toString();
  try {
    await initializeClient(client, {
      rootUri: URI.file(workspace.directory).toString(),
    });
    await waitForWorkspaceScan(client);
    openDocument(
      client,
      mainUri,
      ".a { color: var(--disk); background: var(--renamed); }",
    );
    await expectUndefined(client, mainUri, ["--renamed"]);

    await writeFile(workspace.cssPath, ":root { --renamed: blue; }");
    client.notify("workspace/didChangeWatchedFiles", {
      changes: [{ uri: varsUri, type: 2 }],
    });
    await expectUndefined(client, mainUri, ["--disk"]);

    await rm(workspace.cssPath);
    client.notify("workspace/didChangeWatchedFiles", {
      changes: [{ uri: varsUri, type: 3 }],
    });
    await expectUndefined(client, mainUri, ["--disk", "--renamed"]);

    await writeFile(workspace.cssPath, ":root { --disk: red; }");
    client.notify("workspace/didChangeWatchedFiles", {
      changes: [{ uri: varsUri, type: 1 }],
    });
    await expectUndefined(client, mainUri, ["--renamed"]);

    openDocument(client, varsUri, ":root { --renamed: blue; }");
    await expectUndefined(client, mainUri, ["--disk"]);
    client.notify("workspace/didChangeWatchedFiles", {
      changes: [{ uri: varsUri.replace("file:///", "file:/"), type: 2 }],
    });
    const unsavedSymbols = await client.request("workspace/symbol", {
      query: "renamed",
    });
    assert.equal(
      (unsavedSymbols.result as unknown[]).length,
      1,
      "Equivalent watcher URIs must not overwrite unsaved definitions",
    );
    client.notify("textDocument/didClose", { textDocument: { uri: varsUri } });
    const restoredSymbols = await client.request("workspace/symbol", {
      query: "disk",
    });
    assert.equal((restoredSymbols.result as unknown[]).length, 1);
    await expectUndefined(client, mainUri, ["--renamed"]);

    openDocument(client, varsUri, ":root { --disk: red; }");
    await rm(workspace.cssPath);
    client.notify("workspace/didChangeWatchedFiles", {
      changes: [{ uri: varsUri, type: 3 }],
    });
    await expectUndefined(client, mainUri, ["--disk", "--renamed"]);
  } finally {
    await stopServer(child, client);
    await rm(workspace.directory, { recursive: true, force: true });
  }
});

test("documentColor omits malformed colors and serializes only finite unit channels", async () => {
  const { child, client } = startServer();
  const uri = "file:///invalid-colors.css";
  const text =
    ":root { --bad: #gggggg; --partial: rgb(1x, 0, 0); --valid: #abc; --clamped: rgb(999, 0, 0); } .a { color: var(--bad); }";
  try {
    await initializeClient(client);
    openDocument(client, uri, text);
    const response = await client.request("textDocument/documentColor", {
      textDocument: { uri },
    });
    const colors = response.result as Array<{
      range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
      };
      color: Record<string, number>;
    }>;
    const document = TextDocument.create(uri, "css", 1, text);
    assert.ok(colors.some((entry) => document.getText(entry.range) === "#abc"));
    for (const entry of colors) {
      assert.ok(
        ["#abc", "rgb(999, 0, 0)"].includes(document.getText(entry.range)),
      );
      for (const channel of Object.values(entry.color)) {
        assert.ok(Number.isFinite(channel) && channel >= 0 && channel <= 1);
      }
    }
  } finally {
    await stopServer(child, client);
  }
});

for (const extension of ["mjs", "ts"]) {
  test(`Astro ${extension} config supports completion, navigation and diagnostic lifecycle`, async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "css-lsp-astro-integration-"),
    );
    const configPath = path.join(directory, `astro.config.${extension}`);
    const configUri = URI.file(configPath).toString();
    const configText =
      'import { defineConfig } from "astro/config";\nexport default defineConfig({ fonts: [{ cssVariable: "--font-roboto" }, { "cssVariable": "--font-serif" }] });';
    await writeFile(configPath, configText);
    const { child, client } = startServer();
    const mainUri = URI.file(path.join(directory, "main.css")).toString();
    const mainText = ".text { font-family: var(--font-roboto); }";
    try {
      await initializeClient(client, {
        rootUri: URI.file(directory).toString(),
        capabilities: {
          workspace: { didChangeWatchedFiles: { dynamicRegistration: true } },
        },
      });
      await waitForWorkspaceScan(client);
      const registrations = client.getServerRequests(
        "client/registerCapability",
      );
      assert.ok(
        JSON.stringify(registrations).includes(
          "astro.config.{js,mjs,cjs,ts,mts,cts}",
        ),
        JSON.stringify(registrations),
      );
      openDocument(client, mainUri, mainText);
      await expectUndefined(client, mainUri, []);

      const completion = await client.request("textDocument/completion", {
        textDocument: { uri: mainUri },
        position: { line: 0, character: mainText.indexOf("--font") + 2 },
      });
      const labels = (completion.result as Array<{ label: string }>).map(
        (entry) => entry.label,
      );
      assert.ok(labels.includes("--font-roboto"));
      assert.ok(labels.includes("--font-serif"));

      const definition = await client.request("textDocument/definition", {
        textDocument: { uri: mainUri },
        position: { line: 0, character: mainText.indexOf("--font") + 4 },
      });
      const location = definition.result as {
        uri: string;
        range: Parameters<TextDocument["getText"]>[0];
      };
      assert.equal(location.uri, configUri);
      const configDocument = TextDocument.create(
        configUri,
        "typescript",
        1,
        configText,
      );
      assert.equal(configDocument.getText(location.range), '"--font-roboto"');
      const hover = await client.request("textDocument/hover", {
        textDocument: { uri: mainUri },
        position: { line: 0, character: mainText.indexOf("--font") + 4 },
      });
      assert.ok(JSON.stringify(hover.result).includes("astro.config"));

      const references = await client.request("textDocument/references", {
        textDocument: { uri: mainUri },
        position: { line: 0, character: mainText.indexOf("--font") + 4 },
        context: { includeDeclaration: true },
      });
      assert.deepEqual(
        (references.result as Array<{ uri: string }>)
          .map((reference) => reference.uri)
          .sort(),
        [configUri, mainUri].sort(),
      );
      const rename = await client.request("textDocument/rename", {
        textDocument: { uri: mainUri },
        position: { line: 0, character: mainText.indexOf("--font") + 4 },
        newName: "--font-renamed",
      });
      const changes = (
        rename.result as {
          changes: Record<
            string,
            Parameters<typeof TextDocument.applyEdits>[1]
          >;
        }
      ).changes;
      assert.equal(
        TextDocument.applyEdits(configDocument, changes[configUri]),
        configText.replace("--font-roboto", "--font-renamed"),
      );
      assert.equal(
        TextDocument.applyEdits(
          TextDocument.create(mainUri, "css", 1, mainText),
          changes[mainUri],
        ),
        mainText.replace("--font-roboto", "--font-renamed"),
      );

      openDocument(
        client,
        configUri,
        configText,
        extension === "ts" ? "typescript" : "javascript",
      );
      changeDocument(
        client,
        configUri,
        2,
        configText.replace("--font-roboto", "--font-sans"),
      );
      await expectUndefined(client, mainUri, ["--font-roboto"]);
      changeDocument(client, configUri, 3, configText);
      await expectUndefined(client, mainUri, []);
      client.notify("textDocument/didClose", {
        textDocument: { uri: configUri },
      });
      // The close handler restores the disk version before a request completes.
      await client.request("workspace/symbol", { query: "font-roboto" });

      await writeFile(
        configPath,
        "export default defineConfig({ fonts: [] });",
      );
      client.notify("workspace/didChangeWatchedFiles", {
        changes: [{ uri: configUri, type: 2 }],
      });
      await expectUndefined(client, mainUri, ["--font-roboto"]);
      await writeFile(configPath, configText);
      client.notify("workspace/didChangeWatchedFiles", {
        changes: [{ uri: configUri, type: 2 }],
      });
      await expectUndefined(client, mainUri, []);
      await rm(configPath);
      client.notify("workspace/didChangeWatchedFiles", {
        changes: [{ uri: configUri, type: 3 }],
      });
      await expectUndefined(client, mainUri, ["--font-roboto"]);
    } finally {
      await stopServer(child, client);
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("initialize advertises color provider disabled with --no-color-preview", async () => {
  const { child, client } = startServer(["--no-color-preview"]);
  try {
    const response = await initializeClient(client);
    const capabilities = (response.result as { capabilities: unknown })
      .capabilities as { colorProvider?: boolean };
    assert.equal(capabilities.colorProvider, false);
  } finally {
    await stopServer(child, client);
  }
});

test("rootUri scans without requesting unsupported workspace folders", async () => {
  const workspace = await createWorkspace("--root-color");
  const { child, client } = startServer();
  try {
    await initializeClient(client, {
      rootUri: URI.file(workspace.directory).toString(),
    });
    await waitForWorkspaceScan(client);

    assert.equal(client.getServerRequestCount("workspace/workspaceFolders"), 0);

    const symbolsResponse = await client.request("workspace/symbol", {
      query: "root-color",
    });
    const symbols = symbolsResponse.result as Array<{ name: string }>;
    assert.deepEqual(
      symbols.map((symbol) => symbol.name),
      ["--root-color"],
    );

    const documentText = ".card { color: var(--root";
    const documentUri = URI.file(
      path.join(workspace.directory, "consumer.css"),
    ).toString();
    client.notify("textDocument/didOpen", {
      textDocument: {
        uri: documentUri,
        languageId: "css",
        version: 1,
        text: documentText,
      },
    });
    const completionResponse = await client.request("textDocument/completion", {
      textDocument: { uri: documentUri },
      position: { line: 0, character: documentText.length },
    });
    const completions = completionResponse.result as Array<{ label: string }>;
    assert.ok(
      completions.some((completion) => completion.label === "--root-color"),
    );
  } finally {
    await stopServer(child, client);
    await rm(workspace.directory, { recursive: true, force: true });
  }
});

test("legacy rootPath is converted to a file URI for scanning", async () => {
  const workspace = await createWorkspace("--legacy-root");
  const { child, client } = startServer();
  try {
    await initializeClient(client, {
      rootPath: workspace.directory,
    });
    await waitForWorkspaceScan(client);

    const symbolsResponse = await client.request("workspace/symbol", {
      query: "legacy-root",
    });
    const symbols = symbolsResponse.result as Array<{
      name: string;
      location: { uri: string };
    }>;
    assert.equal(symbols.length, 1);
    assert.equal(symbols[0].name, "--legacy-root");
    assert.equal(
      symbols[0].location.uri,
      URI.file(workspace.cssPath).toString(),
    );
  } finally {
    await stopServer(child, client);
    await rm(workspace.directory, { recursive: true, force: true });
  }
});

test("advertised multi-root folders take precedence without duplicates", async () => {
  const rootWorkspace = await createWorkspace("--root-only");
  const advertisedWorkspace = await createWorkspace("--workspace-only");
  const { child, client } = startServer([], {
    workspaceFolders: [
      {
        uri: URI.file(rootWorkspace.directory).toString(),
        name: "root",
      },
      {
        uri: URI.file(advertisedWorkspace.directory).toString(),
        name: "advertised",
      },
    ],
  });
  try {
    await initializeClient(client, {
      rootUri: URI.file(rootWorkspace.directory).toString(),
      capabilities: { workspace: { workspaceFolders: true } },
    });
    await waitForWorkspaceScan(client);

    assert.equal(client.getServerRequestCount("workspace/workspaceFolders"), 1);

    const advertisedResponse = await client.request("workspace/symbol", {
      query: "workspace-only",
    });
    assert.equal((advertisedResponse.result as unknown[]).length, 1);

    const rootResponse = await client.request("workspace/symbol", {
      query: "root-only",
    });
    assert.equal((rootResponse.result as unknown[]).length, 1);
  } finally {
    await stopServer(child, client);
    await rm(rootWorkspace.directory, { recursive: true, force: true });
    await rm(advertisedWorkspace.directory, { recursive: true, force: true });
  }
});

test("rootUri is the fallback for unavailable workspace folders", async () => {
  const cases: Array<{ name: string; options: LspClientOptions }> = [
    { name: "null response", options: { workspaceFolders: null } },
    { name: "empty response", options: { workspaceFolders: [] } },
    { name: "failed request", options: { workspaceFoldersError: true } },
  ];

  for (const testCase of cases) {
    const workspace = await createWorkspace("--fallback-root");
    const { child, client } = startServer([], testCase.options);
    try {
      await initializeClient(client, {
        rootUri: URI.file(workspace.directory).toString(),
        capabilities: { workspace: { workspaceFolders: true } },
      });
      await waitForWorkspaceScan(client);

      const symbolsResponse = await client.request("workspace/symbol", {
        query: "fallback-root",
      });
      assert.equal(
        (symbolsResponse.result as unknown[]).length,
        1,
        testCase.name,
      );
    } finally {
      await stopServer(child, client);
      await rm(workspace.directory, { recursive: true, force: true });
    }
  }
});

test("diagnostics revalidate across open documents", async () => {
  const { child, client } = startServer();
  try {
    await initializeClient(client);

    const varsUri = "file:///vars.scss";
    const mainUri = "file:///main.scss";
    const varsV1 = ":root { --accent: red; }\n";
    const main = ".btn { color: var(--accent-missing); }\n";

    client.notify("textDocument/didOpen", {
      textDocument: {
        uri: varsUri,
        languageId: "scss",
        version: 1,
        text: varsV1,
      },
    });
    client.notify("textDocument/didOpen", {
      textDocument: {
        uri: mainUri,
        languageId: "scss",
        version: 1,
        text: main,
      },
    });

    const initial = await client.waitForNotification(
      "textDocument/publishDiagnostics",
      (params) => (params as { uri?: string }).uri === mainUri,
    );
    const initialDiagnostics = (initial.params as { diagnostics: unknown[] })
      .diagnostics;
    assert.equal(initialDiagnostics.length, 1);

    const varsV2 = ":root { --accent-missing: red; }\n";
    client.notify("textDocument/didChange", {
      textDocument: {
        uri: varsUri,
        version: 2,
      },
      contentChanges: [
        {
          range: fullDocumentRange(varsV1),
          text: varsV2,
        },
      ],
    });

    const updated = await client.waitForNotification(
      "textDocument/publishDiagnostics",
      (params) => {
        const payload = params as { uri?: string; diagnostics?: unknown[] };
        return payload.uri === mainUri && Array.isArray(payload.diagnostics);
      },
      3000,
    );
    const updatedDiagnostics = (updated.params as { diagnostics: unknown[] })
      .diagnostics;
    assert.equal(updatedDiagnostics.length, 0);
  } finally {
    await stopServer(child, client);
  }
});

test("documentColor responds when enabled and is empty when disabled", async () => {
  const css = `
:root { --primary: #ff0000; }
.btn { color: var(--primary); }
`;
  const uri = "file:///colors.css";

  const enabledServer = startServer();
  try {
    await initializeClient(enabledServer.client);
    enabledServer.client.notify("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: "css",
        version: 1,
        text: css,
      },
    });

    const response = await enabledServer.client.request(
      "textDocument/documentColor",
      {
        textDocument: { uri },
      },
    );

    const colors = response.result as Array<unknown>;
    assert.equal(colors.length, 2);
  } finally {
    await stopServer(enabledServer.child, enabledServer.client);
  }

  const disabledServer = startServer(["--no-color-preview"]);
  try {
    await initializeClient(disabledServer.client);
    disabledServer.client.notify("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: "css",
        version: 1,
        text: css,
      },
    });

    const response = await disabledServer.client.request(
      "textDocument/documentColor",
      {
        textDocument: { uri },
      },
    );

    const colors = response.result as Array<unknown>;
    assert.equal(colors.length, 0);
  } finally {
    await stopServer(disabledServer.child, disabledServer.client);
  }
});
