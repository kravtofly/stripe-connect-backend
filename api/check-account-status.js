// /api/check-account-status.js
const { getStripeClient } = require('../lib/stripe');
const { withCors } = require('../lib/cors');
const { createLogger } = require('../lib/logger');
const { withErrorHandling } = require('../lib/errors');
const { ValidationError } = require('../lib/errors');
const { HTTP_STATUS } = require('../lib/constants');
const { isValidStripeAccountId } = require('../lib/validation');

const stripe = getStripeClient();
const logger = createLogger('check-account-status');

/**
 * GET /api/check-account-status
 *
 * Retrieves the current status of a Stripe connected account. This endpoint
 * accepts an `account_id` query parameter and returns whether onboarding
 * details have been submitted and whether charges/payouts are enabled.
 */
async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(HTTP_STATUS.METHOD_NOT_ALLOWED).json({
      success: false,
      error: 'Method not allowed'
    });
  }

  const { account_id } = req.query;

  if (!account_id) {
    throw new ValidationError('Missing account_id parameter');
  }

  // Validate Stripe account ID format
  if (!isValidStripeAccountId(account_id)) {
    throw new ValidationError('Invalid Stripe account ID format');
  }

  logger.info('Checking account status', { account_id });

  const account = await stripe.accounts.retrieve(account_id);

  const response = {
    success: true,
    accountId: account_id,
    details_submitted: account.details_submitted,
    charges_enabled: account.charges_enabled,
    payouts_enabled: account.payouts_enabled,
    requirements: account.requirements,
    onboarding_complete: account.details_submitted && account.charges_enabled
  };

  logger.info('Account status retrieved', {
    account_id,
    onboarding_complete: response.onboarding_complete
  });

  return res.status(HTTP_STATUS.OK).json(response);
}

module.exports = withErrorHandling(withCors(handler, {
  methods: ['GET', 'OPTIONS']
}));
