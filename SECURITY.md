# Security Documentation

## Security Fixes Applied (v2.0.0)

This document outlines all security improvements made to the Stripe Connect backend.

### Critical Security Fixes

#### 1. Account Takeover Prevention ✅
**File:** `api/complete-onboarding.js`

**Issue:** Anyone with a `coachId` and `accountId` could link any Stripe account to any Memberstack member.

**Fix:** Added member existence verification before updating Stripe account ID:
```javascript
// Verify member exists and caller has permission
const memberExists = await verifyMemberExists(coachId);
if (!memberExists) {
  throw new NotFoundError('Memberstack member');
}
```

**Recommendation:** Implement proper authentication (see Authentication section below).

---

#### 2. CORS Security Bypass ✅
**File:** `api/session-to-lab.js`

**Issue:** Wildcard CORS (`*`) allowed any website to call this endpoint.

**Fix:** Removed wildcard CORS and implemented proper origin validation using `ALLOWED_ORIGINS` environment variable.

---

#### 3. Inconsistent CORS Configuration ✅
**Files:** All endpoints

**Issue:** Some endpoints hardcoded CORS origins while others used environment variables.

**Fix:** All endpoints now use centralized CORS middleware with `ALLOWED_ORIGINS` configuration.

---

#### 4. Webhook Event Loss ✅
**File:** `api/stripe-webhook.js`

**Issue:** Failed Make.com forwards returned 202 (accepted), causing Stripe to stop retrying and events to be lost.

**Fix:** Now returns 500 on failure to trigger Stripe's retry mechanism:
```javascript
if (!resp.ok) {
  // Return 500 to trigger Stripe retry
  return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    received: true,
    forwarded: false,
    error: 'Failed to forward to automation service'
  });
}
```

---

#### 5. Input Validation ✅
**Files:** All endpoints

**Issues:**
- No email validation
- No country code validation
- No Stripe ID format validation
- No URL validation

**Fix:** Comprehensive input validation added:
- Email format validation with RFC 5322 regex
- Country code validation against ISO 3166-1 alpha-2
- Stripe account ID format validation (`acct_*`)
- Stripe session ID format validation (`cs_*`)
- Input sanitization to remove dangerous characters

---

#### 6. Sensitive Error Information Leakage ✅
**Files:** All endpoints

**Issue:** Error messages exposed internal system details.

**Fix:**
- Generic error messages sent to clients
- Detailed errors only logged server-side
- `DEBUG_STRIPE_ERRORS` flag controls error detail exposure
- All errors logged with structured logging

---

### Medium Severity Fixes

#### 7. Stripe API Version Inconsistency ✅
**Issue:** Different endpoints used different Stripe API versions.

**Fix:** All endpoints now use shared Stripe client with pinned API version `2024-06-20`.

---

#### 8. No Rate Limiting ✅
**Issue:** No protection against DDoS or API abuse.

**Fix:** Implemented in-memory rate limiter with token bucket algorithm:
- Default: 100 requests per minute per IP
- Configurable per endpoint
- Returns 429 with `Retry-After` header

---

#### 9. No Environment Variable Validation ✅
**Issue:** Missing env vars caused cryptic runtime errors.

**Fix:** Added startup validation in `api/lib/config.js`:
- Validates all required variables
- Validates format (URLs, API keys, etc.)
- Provides clear error messages

---

#### 10. No Structured Logging ✅
**Issue:** Inconsistent log formats made debugging difficult.

**Fix:** Implemented structured JSON logging:
```json
{
  "timestamp": "2025-01-15T10:30:00.000Z",
  "level": "info",
  "module": "create-checkout",
  "message": "Checkout session created",
  "session_id": "cs_test_123",
  "lab_id": "lab_456"
}
```

---

#### 11. Code Duplication ✅
**Issue:** CORS, Webflow, validation logic duplicated across files.

**Fix:** Created shared utility libraries in `api/lib/`:
- `cors.js` - Centralized CORS handling
- `webflow.js` - Webflow API client with caching
- `validation.js` - Input validation functions
- `stripe.js` - Shared Stripe client
- `logger.js` - Structured logging
- `constants.js` - All magic strings/numbers
- `errors.js` - Error handling utilities
- `auth.js` - Authentication middleware
- `rateLimit.js` - Rate limiting middleware
- `memberstack.js` - Memberstack client wrapper
- `config.js` - Environment configuration

---

### Known Issues & Recommendations

#### 🚨 Critical: Seat Count Race Condition
**File:** `api/create-checkout.js`

**Issue:** Multiple users can simultaneously pass the seat availability check before the count is decremented in Webflow CMS.

**Impact:** Overbooking possible.

**Recommended Solutions:**
1. **Option A:** Implement Stripe inventory management
2. **Option B:** Use optimistic locking with version numbers in Webflow
3. **Option C:** Implement a queue system to serialize checkout requests per lab
4. **Option D:** Handle overbooking in webhook handler with refunds

**Current Mitigation:** Warning comment added to code.

---

## Authentication

### Current State
**No authentication** is currently implemented. Endpoints rely solely on CORS for protection.

### Recommendation: Implement API Key Authentication

We've prepared an authentication middleware in `api/lib/auth.js`. To enable it:

#### Step 1: Generate API Key
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

#### Step 2: Set Environment Variable
```env
API_SECRET_KEY=your_generated_key_here
```

#### Step 3: Update Endpoints
```javascript
const { requireAuth } = require('./lib/auth');

// Wrap handler with authentication
module.exports = withCors(
  requireAuth(
    withRateLimit(
      withErrorHandling(handler),
      { maxRequests: 10, windowMs: 60000 }
    )
  ),
  { methods: ['POST', 'OPTIONS'] }
);
```

#### Step 4: Client Integration
Add header to all API requests:
```javascript
fetch('https://api.example.com/api/start-onboarding', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer your_api_key',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ ... })
});
```

### Alternative: JWT Tokens
For more sophisticated auth (user-specific permissions), consider implementing JWT tokens with Memberstack integration.

---

## Rate Limiting

### Current Configuration
- **Default:** 100 requests/minute per IP
- **start-onboarding:** 10 requests/minute (more restrictive)
- **Algorithm:** Token bucket with in-memory storage

### Limitations
In-memory rate limiting doesn't work well across multiple serverless instances. For production, consider:
- Vercel Edge Config
- Redis-based rate limiting
- Cloudflare rate limiting

### Custom Configuration
```javascript
module.exports = withRateLimit(handler, {
  maxRequests: 50,        // Max requests per window
  windowMs: 60000,        // 1 minute
  keyGenerator: (req) => {
    // Custom key (e.g., by user ID instead of IP)
    return req.headers['x-user-id'] || 'anonymous';
  }
});
```

---

## CORS Configuration

### Setup
Set `ALLOWED_ORIGINS` environment variable:
```env
ALLOWED_ORIGINS=https://www.kravtofly.com,https://staging.kravtofly.com
```

### How It Works
1. Request includes `Origin` header
2. Middleware checks if origin is in allowed list
3. If allowed, sets `Access-Control-Allow-Origin` to that origin
4. If not allowed, uses first origin in list (or denies)

### Best Practices
- Never use wildcard `*` in production
- Use HTTPS origins only
- Include all environments (staging, production, etc.)
- Test CORS configuration thoroughly

---

## Input Validation

### Email Validation
```javascript
const { isValidEmail } = require('./lib/validation');

if (!isValidEmail(email)) {
  throw new ValidationError('Invalid email address');
}
```

### Sanitization
```javascript
const { sanitizeString } = require('./lib/validation');

const cleanName = sanitizeString(userInput, 100); // Max 100 chars
```

### Stripe ID Validation
```javascript
const { isValidStripeAccountId, isValidStripeSessionId } = require('./lib/validation');

if (!isValidStripeAccountId(accountId)) {
  throw new ValidationError('Invalid Stripe account ID format');
}
```

---

## Error Handling

### Custom Error Types
```javascript
const { ValidationError, NotFoundError, ConflictError } = require('./lib/errors');

// Validation errors (400)
throw new ValidationError('Invalid input');

// Not found errors (404)
throw new NotFoundError('Flight Lab');

// Conflict errors (409)
throw new ConflictError('Flight Lab is sold out');
```

### Error Response Format
```json
{
  "success": false,
  "error": "User-friendly error message",
  "code": "ERROR_CODE",
  "details": { /* optional */ }
}
```

---

## Logging Best Practices

### Structured Logging
```javascript
const { createLogger } = require('./lib/logger');
const logger = createLogger('my-module');

logger.info('Operation successful', {
  userId: '123',
  amount: 5000
});

logger.error('Operation failed', error, {
  userId: '123',
  context: 'additional info'
});
```

### Log Levels
- `debug`: Detailed diagnostic information
- `info`: General informational messages
- `warn`: Warning messages
- `error`: Error messages with stack traces

### Security Considerations
- Never log sensitive data (passwords, full credit card numbers, API keys)
- Use sanitized/masked versions for debugging
- Regularly review logs for suspicious activity

---

## Secrets Management

### Environment Variables
All secrets should be stored in Vercel environment variables, never committed to Git.

### Required Secrets
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `WEBFLOW_TOKEN`
- `MEMBERSTACK_SECRET_KEY`
- `MAKE_FORWARDING_SECRET`
- `ICS_HMAC_SECRET`
- `API_SECRET_KEY` (recommended)

### Rotation Policy
Rotate secrets periodically:
- API keys: Every 90 days
- Webhook secrets: Every 180 days
- HMAC secrets: Every 180 days

---

## Dependency Security

### Current Vulnerabilities
Run `npm audit` to check for known vulnerabilities:
```bash
npm audit
```

### Update Policy
- Review dependency updates monthly
- Apply security patches immediately
- Test thoroughly before deploying updates

### Lock File
Always commit `package-lock.json` to ensure consistent dependency versions across deployments.

---

## Monitoring & Alerting

### Recommended Monitoring
1. **Error Tracking:** Sentry, Rollbar, or similar
2. **Log Aggregation:** Logtail, Datadog, or CloudWatch
3. **Uptime Monitoring:** Pingdom, UptimeRobot
4. **Security Scanning:** Snyk, Dependabot

### Key Metrics to Monitor
- Error rate by endpoint
- Response time (p50, p95, p99)
- Rate limit violations
- Authentication failures
- Webhook delivery success rate
- Make.com forward success rate

---

## Incident Response

### If You Suspect a Breach
1. **Immediately** rotate all API keys and secrets
2. Review logs for suspicious activity
3. Check Stripe dashboard for unauthorized transactions
4. Notify affected users if data was compromised
5. Document the incident and lessons learned

### Security Contacts
- Stripe Security: https://stripe.com/security
- Vercel Security: security@vercel.com

---

## Security Checklist

### Before Going to Production
- [ ] Enable `API_SECRET_KEY` authentication
- [ ] Set `NODE_ENV=production`
- [ ] Set `DEBUG_STRIPE_ERRORS=false`
- [ ] Set `DEBUG_SUCCESS_URLS=false`
- [ ] Configure proper `ALLOWED_ORIGINS`
- [ ] Enable Stripe webhook signature verification
- [ ] Rotate all secrets from default values
- [ ] Set up error tracking (Sentry, etc.)
- [ ] Set up log aggregation
- [ ] Set up uptime monitoring
- [ ] Review and test all endpoints
- [ ] Run `npm audit` and fix vulnerabilities
- [ ] Enable Vercel's built-in security features
- [ ] Set up rate limiting with external storage (Redis/Edge Config)
- [ ] Implement seat reservation system to prevent race conditions
- [ ] Configure alerting for critical errors
- [ ] Document incident response procedures
- [ ] Review and restrict Webflow API token permissions
- [ ] Review and restrict Memberstack API token permissions

---

## Additional Resources

- [Stripe Security Best Practices](https://stripe.com/docs/security)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Vercel Security](https://vercel.com/security)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)

---

**Last Updated:** 2025-01-15
**Version:** 2.0.0
