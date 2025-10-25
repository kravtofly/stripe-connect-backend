// /api/lib/memberstack.js
// Memberstack client wrapper

const memberstackAdmin = require('@memberstack/admin');
const { requireEnv } = require('./validation');
const { createLogger } = require('./logger');
const { MEMBERSTACK_FIELDS } = require('./constants');

const logger = createLogger('memberstack');

/**
 * Singleton Memberstack client
 */
let memberstackInstance = null;

/**
 * Get or create Memberstack admin client
 */
function getMemberstackClient() {
  if (!memberstackInstance) {
    const secretKey = requireEnv('MEMBERSTACK_SECRET_KEY');
    memberstackInstance = memberstackAdmin.init(secretKey);
    logger.debug('Memberstack client initialized');
  }
  return memberstackInstance;
}

/**
 * Update member's Stripe account ID
 */
async function updateMemberStripeAccount(memberId, stripeAccountId) {
  const client = getMemberstackClient();

  try {
    await client.members.update({
      id: memberId,
      data: {
        customFields: {
          [MEMBERSTACK_FIELDS.STRIPE_ACCOUNT_ID]: stripeAccountId
        }
      }
    });

    logger.info('Member Stripe account updated', {
      memberId,
      stripeAccountId
    });

    return { success: true };
  } catch (error) {
    logger.error('Failed to update member Stripe account', error, {
      memberId,
      stripeAccountId
    });
    throw error;
  }
}

/**
 * Get member by ID
 */
async function getMember(memberId) {
  const client = getMemberstackClient();

  try {
    const member = await client.members.retrieve({ id: memberId });
    return member;
  } catch (error) {
    logger.error('Failed to retrieve member', error, { memberId });
    throw error;
  }
}

/**
 * Get member's Stripe account ID
 */
async function getMemberStripeAccount(memberId) {
  const member = await getMember(memberId);
  const customFields = member?.data?.customFields || {};
  return customFields[MEMBERSTACK_FIELDS.STRIPE_ACCOUNT_ID] || null;
}

/**
 * Verify member exists
 */
async function verifyMemberExists(memberId) {
  try {
    await getMember(memberId);
    return true;
  } catch (error) {
    if (error.status === 404 || error.message?.includes('not found')) {
      return false;
    }
    throw error;
  }
}

module.exports = {
  getMemberstackClient,
  updateMemberStripeAccount,
  getMember,
  getMemberStripeAccount,
  verifyMemberExists
};
