import { DocumentLinkParams, DocumentLink } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import * as path from "path";

/**
 * Handle document link requests for CSS documents.
 * Returns clickable links for @import and url() references.
 */
export function handleDocumentLinks(
  params: DocumentLinkParams,
  documents: { get(uri: string): TextDocument | undefined },
): DocumentLink[] | null {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const text = document.getText();
  const documentUri = URI.parse(document.uri);
  const documentDir = path.dirname(documentUri.fsPath);
  const links: DocumentLink[] = [];

  // Match @import statements
  // @import "path"; @import url("path"); @import url(path);
  const importRegex =
    /@import\s+(?:url\s*\(\s*)?["']?([^"';\)\s]+)["']?\s*\)?/g;
  let match;

  while ((match = importRegex.exec(text)) !== null) {
    const importPath = match[1];
    if (
      !importPath ||
      importPath.startsWith("http") ||
      importPath.startsWith("//")
    ) {
      continue; // Skip external URLs
    }

    const startPos = document.positionAt(
      match.index + match[0].indexOf(importPath),
    );
    const endPos = document.positionAt(
      match.index + match[0].indexOf(importPath) + importPath.length,
    );

    const resolvedPath = path.resolve(documentDir, importPath);
    const targetUri = URI.file(resolvedPath).toString();

    links.push({
      range: { start: startPos, end: endPos },
      target: targetUri,
    });
  }

  // Match url() references in CSS properties
  // background: url("image.png"); src: url(font.woff);
  const urlRegex = /url\s*\(\s*["']?([^"'\)\s]+)["']?\s*\)/g;

  while ((match = urlRegex.exec(text)) !== null) {
    const urlPath = match[1];
    if (
      !urlPath ||
      urlPath.startsWith("http") ||
      urlPath.startsWith("//") ||
      urlPath.startsWith("data:")
    ) {
      continue; // Skip external URLs and data URIs
    }

    const startPos = document.positionAt(
      match.index + match[0].indexOf(urlPath),
    );
    const endPos = document.positionAt(
      match.index + match[0].indexOf(urlPath) + urlPath.length,
    );

    const resolvedPath = path.resolve(documentDir, urlPath);
    const targetUri = URI.file(resolvedPath).toString();

    links.push({
      range: { start: startPos, end: endPos },
      target: targetUri,
    });
  }

  return links;
}
