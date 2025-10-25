// /api/lib/stripe.js
// Shared Stripe client with pinned API version

const Stripe = require('stripe');
const { requireEnv } = require('./validation');

/**
 * Pinned Stripe API version for consistency across all endpoints
 * Update this when you want to upgrade the Stripe API version
 */
const STRIPE_API_VERSION = '2024-06-20';

/**
 * Initialize Stripe client with pinned API version
 */
function createStripeClient() {
  const secretKey = requireEnv('STRIPE_SECRET_KEY');

  return new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2, // Automatic retries for network errors
    timeout: 30000 // 30 second timeout
  });
}

/**
 * Shared Stripe client instance
 * This ensures consistent API version across all endpoints
 */
let stripeInstance = null;

function getStripeClient() {
  if (!stripeInstance) {
    stripeInstance = createStripeClient();
  }
  return stripeInstance;
}

module.exports = {
  getStripeClient,
  STRIPE_API_VERSION
};
