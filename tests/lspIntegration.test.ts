import { test } from "node:test";
import { strict as assert } from "node:assert";
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import * as path from "node:path";

interface LspMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

class LspClient {
  private buffer = Buffer.alloc(0);
  private queue: LspMessage[] = [];
  private waiters: Array<(message: LspMessage) => void> = [];
  private nextId = 1;

  constructor(private child: ChildProcessWithoutNullStreams) {
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
    let result: unknown = null;
    switch (message.method) {
      case "workspace/workspaceFolders":
        result = [];
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

function startServer(args: string[] = []) {
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

  return { child, client: new LspClient(child) };
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

async function initializeClient(client: LspClient) {
  const response = await client.request("initialize", {
    processId: null,
    rootUri: null,
    capabilities: {},
    workspaceFolders: null,
  });
  client.notify("initialized");
  return response;
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
