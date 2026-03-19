export type PathDisplayMode = "relative" | "absolute" | "abbreviated";
export type UndefinedVarFallbackMode = "warning" | "info" | "off";

export interface RuntimeConfig {
  enableColorProvider: boolean;
  colorOnlyOnVariables: boolean;
  enableColorReplacementDiagnostics: boolean;
  lookupFiles: string[] | undefined;
  ignoreGlobs: string[] | undefined;
  pathDisplayMode: PathDisplayMode;
  pathDisplayAbbrevLength: number;
  undefinedVarFallback: UndefinedVarFallbackMode;
}

// ============================================================================
// Flag Definitions (Declarative)
// ============================================================================
// To add a new flag:
// 1. Add it to RuntimeConfig interface above
// 2. Add a flag definition here
// 3. Add parsing logic in buildRuntimeConfig()
// 4. Add tests

interface BoolFlagDef {
  kind: "bool";
  positive: string;
  negative: string;
  default: boolean;
  envKey?: string;
}

interface OptInFlagDef {
  kind: "optIn";
  flag: string;
  envKey: string;
  default: boolean;
}

interface EnumFlagDef<T extends string> {
  kind: "enum";
  flag: string;
  envKey: string;
  values: readonly T[];
  default: T;
  aliases?: Record<string, T>;
}

interface PathDisplayFlagDef {
  kind: "pathDisplay";
  flag: string;
  envKey: string;
  defaultMode: PathDisplayMode;
  defaultLength: number;
}

interface IntFlagDef {
  kind: "int";
  flag: string;
  envKey: string;
  default: number;
}

interface ListFlagDef {
  kind: "list";
  primaryFlag: string;
  secondaryFlag: string;
  envKey: string;
}

type FlagDef = BoolFlagDef | OptInFlagDef | EnumFlagDef<string> | PathDisplayFlagDef | IntFlagDef | ListFlagDef;

// ============================================================================
// Flag Registry
// ============================================================================

const FLAGS = {
  enableColorProvider: {
    kind: "bool" as const,
    positive: "--color-preview",
    negative: "--no-color-preview",
    default: true,
  },
  colorOnlyOnVariables: {
    kind: "optIn" as const,
    flag: "--color-only-variables",
    envKey: "CSS_LSP_COLOR_ONLY_VARIABLES",
    default: false,
  },
  enableColorReplacementDiagnostics: {
    kind: "bool" as const,
    positive: "--color-replacement-diagnostics",
    negative: "--no-color-replacement-diagnostics",
    default: true,
    envKey: "CSS_LSP_COLOR_REPLACEMENT_DIAGNOSTICS",
  },
  lookupFiles: {
    kind: "list" as const,
    primaryFlag: "--lookup-files",
    secondaryFlag: "--lookup-file",
    envKey: "CSS_LSP_LOOKUP_FILES",
  },
  ignoreGlobs: {
    kind: "list" as const,
    primaryFlag: "--ignore-globs",
    secondaryFlag: "--ignore-glob",
    envKey: "CSS_LSP_IGNORE_GLOBS",
  },
  pathDisplay: {
    kind: "pathDisplay" as const,
    flag: "--path-display",
    envKey: "CSS_LSP_PATH_DISPLAY",
    defaultMode: "relative" as PathDisplayMode,
    defaultLength: 1,
  },
  pathDisplayLength: {
    kind: "int" as const,
    flag: "--path-display-length",
    envKey: "CSS_LSP_PATH_DISPLAY_LENGTH",
    default: 1,
  },
  undefinedVarFallback: {
    kind: "enum" as const,
    flag: "--undefined-var-fallback",
    envKey: "CSS_LSP_UNDEFINED_VAR_FALLBACK",
    values: ["warning", "info", "off"] as const,
    default: "warning" as UndefinedVarFallbackMode,
    aliases: {
      warn: "warning",
      information: "info",
      omit: "off",
      none: "off",
      disable: "off",
      disabled: "off",
    },
  },
} as const satisfies Record<string, FlagDef>;

// ============================================================================
// Parsing Utilities
// ============================================================================

function getArgValue(argv: string[], name: string): string | null {
  const flag = `--${name}`;
  const directIndex = argv.indexOf(flag);
  if (directIndex !== -1) {
    const candidate = argv[directIndex + 1];
    if (candidate && !candidate.startsWith("-")) return candidate;
    return null;
  }
  const prefix = `${flag}=`;
  const withEquals = argv.find((arg) => arg.startsWith(prefix));
  if (withEquals) return withEquals.slice(prefix.length);
  return null;
}

function parseOptionalInt(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function splitList(value: string): string[] {
  return value.split(",").map((e) => e.trim()).filter(Boolean);
}

function parseBool(flag: BoolFlagDef, argv: string[], env: NodeJS.ProcessEnv): boolean {
  if (argv.includes(flag.negative)) return false;
  if (argv.includes(flag.positive)) return true;
  if (flag.envKey) {
    if (env[flag.envKey] === "0") return false;
    if (env[flag.envKey] === "1") return true;
  }
  return flag.default;
}

function parseOptIn(flag: OptInFlagDef, argv: string[], env: NodeJS.ProcessEnv): boolean {
  if (argv.includes(flag.flag)) return true;
  if (env[flag.envKey] === "1") return true;
  return flag.default;
}

function parseEnum<T extends string>(flag: EnumFlagDef<T>, argv: string[], env: NodeJS.ProcessEnv): T {
  const argValue = getArgValue(argv, flag.flag.replace("--", ""));
  const envValue = env[flag.envKey];
  const raw = argValue ?? envValue ?? null;
  if (!raw) return flag.default;

  const normalized = raw.toLowerCase();
  if (flag.aliases) {
    const aliased = flag.aliases[normalized];
    if (aliased && flag.values.includes(aliased)) return aliased;
  }
  const match = flag.values.find((v) => v.toLowerCase() === normalized);
  return match ?? flag.default;
}

function parsePathDisplay(flag: PathDisplayFlagDef, argv: string[], env: NodeJS.ProcessEnv): { mode: PathDisplayMode; combinedLength: number | null } {
  const argValue = getArgValue(argv, flag.flag.replace("--", ""));
  const envValue = env[flag.envKey];
  const raw = argValue ?? envValue ?? null;

  let mode = flag.defaultMode;
  let combinedLength: number | null = null;

  if (raw) {
    const [modePart, lengthPart] = raw.split(":", 2);
    const normalizedMode = modePart?.toLowerCase();
    if (normalizedMode === "relative") mode = "relative";
    else if (normalizedMode === "absolute") mode = "absolute";
    else if (normalizedMode === "abbreviated" || normalizedMode === "abbr" || normalizedMode === "fish") mode = "abbreviated";
    if (lengthPart) {
      const parsed = parseOptionalInt(lengthPart);
      if (parsed !== null) combinedLength = parsed;
    }
  }

  return { mode, combinedLength };
}

function parseInt(flag: IntFlagDef, argv: string[], env: NodeJS.ProcessEnv): number {
  const argValue = getArgValue(argv, flag.flag.replace("--", ""));
  const envValue = env[flag.envKey];
  const raw = argValue ?? envValue ?? null;
  const parsed = parseOptionalInt(raw);
  return parsed ?? flag.default;
}

function parseList(flag: ListFlagDef, argv: string[], env: NodeJS.ProcessEnv): string[] | undefined {
  const cliValues: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === flag.primaryFlag || arg === flag.secondaryFlag) && argv[i + 1] && !argv[i + 1].startsWith("-")) {
      cliValues.push(...splitList(argv[i + 1]));
      i++;
      continue;
    }
    if (arg.startsWith(`${flag.primaryFlag}=`)) {
      cliValues.push(...splitList(arg.slice(flag.primaryFlag.length + 1)));
      continue;
    }
    if (arg.startsWith(`${flag.secondaryFlag}=`)) {
      cliValues.push(...splitList(arg.slice(flag.secondaryFlag.length + 1)));
    }
  }
  if (cliValues.length > 0) return cliValues;
  const envValue = env[flag.envKey];
  if (envValue) {
    const values = splitList(envValue);
    if (values.length > 0) return values;
  }
  return undefined;
}

// ============================================================================
// Config Builder
// ============================================================================

export function buildRuntimeConfig(argv: string[], env: NodeJS.ProcessEnv): RuntimeConfig {
  const pathDisplay = parsePathDisplay(FLAGS.pathDisplay, argv, env);
  const pathDisplayLengthArg = getArgValue(argv, "path-display-length");
  const pathDisplayLengthEnv = env.CSS_LSP_PATH_DISPLAY_LENGTH;
  const abbrevLengthRaw = parseOptionalInt(pathDisplayLengthArg ?? pathDisplayLengthEnv) ?? pathDisplay.combinedLength;
  const pathDisplayAbbrevLength = Math.max(0, abbrevLengthRaw ?? 1);

  return {
    enableColorProvider: parseBool(FLAGS.enableColorProvider, argv, env),
    colorOnlyOnVariables: parseOptIn(FLAGS.colorOnlyOnVariables, argv, env),
    enableColorReplacementDiagnostics: parseBool(FLAGS.enableColorReplacementDiagnostics, argv, env),
    lookupFiles: parseList(FLAGS.lookupFiles, argv, env),
    ignoreGlobs: parseList(FLAGS.ignoreGlobs, argv, env),
    pathDisplayMode: pathDisplay.mode,
    pathDisplayAbbrevLength,
    undefinedVarFallback: parseEnum(FLAGS.undefinedVarFallback, argv, env),
  };
}

// Export for testing
export { FLAGS };
