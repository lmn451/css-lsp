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
  private waiters: Array<(message: LspMessage) => void> = [];
  private nextId = 1;
  private serverRequestCounts = new Map<string, number>();

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

      const payload = this.buffer.slice(messageStart, messageEnd).toString("utf8");
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

    if (this.waiters.length) {
      this.waiters.shift()?.(message);
      return;
    }

    this.queue.push(message);
  }

  private async respondToServerRequest(message: LspMessage) {
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

  waitForNotification(
    method: string,
    predicate?: (params: unknown) => boolean,
    timeoutMs = 2000,
  ): Promise<LspMessage> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);

      const loop = async () => {
        while (true) {
          const message = await this.nextMessage();
          if (message.method !== method) {
            continue;
          }
          if (predicate && !predicate(message.params)) {
            continue;
          }
          clearTimeout(timeoutId);
          resolve(message);
          return;
        }
      };

      void loop();
    });
  }

  async request(method: string, params?: unknown): Promise<LspMessage> {
    const id = this.nextId++;
    this.send({ jsonrpc: "2.0", id, method, params });

    while (true) {
      const message = await this.nextMessage();
      if (message.id === id) {
        return message;
      }
    }
  }

  private async nextMessage(): Promise<LspMessage> {
    if (this.queue.length) {
      return this.queue.shift() as LspMessage;
    }

    return new Promise((resolve) => {
      this.waiters.push(resolve);
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
  await writeFile(
    cssPath,
    `:root { ${variableName}: #663399; }\n`,
    "utf8",
  );
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

test(
  "initialize advertises color provider disabled with --no-color-preview",
  async () => {
    const { child, client } = startServer(["--no-color-preview"]);
    try {
      const response = await initializeClient(client);
      const capabilities = (response.result as { capabilities: unknown })
        .capabilities as { colorProvider?: boolean };
      assert.equal(capabilities.colorProvider, false);
    } finally {
      await stopServer(child, client);
    }
  },
);

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
    assert.equal(symbols[0].location.uri, URI.file(workspace.cssPath).toString());
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
    const initialDiagnostics = (
      initial.params as { diagnostics: unknown[] }
    ).diagnostics;
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
    const updatedDiagnostics = (
      updated.params as { diagnostics: unknown[] }
    ).diagnostics;
    assert.equal(updatedDiagnostics.length, 0);
  } finally {
    await stopServer(child, client);
  }
});

test(
  "documentColor responds when enabled and is empty when disabled",
  async () => {
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
  },
);
