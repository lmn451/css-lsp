import { Logger } from "../../src/logger";

/**
 * Silent logger for testing - discards all log output
 */
export class SilentLogger implements Logger {
  debug(_label: string, _payload?: unknown): void {}
  info(_label: string, _payload?: unknown): void {}
  warn(_label: string, _payload?: unknown): void {}
  error(_label: string, _payload?: unknown): void {}
}

export const silentLogger = new SilentLogger();
