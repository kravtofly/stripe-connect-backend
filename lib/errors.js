// /api/lib/errors.js
// Error handling utilities

const { HTTP_STATUS } = require('./constants');
const { createLogger } = require('./logger');

const logger = createLogger('errors');

/**
 * Custom application errors
 */
class AppError extends Error {
  constructor(message, statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR, code = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR');
    this.details = details;
  }
}

class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, HTTP_STATUS.UNAUTHORIZED, 'AUTHENTICATION_ERROR');
  }
}

class AuthorizationError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, HTTP_STATUS.FORBIDDEN, 'AUTHORIZATION_ERROR');
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, HTTP_STATUS.NOT_FOUND, 'NOT_FOUND');
  }
}

class ConflictError extends AppError {
  constructor(message) {
    super(message, HTTP_STATUS.CONFLICT, 'CONFLICT');
  }
}

class RateLimitError extends AppError {
  constructor(retryAfter = 60) {
    super('Too many requests', HTTP_STATUS.TOO_MANY_REQUESTS, 'RATE_LIMIT_EXCEEDED');
    this.retryAfter = retryAfter;
  }
}

class ExternalServiceError extends AppError {
  constructor(service, originalError) {
    super(
      `External service error: ${service}`,
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      'EXTERNAL_SERVICE_ERROR'
    );
    this.service = service;
    this.originalError = originalError;
  }
}

/**
 * Send error response
 */
function sendErrorResponse(res, error, context = {}) {
  // Default to internal server error
  let statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR;
  let message = 'Internal server error';
  let code = null;
  let details = null;

  // Handle known error types
  if (error instanceof AppError) {
    statusCode = error.statusCode;
    message = error.message;
    code = error.code;

    if (error instanceof ValidationError) {
      details = error.details;
    }

    if (error instanceof RateLimitError) {
      res.setHeader('Retry-After', error.retryAfter);
    }
  } else if (error?.type?.startsWith('Stripe')) {
    // Stripe errors
    statusCode = HTTP_STATUS.BAD_REQUEST;
    code = error.code || error.type;

    // Only expose Stripe error message in debug mode
    if (process.env.DEBUG_STRIPE_ERRORS === 'true') {
      message = error.message;
    } else {
      message = 'Payment processing error';
    }
  } else if (error?.message) {
    // Generic errors - don't expose details unless in debug mode
    if (process.env.NODE_ENV === 'development') {
      message = error.message;
    }
  }

  // Log the error
  logger.error('Request error', error, {
    statusCode,
    code,
    ...context
  });

  // Send response
  const response = {
    success: false,
    error: message
  };

  if (code) {
    response.code = code;
  }

  if (details) {
    response.details = details;
  }

  return res.status(statusCode).json(response);
}

/**
 * Async error handler wrapper
 * Catches errors in async handlers and sends appropriate response
 */
function asyncHandler(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      sendErrorResponse(res, error, {
        path: req.url,
        method: req.method
      });
    }
  };
}

/**
 * Wrap handler with error handling
 */
function withErrorHandling(handler) {
  return asyncHandler(handler);
}

module.exports = {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ExternalServiceError,
  sendErrorResponse,
  asyncHandler,
  withErrorHandling
};
