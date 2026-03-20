export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(label: string, payload?: unknown): void;
  info(label: string, payload?: unknown): void;
  warn(label: string, payload?: unknown): void;
  error(label: string, payload?: unknown): void;
}

function formatMessage(level: LogLevel, label: string, payload?: unknown): string {
  const prefix = `[css-lsp][${level}]`;
  const meta = payload !== undefined ? ` ${JSON.stringify(payload)}` : "";
  return `${prefix} ${label}${meta}`;
}

export function createLogger(envVar = "CSS_LSP_DEBUG"): Logger {
  const isDebug = !!process.env[envVar];

  return {
    debug: (label, payload) => {
      if (isDebug) {
        console.log(formatMessage("debug", label, payload));
      }
    },
    info: (label, payload) => {
      if (isDebug) {
        console.log(formatMessage("info", label, payload));
      }
    },
    warn: (label, payload) => {
      if (isDebug) {
        console.log(formatMessage("warn", label, payload));
      }
    },
    error: (label, payload) => {
      if (payload instanceof Error && payload.stack) {
        console.error(formatMessage("error", label, payload.message));
        console.error(payload.stack);
      } else {
        console.error(formatMessage("error", label, payload));
      }
    },
  };
}
