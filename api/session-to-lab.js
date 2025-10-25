// /api/session-to-lab.js
const { getStripeClient } = require('./lib/stripe');
const { withCors } = require('./lib/cors');
const { createLogger } = require('./lib/logger');
const { withErrorHandling } = require('./lib/errors');
const { ValidationError, NotFoundError } = require('./lib/errors');
const { HTTP_STATUS, METADATA_KEYS } = require('./lib/constants');
const { isValidStripeSessionId } = require('./lib/validation');

const stripe = getStripeClient();
const logger = createLogger('session-to-lab');

/**
 * GET /api/session-to-lab
 *
 * Looks up a Stripe Checkout Session and returns the associated Flight Lab ID
 * from the session metadata. This is useful for redirecting users to the correct
 * lab page after checkout.
 *
 * Query parameters:
 * - session_id: The Stripe Checkout Session ID
 */
async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(HTTP_STATUS.METHOD_NOT_ALLOWED).json({
      error: 'Method not allowed'
    });
  }

  const sessionId = (req.query.session_id || '').trim();

  if (!sessionId) {
    throw new ValidationError('Missing session_id parameter');
  }

  // Validate session ID format
  if (!isValidStripeSessionId(sessionId)) {
    throw new ValidationError('Invalid session ID format');
  }

  logger.info('Looking up lab ID for session', { sessionId });

  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const metadata = session?.metadata || {};

  // Try multiple metadata key variations for compatibility
  const labId = metadata[METADATA_KEYS.FLIGHT_LAB_ID]
    || metadata[METADATA_KEYS.LAB_ID]
    || metadata[METADATA_KEYS.FLIGHT_LAB_ID_CAMEL]
    || null;

  if (!labId) {
    logger.warn('Lab ID not found in session metadata', {
      sessionId,
      metadataKeys: Object.keys(metadata)
    });
    throw new NotFoundError('Lab ID in session metadata');
  }

  logger.info('Lab ID found', { sessionId, labId });

  return res.status(HTTP_STATUS.OK).json({ labId });
}

module.exports = withErrorHandling(withCors(handler, {
  methods: ['GET', 'OPTIONS']
}));
