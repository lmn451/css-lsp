# Rust Port Feasibility (css-variable-lsp)

Goal: run the CSS variable LSP as a native Rust binary so the Zed extension does not depend on Node/npm.

## Current architecture (today)
- Zed extension (Rust) installs and launches the npm package `css-variable-lsp`.
- LSP implementation is Node/TypeScript (this repo).
- Parsing:
  - CSS/SCSS/SASS/LESS via `css-tree`.
  - HTML via `node-html-parser` + custom DOM helper.
- Features: completion, hover, definitions, references, rename, diagnostics, colors, workspace scan.

## Feasibility summary
- A full Rust port is feasible, but it is a medium/large rewrite.
- Key work is replacing parser/DOM logic and replicating LSP behaviors/ranges.
- Expect 4-8+ weeks depending on scope and parity requirements.

## Rust building blocks
LSP:
- `tower-lsp` + `lsp-types` for server implementation.

CSS parsing:
- `lightningcss` (high-level parser, values, selectors) OR
- `cssparser` + `selectors` (lower-level, more control).

HTML parsing / DOM:
- `html5ever` + `kuchiki` for DOM tree.
- `scraper` for selector queries (limited) if full matching is not required.

Globbing / filesystem:
- `globset`, `ignore`, or `globwalk` for workspace scans.

Color parsing:
- `csscolorparser` or `palette` for hex/rgb/hsl/named colors.

## Hard parts to match
- Precise range mapping (LSP ranges must match original text offsets).
- CSS selector specificity and cascade ordering (can reuse Rust selectors).
- Inline style parsing: need to parse declaration lists and map offsets in HTML.
- DOM-aware selector matching (if kept): must reconcile selector parsing with DOM library.
- `var()` parsing with fallbacks and nested functions.

## Proposed approach
1. Implement a Rust LSP skeleton with `tower-lsp`.
2. Port workspace indexing + file watching.
3. Implement CSS/HTML parsing for:
   - Variable definitions
   - `var()` usages
   - Inline styles and `<style>` blocks
4. Port cascade/specificity sorting and hover text generation.
5. Port completion + rename + references + diagnostics.
6. Add color provider support and formatting.
7. Validate parity with existing tests (port or duplicate in Rust).

## Packaging for Zed
- Build native binaries per platform (macOS, Windows, Linux).
- Zed extension can ship a prebuilt binary and launch it directly.
- Alternative: use a separate Rust LSP repo and download releases at install time.

## Risks / unknowns
- Selector matching parity (especially complex selectors) may be hard to reproduce.
- HTML parsing offsets are tricky; ensure parser retains byte offsets.
- Windows path handling and encoding differences.

## Recommendation
A Rust port is doable and likely worth it if we want to remove Node/npm. The fastest path is a fresh Rust LSP repo that mirrors the current feature set, then swap the Zed extension to launch that binary instead of `css-variable-lsp`.
