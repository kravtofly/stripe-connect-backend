// /api/debug-coach.js
// Debug endpoint to inspect coach Stripe account ID field mappings
const { withCors } = require('./lib/cors');
const { createLogger } = require('./lib/logger');
const { withErrorHandling } = require('./lib/errors');
const { ValidationError, NotFoundError } = require('./lib/errors');
const { HTTP_STATUS, WEBFLOW_FIELDS, STRIPE_FIELD_NAMES } = require('./lib/constants');
const { requireEnv } = require('./lib/validation');
const { getWebflowItem, getCoachStripeAccountId } = require('./lib/webflow');

const logger = createLogger('debug-coach');

/**
 * GET /api/debug-coach
 *
 * Debug endpoint to inspect a coach's Stripe account ID configuration.
 * Useful for verifying field mappings and troubleshooting Connect issues.
 *
 * Query parameters:
 * - id or coachId: The Webflow coach item ID
 * - labId: Optional - fetch coach from a lab's coach reference
 */
async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(HTTP_STATUS.METHOD_NOT_ALLOWED).json({
      error: 'Method not allowed'
    });
  }

  const coachCollectionId = requireEnv('COACH_COLLECTION_ID');
  const labCollectionId = requireEnv('WEBFLOW_COLLECTION_ID');

  const { id, coachId, labId } = req.query;
  let resolvedCoachId = id || coachId || null;

  // If labId provided, fetch coach reference from lab
  if (!resolvedCoachId && labId) {
    logger.info('Fetching coach from lab', { labId });

    const lab = await getWebflowItem(labCollectionId, labId);
    const f = lab?.item?.fieldData || lab?.fieldData || {};
    resolvedCoachId = f[WEBFLOW_FIELDS.COACH] || null;

    if (!resolvedCoachId) {
      logger.warn('Lab found but no coach reference', { labId });
      return res.status(HTTP_STATUS.NOT_FOUND).json({
        error: 'Lab found, but no coach reference on this lab',
        labId,
        labFieldKeys: Object.keys(f)
      });
    }
  }

  if (!resolvedCoachId) {
    throw new ValidationError('Pass ?id=<coachItemId> or ?labId=<flightLabItemId>');
  }

  logger.info('Fetching coach details', { coachId: resolvedCoachId });

  const coach = await getWebflowItem(coachCollectionId, resolvedCoachId);
  const f = coach?.item?.fieldData || coach?.fieldData || {};

  // Check all possible field name variations
  const candidates = {
    [STRIPE_FIELD_NAMES.COACH_STRIPE_ACCOUNT_ID]: f[STRIPE_FIELD_NAMES.COACH_STRIPE_ACCOUNT_ID],
    [STRIPE_FIELD_NAMES.STRIPE_ACCOUNT_ID]: f[STRIPE_FIELD_NAMES.STRIPE_ACCOUNT_ID],
    [STRIPE_FIELD_NAMES.COACH_STRIPE_ACCOUNT_ID_UNDERSCORE]: f[STRIPE_FIELD_NAMES.COACH_STRIPE_ACCOUNT_ID_UNDERSCORE],
    [STRIPE_FIELD_NAMES.STRIPE_ACCOUNT_ID_UNDERSCORE]: f[STRIPE_FIELD_NAMES.STRIPE_ACCOUNT_ID_UNDERSCORE],
  };

  const found = Object.values(candidates).find(v => typeof v === 'string' && v.startsWith('acct_')) || null;

  const response = {
    coachItemId: coach?.item?.id || coach?.id,
    candidates,
    found,
    fieldKeys: Object.keys(f),
    name: f[WEBFLOW_FIELDS.NAME] || null,
    email: f[WEBFLOW_FIELDS.EMAIL_FIELD] || null,
  };

  logger.info('Coach debug info retrieved', {
    coachId: resolvedCoachId,
    hasStripeAccount: !!found
  });

  return res.status(HTTP_STATUS.OK).json(response);
}

module.exports = withErrorHandling(withCors(handler, {
  methods: ['GET', 'OPTIONS']
}));
