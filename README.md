# CSS Variable Language Server

A VS Code extension that provides Language Server Protocol (LSP) support for CSS variables (custom properties).

## Features

- **Cross-file Completion**: Suggests CSS variables defined in other `.css` files or HTML `<style>` blocks.
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

To run the unit tests for the Language Server logic:

```bash
npm test
```

## Project Structure

- `client/`: VS Code extension code (Language Client).
- `server/`: Node.js Language Server code (Analysis logic).
