// /api/lib/auth.js
// Authentication middleware

const { HTTP_STATUS } = require('./constants');
const { createLogger } = require('./logger');
const crypto = require('crypto');

const logger = createLogger('auth');

/**
 * Verify API key from Authorization header
 * Format: "Bearer <api-key>"
 */
function verifyApiKey(req) {
  // ✅ Check if API_SECRET_KEY is configured FIRST (before checking headers)
  const validApiKey = process.env.API_SECRET_KEY;
  
  // If no API key is configured, skip authentication (backward compatibility)
  if (!validApiKey) {
    logger.info('API_SECRET_KEY not configured - authentication disabled');
    return { valid: true };
  }

  // API key is configured, now check for Authorization header
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return { valid: false, error: 'Missing Authorization header' };
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return { valid: false, error: 'Invalid Authorization header format. Expected: Bearer <token>' };
  }

  const providedKey = parts[1];

  // Timing-safe comparison to prevent timing attacks
  try {
    const validKeyBuffer = Buffer.from(validApiKey);
    const providedKeyBuffer = Buffer.from(providedKey);

    // Only compare if lengths match (prevents timing leak)
    if (validKeyBuffer.length !== providedKeyBuffer.length) {
      return { valid: false, error: 'Invalid API key' };
    }

    const isValid = crypto.timingSafeEqual(validKeyBuffer, providedKeyBuffer);

    if (!isValid) {
      logger.warn('Invalid API key attempt', {
        ip: req.headers['x-forwarded-for'] || req.connection?.remoteAddress
      });
      return { valid: false, error: 'Invalid API key' };
    }

    return { valid: true };
  } catch (error) {
    logger.error('API key verification error', error);
    return { valid: false, error: 'Authentication error' };
  }
}

/**
 * Authentication middleware
 * Wraps an endpoint handler with API key authentication
 *
 * @param {Function} handler - The endpoint handler function
 * @param {Object} options - Options
 * @param {boolean} options.required - Whether authentication is required (default: true)
 * @returns {Function} - Wrapped handler
 */
function requireAuth(handler, options = {}) {
  const { required = true } = options;

  return async (req, res) => {
    // Skip authentication for OPTIONS requests (CORS preflight)
    if (req.method === 'OPTIONS') {
      return handler(req, res);
    }

    const authResult = verifyApiKey(req);

    if (!authResult.valid) {
      if (required) {
        logger.warn('Authentication failed', {
          error: authResult.error,
          path: req.url,
          method: req.method
        });

        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          success: false,
          error: authResult.error || 'Authentication required'
        });
      } else {
        // Authentication not required, but log the attempt
        logger.debug('Authentication skipped (not required)', { path: req.url });
      }
    }

    // Authentication successful or not required
    // Attach auth info to request for downstream use
    req.auth = {
      authenticated: authResult.valid
    };

    return handler(req, res);
  };
}

/**
 * Verify webhook signature (for Stripe webhooks)
 */
function verifyWebhookSignature(rawBody, signature, secret) {
  try {
    // This is typically handled by Stripe SDK's constructEvent
    // But we provide this as a general utility
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    // Extract timestamp and signature from Stripe's format
    // Format: t=timestamp,v1=signature
    const elements = signature.split(',');
    let timestamp = null;
    let sig = null;

    for (const element of elements) {
      const [key, value] = element.split('=');
      if (key === 't') timestamp = value;
      if (key === 'v1') sig = value;
    }

    if (!timestamp || !sig) {
      return { valid: false, error: 'Invalid signature format' };
    }

    // Verify signature matches
    const signedPayload = `${timestamp}.${rawBody}`;
    const computedSig = crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(computedSig))) {
      return { valid: false, error: 'Signature verification failed' };
    }

    // Check timestamp to prevent replay attacks (within 5 minutes)
    const currentTime = Math.floor(Date.now() / 1000);
    const timestampAge = currentTime - parseInt(timestamp);

    if (timestampAge > 300) {
      return { valid: false, error: 'Timestamp too old' };
    }

    return { valid: true, timestamp: parseInt(timestamp) };
  } catch (error) {
    logger.error('Webhook signature verification error', error);
    return { valid: false, error: 'Signature verification error' };
  }
}

/**
 * Generate a secure API key
 * Utility function for generating API keys
 */
function generateApiKey(length = 32) {
  return crypto.randomBytes(length).toString('base64url');
}

module.exports = {
  verifyApiKey,
  requireAuth,
  verifyWebhookSignature,
  generateApiKey
};
