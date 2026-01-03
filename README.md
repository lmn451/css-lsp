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
- `--lookup-files "<glob>,<glob>"` (comma-separated list of glob patterns)
- `--lookup-file "<glob>"` (repeatable)
- `--ignore-globs "<glob>,<glob>"` (comma-separated list of ignore globs)
- `--ignore-glob "<glob>"` (repeatable)

Environment variables:

- `CSS_LSP_COLOR_ONLY_VARIABLES=1` (same as `--color-only-variables`)
- `CSS_LSP_LOOKUP_FILES` (comma-separated glob patterns; ignored if CLI lookup flags are provided)
- `CSS_LSP_IGNORE_GLOBS` (comma-separated ignore globs; ignored if CLI ignore flags are provided)
- `CSS_LSP_DEBUG=1` (enable debug logging)

When lookup globs are provided, the default ignore list is disabled unless you set ignore globs explicitly.

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
