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

export { buildRuntimeConfig } from "./flags";
