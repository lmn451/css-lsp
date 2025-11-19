# CSS Variable Language Server

A VS Code extension that provides Language Server Protocol (LSP) support for CSS variables (custom properties).

## Features

- **Cross-file Completion**: Suggests CSS variables defined in other `.css`, `.scss`, `.sass`, `.less` files or HTML `<style>` blocks.
- **Hover Information**: Shows the value of the CSS variable on hover.
- **Go to Definition**: Jumps to the line where the variable is defined.
- **HTML Support**: Parses `<style>` blocks in HTML files for variable definitions.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v16 or higher)
- [Visual Studio Code](https://code.visualstudio.com/)

### Installation

1.  Clone the repository.
2.  Install dependencies for both client and server:
    ```bash
    npm install
    ```

### Running the Extension

1.  Open the project in VS Code.
2.  Press `F5` (or go to **Run and Debug** > **Launch Client**) to start a new VS Code window with the extension loaded.
3.  In the new window (Extension Development Host), open a folder containing CSS or HTML files.
4.  Define variables in one file (e.g., `:root { --my-color: red; }`) and try to use them in another (`color: var(--my-color)`).

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

- `client/`: VS Code extension code (Language Client).
- `server/`: Node.js Language Server code (Analysis logic).
