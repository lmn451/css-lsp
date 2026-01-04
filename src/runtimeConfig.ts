export type PathDisplayMode = "relative" | "absolute" | "abbreviated";

export interface RuntimeConfig {
  enableColorProvider: boolean;
  colorOnlyOnVariables: boolean;
  lookupFiles: string[] | undefined;
  ignoreGlobs: string[] | undefined;
  pathDisplayMode: PathDisplayMode;
  pathDisplayAbbrevLength: number;
}

function getArgValue(argv: string[], name: string): string | null {
  const flag = `--${name}`;
  const directIndex = argv.indexOf(flag);
  if (directIndex !== -1) {
    const candidate = argv[directIndex + 1];
    if (candidate && !candidate.startsWith("-")) {
      return candidate;
    }
    return null;
  }

  const prefix = `${flag}=`;
  const withEquals = argv.find((arg) => arg.startsWith(prefix));
  if (withEquals) {
    return withEquals.slice(prefix.length);
  }

  return null;
}

function parseOptionalInt(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return parsed;
}

function normalizePathDisplayMode(
  value: string | null | undefined,
): PathDisplayMode | null {
  if (!value) {
    return null;
  }

  switch (value.toLowerCase()) {
    case "relative":
      return "relative";
    case "absolute":
      return "absolute";
    case "abbreviated":
    case "abbr":
    case "fish":
      return "abbreviated";
    default:
      return null;
  }
}

function parsePathDisplay(value: string | null | undefined): {
  mode: PathDisplayMode | null;
  abbrevLength: number | null;
} {
  if (!value) {
    return { mode: null, abbrevLength: null };
  }

  const [modePart, lengthPart] = value.split(":", 2);
  const mode = normalizePathDisplayMode(modePart);
  const abbrevLength = parseOptionalInt(lengthPart);

  return { mode, abbrevLength };
}

function splitLookupList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveLookupFiles(
  argv: string[],
  env: NodeJS.ProcessEnv,
): string[] | undefined {
  const cliFiles: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (
      arg === "--lookup-files" &&
      argv[i + 1] &&
      !argv[i + 1].startsWith("-")
    ) {
      cliFiles.push(...splitLookupList(argv[i + 1]));
      i++;
      continue;
    }
    if (arg.startsWith("--lookup-files=")) {
      cliFiles.push(...splitLookupList(arg.slice("--lookup-files=".length)));
      continue;
    }
    if (
      arg === "--lookup-file" &&
      argv[i + 1] &&
      !argv[i + 1].startsWith("-")
    ) {
      cliFiles.push(argv[i + 1]);
      i++;
      continue;
    }
    if (arg.startsWith("--lookup-file=")) {
      cliFiles.push(arg.slice("--lookup-file=".length));
    }
  }

  if (cliFiles.length > 0) {
    return cliFiles;
  }

  const envValue = env.CSS_LSP_LOOKUP_FILES;
  if (envValue) {
    const envFiles = splitLookupList(envValue);
    if (envFiles.length > 0) {
      return envFiles;
    }
  }

  return undefined;
}

function resolveIgnoreGlobs(
  argv: string[],
  env: NodeJS.ProcessEnv,
): string[] | undefined {
  const cliGlobs: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (
      arg === "--ignore-globs" &&
      argv[i + 1] &&
      !argv[i + 1].startsWith("-")
    ) {
      cliGlobs.push(...splitLookupList(argv[i + 1]));
      i++;
      continue;
    }
    if (arg.startsWith("--ignore-globs=")) {
      cliGlobs.push(...splitLookupList(arg.slice("--ignore-globs=".length)));
      continue;
    }
    if (
      arg === "--ignore-glob" &&
      argv[i + 1] &&
      !argv[i + 1].startsWith("-")
    ) {
      cliGlobs.push(argv[i + 1]);
      i++;
      continue;
    }
    if (arg.startsWith("--ignore-glob=")) {
      cliGlobs.push(arg.slice("--ignore-glob=".length));
    }
  }

  if (cliGlobs.length > 0) {
    return cliGlobs;
  }

  const envValue = env.CSS_LSP_IGNORE_GLOBS;
  if (envValue) {
    const envGlobs = splitLookupList(envValue);
    if (envGlobs.length > 0) {
      return envGlobs;
    }
  }

  return undefined;
}

export function buildRuntimeConfig(
  argv: string[],
  env: NodeJS.ProcessEnv,
): RuntimeConfig {
  const enableColorProvider = !argv.includes("--no-color-preview");
  const colorOnlyOnVariables =
    argv.includes("--color-only-variables") ||
    env.CSS_LSP_COLOR_ONLY_VARIABLES === "1";
  const lookupFiles = resolveLookupFiles(argv, env);
  const ignoreGlobs = resolveIgnoreGlobs(argv, env);
  const pathDisplayArg = getArgValue(argv, "path-display");
  const pathDisplayEnv = env.CSS_LSP_PATH_DISPLAY;
  const parsedPathDisplay = parsePathDisplay(pathDisplayArg ?? pathDisplayEnv);
  const pathDisplayMode: PathDisplayMode =
    parsedPathDisplay.mode ?? "relative";
  const pathDisplayLengthArg = getArgValue(argv, "path-display-length");
  const pathDisplayLengthEnv = env.CSS_LSP_PATH_DISPLAY_LENGTH;
  const abbrevLengthRaw =
    parseOptionalInt(pathDisplayLengthArg ?? pathDisplayLengthEnv) ??
    parsedPathDisplay.abbrevLength;
  const pathDisplayAbbrevLength = Math.max(0, abbrevLengthRaw ?? 1);

  return {
    enableColorProvider,
    colorOnlyOnVariables,
    lookupFiles,
    ignoreGlobs,
    pathDisplayMode,
    pathDisplayAbbrevLength,
  };
}
