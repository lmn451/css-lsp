# CSS Variable LSP - Current Limitations

This document outlines the current limitations of the CSS Variable Language Server.

## ✅ What We DO Handle

- **Selector tracking**: Each variable definition tracks its CSS selector (`:root`, `div`, `.class`, etc.)
- **CSS Specificity**: Full specificity calculation for IDs, classes, pseudo-classes, elements
- **Usage context detection**: Tracks which selector a `var(--name)` usage appears in
- **Context-aware hover**: Shows all definitions sorted by specificity with indicator of which applies

## ❌ What We DON'T Handle

### CSS Nesting & Hierarchy

**This is the key limitation you're asking about!**

- **No DOM structure awareness**: We don't know the actual HTML element hierarchy
  - Example: Can't tell if a `div` is inside another `div` or a `section`
  - Can't resolve parent-child relationships

- **No CSS nesting support** (CSS Nesting Module):
  ```css
  .parent {
    --color: red;
    .child {
      --color: blue;  /* We parse this but don't know it's nested */
    }
  }
  ```

- **No descendant/combinator resolution**:
  ```css
  div .class { --color: blue; }      /* We see "div .class" but can't match it to usage context */
  div > .class { --color: green; }   /* Same issue */
  .parent .child { --color: red; }   /* We don't know .child is inside .parent */
  ```

### What This Means

Our current implementation:
1. ✅ Extracts the selector (e.g., `div`, `.class`)
2. ✅ Calculates specificity (e.g., `.class` > `div`)
3. ✅ Shows which would apply based on **exact selector match**
4. ❌ **Does NOT** understand:
   - Selector hierarchies (parent-child relationships)
   - Whether a usage is inside a nested context
   - Complex combinators (`>`, `+`, `~`, space)

### Example of Current Limitation

```css
div { --color: red; }
div .inner { --color: blue; }

.inner { color: var(--color); }  /* Which color applies? */
```

**What we show**: Both `red` and `blue` with specificity scores
**What we CAN'T determine**: Whether `.inner` is actually inside a `div` in the HTML

### Other Limitations

- **Complex selectors**:
  - Attribute selectors: `[data-attr="value"]` ✅ Parsed, ❌ Not matched
  - Pseudo-classes: `:hover`, `:nth-child()` ✅ Parsed, ❌ Context not resolved
  - Pseudo-elements: `::before`, `::after` ✅ Counted in specificity

- **Media queries**: Variables in `@media` are tracked but context ignored
- **Container queries**: Variables in `@container` are not context-aware
- **Cascade layers**: `@layer` is not considered

- **Source order**: When two selectors have equal specificity, we don't track source order

- **!important**: Not tracked or considered

- **Inheritance**: Can't determine if a value is inherited from a parent

### HTML/DOM Limitations

- **Inline styles**: `style=""` attributes are not parsed for variable usages
- **Computed styles**: No runtime evaluation
  - Can't compute `rgb()`, `hsl()`, `calc()` expressions
  - Can't resolve actual computed values

### Scope Limitations

- **Shadow DOM**: No support for `:host` or `::slotted()` in Web Components

### File Parsing Limitations

- **Malformed CSS**: Parser may fail on invalid syntax
- **Comments in selectors**: May incorrectly parse comments as part of selectors

### Performance Limitations

- **Large workspaces**: Scanning thousands of CSS files may be slow
- **No incremental parsing**: File changes trigger full re-parse
- **No caching**: Workspace scan results not persisted between sessions

### Known Issues

- **Rename Operation**: Renames in comments/strings (no full AST-awareness)
- **Diagnostics**: Only checks if variable exists anywhere, not if it's accessible in context

---

## Summary

**You asked: "Should we also care about nesting?"**

**Answer**: YES! Nesting/hierarchy is currently our biggest limitation. We handle:
- ✅ Basic selector matching and specificity
- ❌ NOT actual DOM structure or nested selectors

To fully resolve which value applies, we'd need:
1. HTML DOM structure analysis
2. Selector combinator matching
3. CSS cascade simulation

This is significantly more complex. Current implementation is a good middle ground - shows possibilities with specificity hints, but doesn't claim full cascade resolution.
