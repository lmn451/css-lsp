# Changelog

## 2.0.0

### Breaking changes

- Require Node.js 22 or newer. Version 1.0.22 supported Node.js 20 as well, so applications embedding the server must update their runtime before selecting 2.x. Existing npm ranges such as `^1.0.22` remain on 1.x.
- Follow glob 14 semantics for absolute ignore patterns: a leading `/` anchors at the filesystem root. Use patterns such as `**/dist/**` to ignore matching directories throughout a workspace.

### Dependency and tooling updates

- Upgrade the language-server, CSS, HTML, and workspace-scanning dependencies and refresh the compatible lock graph to address dependency advisories.
- Adopt package export-aware TypeScript module resolution and explicit Node.js types. Keep TypeScript on 6.0.3 because static Astro configuration extraction uses the stable JavaScript compiler API absent from TypeScript 7.
- Verify HTML attribute entity selectors, queries through deeply nested HTML, and source ranges after incremental edits form CRLF line endings.
- Align npm, CI, source configuration, and production package checks. Keep development scratch files and generated build state out of the package.

### Client compatibility

- The CLI remains `css-variable-lsp --stdio`; existing LSP requests and configuration options remain available.
- Editor extensions that embed the server in their extension host need a host running Node.js 22 or newer before upgrading their server dependency to 2.x. An extension's declared editor version must enforce that runtime requirement.