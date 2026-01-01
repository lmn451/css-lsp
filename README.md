# CSS Variable Language Server

A Language Server Protocol (LSP) implementation for CSS variables (custom properties). This server can be used by any LSP-compatible editor.

## Features

- **Context-Aware Completion**: Intelligently suggests CSS variables only in relevant contexts (property values, inside `var()`, style attributes). No more suggestions in selectors or property names!
- **Cross-file Completion**: Suggests CSS variables defined in other `.css`, `.scss`, `.sass`, `.less` files or HTML `<style>` blocks.
- **Hover Information**: Shows the value of the CSS variable on hover with full cascade resolution.
- **Go to Definition**: Jumps to the line where the variable is defined.
- **Find References**: Shows all usages of a CSS variable across files.
- **Rename Support**: Rename CSS variables across the entire workspace.
- **Color Decorations**: Shows color boxes next to CSS variables with color values (can be disabled with `--no-color-preview`).
- **HTML Support**: Parses `<style>` blocks and inline styles in HTML files.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v16 or higher)
- [Visual Studio Code](https://code.visualstudio.com/)

### Installation

1.  Clone the repository.
2.  Install dependencies:
    ```bash
    npm install
    ```

### Using the Language Server

This is a standalone LSP server. To use it, you'll need to integrate it with an LSP client (e.g., a VSCode extension). See the `../css-variable-vscode` project for a VSCode extension that uses this server.

#### Command-Line Options

- `--no-color-preview`: Disable color decorations (color boxes) entirely.
- `--color-only-variables`: Show color boxes only next to CSS variable definitions (like `--my-color: #f00`), not on usages (like `var(--my-color)`). This matches the native editor behavior where color boxes appear on the actual color values.

**Environment Variables:**
- `CSS_LSP_COLOR_ONLY_VARIABLES=1`: Same as `--color-only-variables` flag.

Examples:
```bash
# Disable all color boxes
css-variable-lsp --no-color-preview

# Show colors only on variable definitions (recommended)
css-variable-lsp --color-only-variables

# Or using environment variable
CSS_LSP_COLOR_ONLY_VARIABLES=1 css-variable-lsp
```

### Running Tests

To run all tests in the repository:

```bash
# From the root directory
npm test

# Or from the server directory
cd server
npm run test:all
```

Individual test suites:
```bash
cd server
npm test              # Core functionality tests
npx ts-node src/easyWins.test.ts  # Easy wins features
```

## New Features

### ✨ **Context-Specific Resolution**
The LSP now understands CSS specificity and shows which variable value would actually apply:
- Tracks CSS selectors for each definition
- Calculates full CSS specificity
- Considers `!important` declarations
- Respects source order for equal specificity
- Parses inline `style=""` attributes

### Hover Example
When you hover over a CSS variable, you'll see:
```
### CSS Variable: `--primary-color`

**Definitions** (CSS cascade order):

1. `green` from `.special` (0,1,0) !important ✓ Wins (!important)
2. `blue` from `div` (0,0,1) _(overridden by !important)_
3. `red` from `:root` (0,1,0) _(lower specificity)_

_Context: `div`_
```

## Project Structure

- `server/`: Node.js Language Server implementation (CSS variable analysis logic).
