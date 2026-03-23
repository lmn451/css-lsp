# CSS Variable LSP - Project Knowledge

**Generated:** 2026-03-23
**Commit:** 5277576
**Branch:** chore/update-deps

## Overview

CSS Language Server for CSS custom properties. Indexes variables across workspace, provides completions, hover, diagnostics, go-to-definition, rename, and color support.

**Stack:** TypeScript + vscode-languageserver + css-tree + node-html-parser

## Structure

```
css-lsp/
├── src/                       # 13 source files
│   ├── server.ts             # LSP entry + all handlers
│   ├── cssVariableManager.ts # Core: variable index, cascade resolution
│   ├── colorProvider.ts      # Color decorations/picker
│   ├── colorService.ts       # Color parsing/formatting
│   ├── colorVariableFeature.ts # Color replacement suggestions
│   ├── completionContext.ts   # Property-aware completions
│   ├── specificity.ts       # CSS cascade ordering
│   ├── domTree.ts           # HTML DOM for selector matching
│   ├── flags.ts             # CLI flag definitions
│   ├── initialize.ts        # LSP capability builder
│   ├── logger.ts            # Structured logging
│   ├── pathDisplay.ts       # Path formatting (relative/absolute)
│   └── runtimeConfig.ts      # Runtime config builder
├── tests/                    # 27 test files (*.test.ts)
├── out/                      # Compiled output
├── docs/                     # Example files
└── package.json              # bin: css-variable-lsp
```

## Where to Look

| Task | Location | Notes |
|------|----------|-------|
| LSP protocol handlers | `src/server.ts` | 900+ lines, all onXxx handlers |
| Variable parsing/indexing | `src/cssVariableManager.ts` | Core state manager |
| Color features | `src/colorService.ts`, `colorProvider.ts`, `colorVariableFeature.ts` | 3-file domain |
| Cascade/hover logic | `src/server.ts:611-635` | Sort by !important > specificity > source order |
| CLI/config | `src/flags.ts` | Declarative flag registry |
| Tests | `tests/*.test.ts` | Node.js native test runner |

## CODE MAP

| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `connection` | const | server.ts:58 | LSP connection instance |
| `CssVariableManager` | class | cssVariableManager.ts:122 | Central state + parsing |
| `onCompletion` | handler | server.ts:489 | Var completions + color suggestions |
| `onHover` | handler | server.ts:564 | Cascade-aware hover |
| `resolveVariableColor` | method | cssVariableManager.ts:975 | Recursive color resolution |
| `calculateSpecificity` | function | specificity.ts:25 | CSS cascade ordering |
| `parseColor` | function | colorService.ts:11 | Hex/rgb/hsl/named parsing |

## Conventions

- **Strict TypeScript** — `strict: true` in tsconfig
- **Named exports only** — No default exports
- **Structured logging** — Logger interface with `debug/info/warn/error`
- **Error handling** — Log via `logger.error()`, never throw in production
- **Tests** — Node.js native `node:test`, `strict as assert` from `node:assert`

## Anti-Patterns (This Project)

- **No forbidden comments** — Project relies on TypeScript strict mode
- **No ESLint** — Empty `.prettierrc` uses defaults only
- **Flat src/ structure** — All 13 files at root level

## Commands

```bash
npm run compile   # tsc -b → out/
npm test          # All 27 test files
npm run perf      # Performance tests (CSS_LSP_PERF=1)
```

## Notes

- `server.ts` is monolithic (900+ lines) — contains ALL LSP handlers
- Color index (`colorIndexDirty` flag) provides O(1) color lookups
- Cascade resolution: !important > inline > specificity > source order
- `cssVariableManager.ts` is the brain — imported by all feature modules
