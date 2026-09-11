// Exercise the artifact users install, without access to development dependencies.
const assert = require("node:assert/strict");
const { execFileSync, spawn } = require("node:child_process");
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function main() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "css-lsp-package-"));
  const project = path.resolve(__dirname, "..");
  let child;
  try {
    const packed = JSON.parse(
      execFileSync("npm", ["pack", "--json", "--pack-destination", directory], {
        cwd: project,
        encoding: "utf8",
      }),
    );
    // npm 12 keys this result by package name; older npm versions return an array.
    const artifact = Array.isArray(packed)
      ? packed[0]
      : Object.values(packed)[0];
    execFileSync(
      "npm",
      [
        "install",
        "--prefix",
        directory,
        "--omit=dev",
        "--ignore-scripts",
        "--engine-strict",
        "--no-audit",
        "--no-fund",
        path.join(directory, artifact.filename),
      ],
      { stdio: "pipe" },
    );

    const workspace = path.join(directory, "workspace");
    mkdirSync(workspace);
    writeFileSync(
      path.join(workspace, "astro.config.mjs"),
      'import { defineConfig } from "astro/config";\n' +
        'export default defineConfig({ fonts: [{ cssVariable: "--font-smoke" }] });\n',
    );
    const installed = path.join(directory, "node_modules", "css-variable-lsp");
    const manifest = require(path.join(installed, "package.json"));
    const cli = path.join(installed, manifest.bin["css-variable-lsp"]);
    const env = { ...process.env };
    delete env.NODE_PATH;
    delete env.NODE_OPTIONS;
    child = spawn(
      process.env.CSS_LSP_SMOKE_NODE || process.execPath,
      [cli, "--stdio"],
      {
        cwd: directory,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    let buffer = Buffer.alloc(0);
    let stderr = "";
    let nextId = 0;
    const pending = new Map();
    const queued = [];
    const waiters = [];
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    function send(message) {
      const json = JSON.stringify({ jsonrpc: "2.0", ...message });
      child.stdin.write(
        `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`,
      );
    }
    function onMessage(message) {
      if (message.id !== undefined && message.method) {
        send({ id: message.id, result: null });
      } else if (message.id !== undefined) {
        const callback = pending.get(message.id);
        pending.delete(message.id);
        callback?.(message);
      } else {
        const index = waiters.findIndex((waiter) => waiter.matches(message));
        if (index === -1) queued.push(message);
        else waiters.splice(index, 1)[0].resolve(message);
      }
    }
    child.stdout.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        const end = buffer.indexOf("\r\n\r\n");
        if (end === -1) return;
        const header = buffer.subarray(0, end).toString();
        const length = Number(/Content-Length: (\d+)/i.exec(header)?.[1]);
        assert.ok(Number.isFinite(length), header);
        if (buffer.length < end + 4 + length) return;
        const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length));
        buffer = buffer.subarray(end + 4 + length);
        onMessage(message);
      }
    });
    const timeout = setTimeout(() => {
      console.error(`Packed CLI timed out. ${stderr}`);
      child.kill();
      process.exitCode = 1;
      rmSync(directory, { recursive: true, force: true });
    }, 15000);
    const exited = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve();
        else reject(new Error(`Packed CLI exited with ${code}. ${stderr}`));
      });
    });
    async function request(method, params) {
      const id = ++nextId;
      const response = new Promise((resolve) => pending.set(id, resolve));
      send({ id, method, params });
      const message = await Promise.race([
        response,
        exited.then(() => {
          throw new Error("Packed CLI exited before responding");
        }),
      ]);
      assert.equal(message.error, undefined, JSON.stringify(message.error));
      return message.result;
    }
    function waitForScan() {
      const matches = (message) =>
        message.method === "window/logMessage" &&
        message.params.message.includes("Workspace scan complete");
      if (queued.some(matches)) return Promise.resolve();
      return Promise.race([
        new Promise((resolve) => waiters.push({ matches, resolve })),
        exited,
      ]);
    }

    const initialized = await request("initialize", {
      processId: null,
      capabilities: {},
      rootUri: pathToFileURL(workspace).href,
    });
    assert.ok(initialized.capabilities.completionProvider);
    send({ method: "initialized", params: {} });
    await waitForScan();
    const symbols = await request("workspace/symbol", { query: "font-smoke" });
    assert.ok(symbols.some((symbol) => symbol.name === "--font-smoke"));
    await request("shutdown", null);
    send({ method: "exit" });
    await exited;
    console.log(
      "Packed CLI initialized and indexed Astro fonts with production dependencies.",
    );
  } finally {
    child?.kill();
    rmSync(directory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
