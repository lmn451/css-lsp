# CSS Variable Language Server

A Language Server Protocol (LSP) implementation focused on CSS custom properties (variables). It indexes variables across your workspace and provides completions, hover resolution, and diagnostics.

## Features

- **Context-aware completion** after `var(` in CSS files, HTML `<style>` blocks/`style=""` attributes, and JS/TS string literals, with relevance scoring.
- **Workspace-wide indexing** across `.css`, `.scss`, `.sass`, `.less`, plus HTML `<style>` blocks and inline styles.
- **Astro font variables** from static `fonts[].cssVariable` and legacy `experimental.fonts[].cssVariable` declarations in `astro.config.js`, `.mjs`, `.cjs`, `.ts`, `.mts`, and `.cts`. Config files are parsed without executing them; dynamic values are ignored.
- **Cascade-aware hover** that orders definitions by `!important`, specificity, and source order.
- **Go to definition**, **find references**, and **rename** support.
- **Diagnostics** for undefined variables used via `var(--name)`.
- **Color decorations** and a color picker with hex/rgb/hsl presentations, including named colors in custom property values and resolved `var(--...)` usages.

## Getting Started

### Prerequisites

- Node.js 20.x or 22+ (`20 || >=22`, matching the production dependencies). The server targets ES2023. CI checks Node 20.0.0 and the latest releases of majors 20, 22, 23, 24, 25, and 26.
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
- `--ignore-globs "<glob>,<glob>"` (comma-separated list of glob patterns)
- `--ignore-glob "<glob>"` (repeatable)
- `--path-display=relative|absolute|abbreviated`
- `--path-display-length=N` (only used for `abbreviated`; `0` disables shortening)
- `--undefined-var-fallback=warning|info|off` (controls diagnostics for undefined vars when a `var()` fallback exists)

Environment variables:

- `CSS_LSP_COLOR_ONLY_VARIABLES=1` (same as `--color-only-variables`)
- `CSS_LSP_LOOKUP_FILES` (comma-separated glob patterns; ignored if CLI lookup flags are provided)
- `CSS_LSP_IGNORE_GLOBS` (comma-separated glob patterns; ignored if CLI ignore flags are provided)
- `CSS_LSP_DEBUG=1` (enable debug logging)
- `CSS_LSP_PATH_DISPLAY=relative|absolute|abbreviated`
- `CSS_LSP_PATH_DISPLAY_LENGTH=1` (same as `--path-display-length`)
- `CSS_LSP_UNDEFINED_VAR_FALLBACK=warning|info|off`

Defaults:

- `--path-display`: `relative`
- `--path-display-length`: `1`
- `--undefined-var-fallback`: `warning`
- Lookup globs:
  - `**/*.css`
  - `**/*.scss`
  - `**/*.sass`
  - `**/*.less`
  - `**/*.html`
  - `**/*.vue`
  - `**/*.svelte`
  - `**/*.astro`
  - `**/*.ripple`
  - `**/astro.config.{js,mjs,cjs,ts,mts,cts}`
- Ignore globs:
  - `**/node_modules/**`
  - `**/dist/**`
  - `**/out/**`
  - `**/.git/**`

`abbreviated` mode shortens each directory segment (except the final one) to the configured length, matching fish-style prompt shortening. Lookup/ignore globs accept standard glob patterns (including brace expansions like `**/*.{css,scss}`). Ignore globs replace the defaults when provided (include any defaults you still want to keep).

Astro config discovery remains enabled with custom lookup globs and uses the same ignore globs. Font variable definitions navigate to the configuration string literal and refresh when the configuration changes or is deleted.

### Completion Path Examples

Assume a variable is defined in `/Users/you/project/src/styles/theme.css` and your workspace root is `/Users/you/project`.

- `--path-display=relative` (default):
  - `Defined in src/styles/theme.css`
- `--path-display=absolute`:
  - `Defined in /Users/you/project/src/styles/theme.css`
- `--path-display=abbreviated --path-display-length=1`:
  - `Defined in s/s/theme.css`
- `--path-display=abbreviated --path-display-length=2`:
  - `Defined in sr/st/theme.css`
- `--path-display=abbreviated --path-display-length=0` (no shortening):
  - `Defined in src/styles/theme.css`

## Cascade Awareness (Best-Effort)

Hover and color resolution use CSS cascade rules (specificity, `!important`, source order) but do not model DOM nesting or selector combinators. See `LIMITATIONS.md` for details.

## Project Structure

- `src/` TypeScript source
- `out/` compiled server (npm bin entry)
- `LIMITATIONS.md` known limitations

## Testing

```bash
npm test
npm run test:package # Install the packed CLI with production dependencies and exercise LSP initialization
```
