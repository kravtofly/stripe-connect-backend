// /api/checkout-details.js
const { getStripeClient } = require('./lib/stripe');
const { withCors } = require('./lib/cors');
const { createLogger } = require('./lib/logger');
const { withErrorHandling } = require('./lib/errors');
const { ValidationError, NotFoundError } = require('./lib/errors');
const { HTTP_STATUS, METADATA_KEYS, CHECKOUT_FIELDS, WEBFLOW_FIELDS } = require('./lib/constants');
const { isValidStripeSessionId, requireEnv } = require('./lib/validation');
const { getWebflowItem, getCoachDetails } = require('./lib/webflow');

const stripe = getStripeClient();
const logger = createLogger('checkout-details');

/**
 * Map Webflow lab item to response format
 */
function labFromItem(item) {
  const f = item?.item?.fieldData || item?.fieldData || {};
  return {
    id: item?.item?.id || item?.id || null,
    title: f[WEBFLOW_FIELDS.NAME] || 'Krāv Flight Lab',
    meetUrl: f[WEBFLOW_FIELDS.GOOGLE_MEET_URL] || null,
    sessionsJson: f[WEBFLOW_FIELDS.SESSIONS_JSON] || '[]',
    description: f[WEBFLOW_FIELDS.FULL_DESCRIPTION] || null,
    seatsRemaining: typeof f[WEBFLOW_FIELDS.MAX_PARTICIPANTS] === 'number'
      ? f[WEBFLOW_FIELDS.MAX_PARTICIPANTS] : null,
    coachRefId: f[WEBFLOW_FIELDS.COACH] || null
  };
}

/**
 * GET /api/checkout-details
 *
 * Retrieves checkout session details along with the associated Flight Lab
 * and coach information.
 */
async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(HTTP_STATUS.METHOD_NOT_ALLOWED).json({
      error: 'Method not allowed'
    });
  }

  const sessionId = req.query.session_id;

  if (!sessionId) {
    throw new ValidationError('Missing session_id parameter');
  }

  // Validate session ID format
  if (!isValidStripeSessionId(sessionId)) {
    throw new ValidationError('Invalid session ID format');
  }

  logger.info('Fetching checkout details', { sessionId });

  // Get Checkout Session (on platform account)
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['line_items', 'payment_intent']
  });

  // Get lab ID from metadata
  const labId = session?.metadata?.[METADATA_KEYS.FLIGHT_LAB_ID]
    || session?.metadata?.[METADATA_KEYS.LAB_ID]
    || session?.metadata?.[METADATA_KEYS.FLIGHT_LAB_ID_CAMEL];

  if (!labId) {
    throw new NotFoundError('Flight Lab linked to this session');
  }

  // Pull the Flight Lab CMS item
  const collectionId = requireEnv('WEBFLOW_COLLECTION_ID');
  const labItem = await getWebflowItem(collectionId, labId);
  const lab = labFromItem(labItem);

  // Fetch coach data
  let coach = null;
  if (lab.coachRefId) {
    coach = await getCoachDetails(lab.coachRefId);
  }

  // Parse sessions
  let sessions = [];
  try {
    sessions = JSON.parse(lab.sessionsJson) || [];
  } catch (error) {
    logger.warn('Failed to parse sessions JSON', {
      labId,
      error: error.message
    });
    sessions = [];
  }

  const response = {
    session: {
      id: session.id,
      amount_total: session.amount_total,
      currency: session.currency,
      customer_email: session.customer_details?.email || session.customer_email || null,
      customer_name: session.custom_fields?.find?.(f => f.key === CHECKOUT_FIELDS.STUDENT_NAME)?.text?.value || null
    },
    lab: {
      id: lab.id,
      title: lab.title,
      description: lab.description,
      meetUrl: lab.meetUrl,
      sessions,
      seatsRemaining: lab.seatsRemaining
    },
    coach
  };

  logger.info('Checkout details retrieved', {
    sessionId,
    labId: lab.id,
    hasCoach: !!coach
  });

  return res.status(HTTP_STATUS.OK).json(response);
}

module.exports = withErrorHandling(withCors(handler, {
  methods: ['GET', 'OPTIONS'],
  credentials: true
}));
