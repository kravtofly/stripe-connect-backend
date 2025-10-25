// /api/lib/rateLimit.js
// Simple in-memory rate limiting

const { HTTP_STATUS } = require('./constants');
const { createLogger } = require('./logger');

const logger = createLogger('rateLimit');

/**
 * Simple in-memory rate limiter using token bucket algorithm
 */
class RateLimiter {
  constructor(options = {}) {
    this.maxRequests = options.maxRequests || 100; // Max requests per window
    this.windowMs = options.windowMs || 60000; // Time window in ms (default 1 minute)
    this.keyGenerator = options.keyGenerator || this.defaultKeyGenerator;
    this.buckets = new Map();

    // Clean up old buckets periodically
    this.cleanupInterval = setInterval(() => this.cleanup(), this.windowMs);
  }

  defaultKeyGenerator(req) {
    // Use IP address as default key
    return req.headers['x-forwarded-for'] ||
           req.headers['x-real-ip'] ||
           req.connection?.remoteAddress ||
           'unknown';
  }

  getBucket(key) {
    if (!this.buckets.has(key)) {
      this.buckets.set(key, {
        tokens: this.maxRequests,
        lastRefill: Date.now()
      });
    }
    return this.buckets.get(key);
  }

  refillBucket(bucket) {
    const now = Date.now();
    const timePassed = now - bucket.lastRefill;

    if (timePassed >= this.windowMs) {
      bucket.tokens = this.maxRequests;
      bucket.lastRefill = now;
    }
  }

  tryConsume(key) {
    const bucket = this.getBucket(key);
    this.refillBucket(bucket);

    if (bucket.tokens > 0) {
      bucket.tokens--;
      return {
        allowed: true,
        remaining: bucket.tokens,
        resetAt: bucket.lastRefill + this.windowMs
      };
    }

    return {
      allowed: false,
      remaining: 0,
      resetAt: bucket.lastRefill + this.windowMs,
      retryAfter: Math.ceil((bucket.lastRefill + this.windowMs - Date.now()) / 1000)
    };
  }

  cleanup() {
    const now = Date.now();
    for (const [key, bucket] of this.buckets.entries()) {
      if (now - bucket.lastRefill > this.windowMs * 2) {
        this.buckets.delete(key);
      }
    }
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.buckets.clear();
  }
}

/**
 * Create rate limiting middleware
 *
 * @param {Object} options - Rate limit options
 * @param {number} options.maxRequests - Max requests per window (default: 100)
 * @param {number} options.windowMs - Time window in ms (default: 60000 = 1 minute)
 * @param {Function} options.keyGenerator - Function to generate key from request
 * @param {boolean} options.skipFailedRequests - Don't count failed requests (default: false)
 * @returns {Function} - Middleware function
 */
function createRateLimiter(options = {}) {
  const limiter = new RateLimiter(options);

  return async (req, res, next) => {
    // Skip rate limiting for OPTIONS (CORS preflight)
    if (req.method === 'OPTIONS') {
      if (next) return next();
      return;
    }

    const key = limiter.keyGenerator(req);
    const result = limiter.tryConsume(key);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', limiter.maxRequests);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', new Date(result.resetAt).toISOString());

    if (!result.allowed) {
      res.setHeader('Retry-After', result.retryAfter);

      logger.warn('Rate limit exceeded', {
        key,
        ip: req.headers['x-forwarded-for'] || req.connection?.remoteAddress,
        path: req.url,
        method: req.method
      });

      return res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
        success: false,
        error: 'Too many requests',
        retryAfter: result.retryAfter
      });
    }

    // Request allowed
    if (next) {
      return next();
    }
  };
}

/**
 * Wrapper to apply rate limiting to an endpoint handler
 */
function withRateLimit(handler, options = {}) {
  const limiter = createRateLimiter(options);

  return async (req, res) => {
    // Apply rate limiting
    const rateLimitResult = await limiter(req, res);

    // If rate limit returned a response, stop here
    if (res.writableEnded) {
      return;
    }

    // Otherwise, continue to handler
    return handler(req, res);
  };
}

module.exports = {
  RateLimiter,
  createRateLimiter,
  withRateLimit
};
