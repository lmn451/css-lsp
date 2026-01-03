import * as path from "path";
import { URI } from "vscode-uri";
import { PathDisplayMode } from "./runtimeConfig";

export interface PathDisplayOptions {
  mode: PathDisplayMode;
  abbrevLength: number;
  workspaceFolderPaths: string[];
  rootFolderPath: string | null;
}

export function toNormalizedFsPath(uri: string): string | null {
  try {
    const fsPath = URI.parse(uri).fsPath;
    return fsPath ? path.normalize(fsPath) : null;
  } catch {
    return null;
  }
}

function findBestRelativePath(fsPath: string, roots: string[]): string | null {
  let bestRelative: string | null = null;
  for (const root of roots) {
    const relativePath = path.relative(root, fsPath);
    if (
      !relativePath ||
      relativePath.startsWith("..") ||
      path.isAbsolute(relativePath)
    ) {
      continue;
    }
    if (!bestRelative || relativePath.length < bestRelative.length) {
      bestRelative = relativePath;
    }
  }
  return bestRelative;
}

function abbreviatePath(pathValue: string, abbrevLength: number): string {
  if (abbrevLength <= 0) {
    return pathValue;
  }

  const parts = pathValue.split(path.sep);
  const shortened = parts.map((part, index) => {
    if (index === parts.length - 1) {
      return part;
    }
    if (!part || part.length <= abbrevLength) {
      return part;
    }
    return part.slice(0, abbrevLength);
  });

  return shortened.join(path.sep);
}

export function formatUriForDisplay(
  uri: string,
  options: PathDisplayOptions,
): string {
  const fsPath = toNormalizedFsPath(uri);
  if (!fsPath) {
    return uri;
  }

  const roots = options.workspaceFolderPaths.length
    ? options.workspaceFolderPaths
    : options.rootFolderPath
      ? [options.rootFolderPath]
      : [];

  const relative = findBestRelativePath(fsPath, roots);

  switch (options.mode) {
    case "absolute":
      return fsPath;
    case "abbreviated": {
      const base = relative ?? fsPath;
      return abbreviatePath(base, options.abbrevLength);
    }
    case "relative":
    default:
      return relative ?? fsPath;
  }
}
