// /api/lib/validation.js
// Input validation utilities

const { HTTP_STATUS } = require('./constants');

/**
 * Email validation regex (RFC 5322 simplified)
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * ISO 3166-1 alpha-2 country codes (common ones)
 */
const VALID_COUNTRY_CODES = new Set([
  'US', 'CA', 'GB', 'AU', 'NZ', 'IE', 'DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'CH',
  'AT', 'DK', 'SE', 'NO', 'FI', 'PL', 'PT', 'CZ', 'RO', 'GR', 'HU', 'BG', 'HR',
  'SK', 'SI', 'LT', 'LV', 'EE', 'CY', 'MT', 'LU', 'JP', 'SG', 'HK', 'IN', 'BR',
  'MX', 'AR', 'CL', 'CO', 'PE', 'IL', 'AE', 'SA', 'ZA', 'KR', 'MY', 'TH', 'PH'
]);

/**
 * Stripe account ID format
 */
const STRIPE_ACCOUNT_ID_REGEX = /^acct_[A-Za-z0-9]{16,}$/;

/**
 * Stripe session ID format
 */
const STRIPE_SESSION_ID_REGEX = /^cs_[A-Za-z0-9_]+$/;

/**
 * Validate email address
 */
function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_REGEX.test(email.trim());
}

/**
 * Validate country code
 */
function isValidCountryCode(code) {
  return typeof code === 'string' && VALID_COUNTRY_CODES.has(code.toUpperCase());
}

/**
 * Validate Stripe account ID
 */
function isValidStripeAccountId(accountId) {
  return typeof accountId === 'string' && STRIPE_ACCOUNT_ID_REGEX.test(accountId);
}

/**
 * Validate Stripe session ID
 */
function isValidStripeSessionId(sessionId) {
  return typeof sessionId === 'string' && STRIPE_SESSION_ID_REGEX.test(sessionId);
}

/**
 * Validate URL
 */
function isValidUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validate required fields in request body
 */
function validateRequiredFields(body, requiredFields) {
  const missing = [];
  for (const field of requiredFields) {
    if (!body[field] || (typeof body[field] === 'string' && !body[field].trim())) {
      missing.push(field);
    }
  }
  return missing;
}

/**
 * Sanitize string input (remove dangerous characters)
 */
function sanitizeString(input, maxLength = 255) {
  if (typeof input !== 'string') return '';

  return input
    .trim()
    .slice(0, maxLength)
    // Remove control characters except newlines and tabs
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Validate and sanitize name
 */
function validateName(name) {
  if (typeof name !== 'string' || !name.trim()) {
    return { valid: false, error: 'Name must be a non-empty string' };
  }

  const sanitized = sanitizeString(name, 100);
  if (sanitized.length < 1) {
    return { valid: false, error: 'Name cannot be empty after sanitization' };
  }

  return { valid: true, value: sanitized };
}

/**
 * Create validation error response
 */
function createValidationError(errors) {
  return {
    statusCode: HTTP_STATUS.BAD_REQUEST,
    body: {
      success: false,
      error: 'Validation failed',
      details: errors
    }
  };
}

/**
 * Validate environment variable
 */
function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Validate optional environment variable with default
 */
function getEnv(name, defaultValue) {
  return process.env[name] || defaultValue;
}

module.exports = {
  isValidEmail,
  isValidCountryCode,
  isValidStripeAccountId,
  isValidStripeSessionId,
  isValidUrl,
  validateRequiredFields,
  sanitizeString,
  validateName,
  createValidationError,
  requireEnv,
  getEnv,
  VALID_COUNTRY_CODES
};
