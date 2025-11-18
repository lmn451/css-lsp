# CSS Variable LSP - Current Limitations

This document outlines the current limitations of the CSS Variable Language Server.

## Selector Parsing Limitations

### Not Tracked
- **Selector context**: Variable definitions don't track which CSS selector they belong to
  - Example: Can't distinguish between `:root { --color: red; }` and `div { --color: blue; }`

### Not Calculated
- **CSS Specificity**: No specificity calculation for selectors
  - Can't determine that `#id` beats `.class` beats `div`
  - Can't resolve which value would actually apply in a given context

### Not Supported
- **Complex selectors**:
  - Descendant combinators: `div .class`
  - Child combinators: `div > .class`
  - Sibling combinators: `div + .class`, `div ~ .class`
  - Attribute selectors: `[data-attr="value"]`
  - Pseudo-classes: `:hover`, `:nth-child()`, etc.
  - Pseudo-elements: `::before`, `::after`

- **Media queries**: Variables defined inside `@media` are tracked but context is ignored
- **Container queries**: Variables in `@container` are not context-aware
- **Cascade layers**: `@layer` is not considered

## CSS Cascade Limitations

### Not Resolved
- **Source order**: When two selectors have equal specificity, source order determines winner
  - Current behavior: Shows all definitions without indication of which wins

- **!important**: No tracking of `!important` declarations

- **Inheritance**: No parent-child relationship tracking
  - Can't determine inherited values from parent elements

## Context-Aware Features

### Currently Missing
- **Usage context detection**: When hovering over `var(--name)`, can't determine:
  - Which selector the usage is within
  - Which definition would actually apply
  - What the computed value would be

- **Value resolution**: No fallback value resolution for `var(--name, fallback)`

- **Circular reference detection**: No warning for circular variable references
  - Example: `--a: var(--b); --b: var(--a);`

## HTML/DOM Limitations

### Not Available
- **DOM structure**: No knowledge of HTML element hierarchy
  - Can't determine parent-child relationships
  - Can't resolve inherited values

- **Inline styles**: While we parse `<style>` blocks in HTML, we don't parse `style=""` attributes

- **Computed styles**: No runtime evaluation
  - Can't compute actual color values from functions like `rgb()`, `hsl()`
  - Can't resolve `calc()` expressions

## Scope Limitations

### Current Behavior
- **Multiple definitions**: When a variable is defined multiple times:
  - All definitions are tracked
  - No indication of which is more specific
  - Hover may show arbitrary first match
  - "Find References" shows all definitions correctly

### Shadow DOM
- No support for `:host` or `::slotted()` selectors in Web Components

## File Parsing Limitations

### Edge Cases
- **Malformed CSS**: Parser may fail on invalid syntax
- **Comments in selectors**: May incorrectly parse comments as part of selectors
- **Nested rules** (CSS Nesting Module): Not yet supported
  - Example: `.parent { .child { --var: value; } }`

## Performance Limitations

### Current Constraints
- **Large workspaces**: Scanning thousands of CSS files may be slow on initialization
- **No incremental parsing**: File changes trigger full re-parse of the file
- **No caching**: Workspace scan results are not persisted between VS Code sessions

## Known Issues

### Rename Operation
- Renames all occurrences including in comments/strings (no AST-awareness)
- May incorrectly rename partial matches

### Diagnostics
- Only checks if variable is defined anywhere in workspace
- Doesn't check if variable would be accessible in usage context

---

## Planned Improvements

See [implementation_plan.md](file:///Users/applesucks/.gemini/antigravity/brain/f71f840a-0c2a-4454-b5ee-d86de6d50f47/implementation_plan.md) for upcoming features including:
- Selector context tracking
- Basic CSS specificity calculation
- Context-aware hover information
