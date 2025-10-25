// /api/lib/logger.js
// Structured logging utility

/**
 * Log levels
 */
const LogLevel = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error'
};

/**
 * Structured logger that outputs JSON
 */
class Logger {
  constructor(context = {}) {
    this.context = context;
  }

  _log(level, message, data = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this.context,
      ...data
    };

    // Use appropriate console method
    const consoleMethod = level === 'error' ? console.error : console.log;
    consoleMethod(JSON.stringify(logEntry));
  }

  debug(message, data) {
    this._log(LogLevel.DEBUG, message, data);
  }

  info(message, data) {
    this._log(LogLevel.INFO, message, data);
  }

  warn(message, data) {
    this._log(LogLevel.WARN, message, data);
  }

  error(message, error, data = {}) {
    const errorData = {
      ...data,
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        code: error.code,
        type: error.type
      } : error
    };
    this._log(LogLevel.ERROR, message, errorData);
  }

  /**
   * Create a child logger with additional context
   */
  child(additionalContext) {
    return new Logger({ ...this.context, ...additionalContext });
  }
}

/**
 * Create a logger instance for a specific module
 */
function createLogger(module) {
  return new Logger({ module });
}

module.exports = {
  Logger,
  createLogger,
  LogLevel
};
