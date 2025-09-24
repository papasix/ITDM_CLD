// Secure logging utility that respects environment settings
const isDebugMode = import.meta.env.VITE_DEBUG_MODE === 'true';
const logLevel = import.meta.env.VITE_LOG_LEVEL || 'error';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const logLevels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

function shouldLog(level: LogLevel): boolean {
  return isDebugMode && logLevels[level] >= logLevels[logLevel as LogLevel];
}

// Sanitize sensitive data from logs
function sanitizeForLogging(data: any): any {
  if (typeof data !== 'object' || data === null) {
    return data;
  }
  
  const sensitiveKeys = ['password', 'token', 'auth', 'secret', 'key'];
  const sanitized = { ...data };
  
  for (const key in sanitized) {
    if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
      sanitized[key] = '[REDACTED]';
    }
  }
  
  return sanitized;
}

export const logger = {
  debug: (...args: any[]) => {
    if (shouldLog('debug')) {
      console.log('[DEBUG]', ...args.map(sanitizeForLogging));
    }
  },
  
  info: (...args: any[]) => {
    if (shouldLog('info')) {
      console.info('[INFO]', ...args.map(sanitizeForLogging));
    }
  },
  
  warn: (...args: any[]) => {
    if (shouldLog('warn')) {
      console.warn('[WARN]', ...args.map(sanitizeForLogging));
    }
  },
  
  error: (...args: any[]) => {
    if (shouldLog('error')) {
      console.error('[ERROR]', ...args.map(sanitizeForLogging));
    }
  }
};

export default logger;