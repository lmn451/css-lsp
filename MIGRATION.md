# Dependency Migration Guide

## Overview

This guide covers updating dependencies to their latest compatible versions.

## Current Outdated Dependencies

| Package | Current | Wanted | Latest | Type |
|---------|---------|--------|--------|------|
| @types/node | 24.10.1 | 24.12.0 | 25.5.0 | patch |
| css-tree | 3.1.0 | 3.2.1 | 3.2.1 | minor |
| glob | 12.0.0 | 12.0.0 | 13.0.6 | major |
| node-html-parser | 7.0.1 | 7.1.0 | 7.1.0 | minor |

## Safe Updates (Backward Compatible)

### @types/node 24.10.1 → 24.12.0

**Type:** Patch update

**Changes:** Minor type definitions updates.

**Action:** Update with `pnpm update @types/node`

### css-tree 3.1.0 → 3.2.1

**Type:** Minor update

**New Features (3.2.0):**
- Added `list` option to `parse()` method to control child node format (List vs array)
- Added `onToken` option for advanced token handling
- Added math functions support (`min()`, `max()`, etc.)
- Added `sideEffects: false` for better tree-shaking

**Bug Fixes (3.2.1):**
- Fixed parsing of nested function in definition syntax

**Impact:** All changes are additive. Existing code continues to work.

**Action:** Update with `pnpm update css-tree`

### node-html-parser 7.0.1 → 7.1.0

**Type:** Minor update

**New Features:**
- Added `closeAllOnClosing` option
- Added `preserveTagNesting` option

**Impact:** All changes are additive. Existing code continues to work.

**Action:** Update with `pnpm update node-html-parser`

## Optional Major Update

### glob 12.0.0 → 13.0.6

**Type:** Major update (breaking)

**Breaking Changes:**
- CLI moved to separate package `glob-bin`
- `--shell` option removed

**Impact:** None if used programmatically (API unchanged). CLI users must install `glob-bin` separately.

**Action:** Update only if needed. Current semver range `^12.0.0` will NOT auto-upgrade to v13.

## Update Commands

```bash
# Install pnpm lockfile if missing
pnpm install

# Update all dependencies to wanted versions
pnpm update

# Or update specific packages
pnpm update @types/node css-tree node-html-parser

# For glob v13 (optional, breaking)
pnpm update glob@13
```

## Verification

After updating, run tests to verify:

```bash
pnpm test
```
