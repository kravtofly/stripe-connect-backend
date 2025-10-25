// /api/lib/cors.js
// Centralized CORS handling

const { HTTP_STATUS } = require('./constants');
const { getEnv } = require('./validation');

/**
 * Parse allowed origins from environment
 */
function getAllowedOrigins() {
  const originsStr = getEnv('ALLOWED_ORIGINS', '');
  return originsStr
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Set CORS headers based on allowed origins
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Object} options - CORS options
 * @param {string[]} options.methods - Allowed methods (default: ['GET', 'POST', 'OPTIONS'])
 * @param {string[]} options.headers - Allowed headers (default: ['Content-Type', 'Authorization'])
 * @param {boolean} options.credentials - Allow credentials (default: false)
 */
function setCorsHeaders(req, res, options = {}) {
  const {
    methods = ['GET', 'POST', 'OPTIONS'],
    headers = ['Content-Type', 'Authorization'],
    credentials = false
  } = options;

  const allowedOrigins = getAllowedOrigins();
  const requestOrigin = req.headers.origin;

  // Determine which origin to allow
  let allowOrigin = null;
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    allowOrigin = requestOrigin;
  } else if (allowedOrigins.length > 0) {
    allowOrigin = allowedOrigins[0]; // Default to first allowed origin
  }

  // Set CORS headers
  if (allowOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  }

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', methods.join(', '));
  res.setHeader('Access-Control-Allow-Headers', headers.join(', '));

  if (credentials) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
}

/**
 * Handle CORS preflight request
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Object} options - CORS options
 * @returns {boolean} - True if preflight was handled
 */
function handleCorsPreFlight(req, res, options = {}) {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(req, res, options);
    res.status(HTTP_STATUS.NO_CONTENT).end();
    return true;
  }
  return false;
}

/**
 * Verify origin is allowed
 * @param {Object} req - Request object
 * @returns {boolean} - True if origin is allowed
 */
function isOriginAllowed(req) {
  const allowedOrigins = getAllowedOrigins();

  // If no origins configured, allow all (not recommended for production)
  if (allowedOrigins.length === 0) {
    return true;
  }

  const requestOrigin = req.headers.origin;
  return requestOrigin && allowedOrigins.includes(requestOrigin);
}

/**
 * CORS middleware wrapper
 * @param {Function} handler - The actual endpoint handler
 * @param {Object} corsOptions - CORS options
 * @returns {Function} - Wrapped handler with CORS
 */
function withCors(handler, corsOptions = {}) {
  return async (req, res) => {
    // Handle preflight
    if (handleCorsPreFlight(req, res, corsOptions)) {
      return;
    }

    // Set CORS headers for actual request
    setCorsHeaders(req, res, corsOptions);

    // Call the actual handler
    return handler(req, res);
  };
}

module.exports = {
  getAllowedOrigins,
  setCorsHeaders,
  handleCorsPreFlight,
  isOriginAllowed,
  withCors
};
