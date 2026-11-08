import { LOG_LEVELS, type LogLevel } from "./config.js";
import { maskIdentifiers, maskValue } from "./masking.js";

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

export interface LoggerOptions {
  service: string;
  level: LogLevel;
  /** Where finished log lines go. Defaults to stdout (stderr for warn/error). */
  sink?: (line: string, level: Exclude<LogLevel, "silent">) => void;
  now?: () => Date;
}

const defaultSink = (line: string, level: Exclude<LogLevel, "silent">) => {
  if (level === "warn" || level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
};

/**
 * JSON-lines logger. Every message and field passes through maskIdentifiers / maskValue,
 * so identifiers are masked and documents are never written to the log.
 */
export function createLogger(options: LoggerOptions): Logger {
  const sink = options.sink ?? defaultSink;
  const now = options.now ?? (() => new Date());
  const threshold = LOG_LEVELS.indexOf(options.level);

  const write = (level: Exclude<LogLevel, "silent">, msg: string, fields?: LogFields) => {
    if (LOG_LEVELS.indexOf(level) < threshold) return;
    const entry: LogFields = {
      time: now().toISOString(),
      level,
      service: options.service,
      msg: maskIdentifiers(msg),
    };
    if (fields) {
      for (const [key, value] of Object.entries(maskValue(fields) as LogFields)) {
        // Fields can never overwrite the logger's own keys.
        if (!(key in entry)) entry[key] = value;
      }
    }
    sink(JSON.stringify(entry), level);
  };

  return {
    debug: (msg, fields) => write("debug", msg, fields),
    info: (msg, fields) => write("info", msg, fields),
    warn: (msg, fields) => write("warn", msg, fields),
    error: (msg, fields) => write("error", msg, fields),
  };
}
