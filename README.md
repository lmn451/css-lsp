# CSS Variable Language Server

A Language Server Protocol (LSP) implementation focused on CSS custom properties (variables). It indexes variables across your workspace and provides completions, hover resolution, and diagnostics.

## Features

- **Context-aware completion** in CSS property values, inside `var(...)`, and in HTML `style=""` attributes, with relevance scoring.
- **Workspace-wide indexing** across `.css`, `.scss`, `.sass`, `.less`, plus HTML `<style>` blocks and inline styles.
- **Cascade-aware hover** that orders definitions by `!important`, specificity, and source order.
- **Go to definition**, **find references**, and **rename** support.
- **Diagnostics** for undefined variables used via `var(--name)`.
- **Color decorations** and a color picker with hex/rgb/hsl presentations.

## Getting Started

### Prerequisites

- Node.js (ES2020-compatible; v16+ recommended)
- npm

### Install / Build

```bash
npm install
npm run compile
```

### Run

```bash
# via local build
node out/server.js --stdio

# or, if installed from npm
css-variable-lsp --stdio
```

### Editor Integration

This is a standalone LSP server. Configure it in any LSP client.

[VS Code extension](https://marketplace.visualstudio.com/items?itemName=miclmn451.css-variables-vscode)

[Zed extension](https://zed.dev/extensions/css-variables)

## Configuration

Command-line flags:

- `--no-color-preview`
- `--color-only-variables` (show colors only on `var(--...)` usages)
- `--path-display=relative|absolute|abbreviated`
- `--path-display-length=N` (only used for `abbreviated`; `0` disables shortening)

Environment variables:

- `CSS_LSP_COLOR_ONLY_VARIABLES=1` (same as `--color-only-variables`)
- `CSS_LSP_DEBUG=1` (enable debug logging)
- `CSS_LSP_PATH_DISPLAY=relative|absolute|abbreviated` (controls completion path formatting)
- `CSS_LSP_PATH_DISPLAY_LENGTH=1` (same as `--path-display-length`)

`abbreviated` mode shortens each directory segment (except the final one) to the configured length, matching fish-style prompt shortening. The default is `relative` with a length of `1`.

## Cascade Awareness (Best-Effort)

Hover and color resolution use CSS cascade rules (specificity, `!important`, source order) but do not model DOM nesting or selector combinators. See `LIMITATIONS.md` for details.

## Project Structure

- `src/` TypeScript source
- `out/` compiled server (npm bin entry)
- `LIMITATIONS.md` known limitations

## Testing

```bash
npm test
```
