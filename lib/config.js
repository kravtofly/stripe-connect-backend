// /api/lib/config.js
// Environment configuration validation

const { createLogger } = require('./logger');

const logger = createLogger('config');

/**
 * Required environment variables
 */
const REQUIRED_ENV_VARS = [
  'STRIPE_SECRET_KEY',
  'WEBFLOW_TOKEN',
  'WEBFLOW_COLLECTION_ID',
  'COACH_COLLECTION_ID',
  'MEMBERSTACK_SECRET_KEY',
  'PUBLIC_SITE_URL'
];

/**
 * Optional environment variables with defaults
 */
const OPTIONAL_ENV_VARS = {
  ALLOWED_ORIGINS: '',
  PLATFORM_FEE_PCT: '0.18',
  CHECKOUT_SUCCESS_URL: '/flight-lab-success',
  CHECKOUT_CANCEL_URL: '/flight-lab-cancelled',
  DEBUG_SUCCESS_URLS: 'false',
  DEBUG_STRIPE_ERRORS: 'false',
  NODE_ENV: 'production'
};

/**
 * Webhook-specific environment variables
 */
const WEBHOOK_ENV_VARS = [
  'STRIPE_WEBHOOK_SECRET',
  'MAKE_WEBHOOK_URL',
  'MAKE_FORWARDING_SECRET'
];

/**
 * Validate required environment variables
 */
function validateRequiredEnv() {
  const missing = [];

  for (const varName of REQUIRED_ENV_VARS) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  if (missing.length > 0) {
    const error = new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      `Please set these in your Vercel environment settings.`
    );
    logger.error('Environment validation failed', error, { missing });
    throw error;
  }

  logger.info('Required environment variables validated', {
    count: REQUIRED_ENV_VARS.length
  });
}

/**
 * Validate webhook environment variables
 */
function validateWebhookEnv() {
  const missing = [];

  for (const varName of WEBHOOK_ENV_VARS) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  if (missing.length > 0) {
    logger.warn('Webhook environment variables missing', { missing });
    return false;
  }

  return true;
}

/**
 * Validate environment variable formats
 */
function validateEnvFormats() {
  const errors = [];

  // Validate Stripe key format
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (stripeKey && !stripeKey.startsWith('sk_')) {
    errors.push('STRIPE_SECRET_KEY must start with sk_');
  }

  // Validate PUBLIC_SITE_URL is HTTPS in production
  const siteUrl = process.env.PUBLIC_SITE_URL;
  if (siteUrl) {
    try {
      const url = new URL(siteUrl);
      if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
        errors.push('PUBLIC_SITE_URL must use HTTPS in production');
      }
    } catch {
      errors.push('PUBLIC_SITE_URL must be a valid URL');
    }
  }

  // Validate PLATFORM_FEE_PCT is a number
  const feePct = process.env.PLATFORM_FEE_PCT;
  if (feePct && isNaN(parseFloat(feePct))) {
    errors.push('PLATFORM_FEE_PCT must be a valid number');
  }

  // Validate PLATFORM_FEE_CENTS if set
  const feeCents = process.env.PLATFORM_FEE_CENTS;
  if (feeCents && isNaN(parseInt(feeCents))) {
    errors.push('PLATFORM_FEE_CENTS must be a valid integer');
  }

  if (errors.length > 0) {
    const error = new Error(
      `Environment variable format errors:\n${errors.join('\n')}`
    );
    logger.error('Environment format validation failed', error, { errors });
    throw error;
  }

  logger.info('Environment variable formats validated');
}

/**
 * Get configuration object
 */
function getConfig() {
  return {
    // Stripe
    stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    isLiveMode: process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') || false,

    // Webflow
    webflowToken: process.env.WEBFLOW_TOKEN,
    webflowCollectionId: process.env.WEBFLOW_COLLECTION_ID,
    coachCollectionId: process.env.COACH_COLLECTION_ID,
    webflowCmsLocaleId: process.env.WEBFLOW_CMS_LOCALE_ID,

    // Memberstack
    memberstackSecretKey: process.env.MEMBERSTACK_SECRET_KEY,
    memberstackAppId: process.env.MEMBERSTACK_APP_ID,

    // URLs
    publicSiteUrl: process.env.PUBLIC_SITE_URL,
    webflowDomain: process.env.WEBFLOW_DOMAIN || process.env.PUBLIC_SITE_URL,

    // CORS
    allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),

    // Fees
    platformFeePct: parseFloat(process.env.PLATFORM_FEE_PCT || '0.18'),
    platformFeeCents: process.env.PLATFORM_FEE_CENTS
      ? parseInt(process.env.PLATFORM_FEE_CENTS)
      : null,

    // Checkout URLs
    checkoutSuccessUrl: process.env.CHECKOUT_SUCCESS_URL || '/flight-lab-success',
    checkoutCancelUrl: process.env.CHECKOUT_CANCEL_URL || '/flight-lab-cancelled',

    // Webhook
    makeWebhookUrl: process.env.MAKE_WEBHOOK_URL,
    makeForwardingSecret: process.env.MAKE_FORWARDING_SECRET,

    // Debug flags
    debugSuccessUrls: process.env.DEBUG_SUCCESS_URLS === 'true',
    debugStripeErrors: process.env.DEBUG_STRIPE_ERRORS === 'true',

    // ICS calendar
    icsRequireToken: process.env.ICS_REQUIRE_TOKEN === 'true',
    icsHmacSecret: process.env.ICS_HMAC_SECRET,

    // Authentication
    apiSecretKey: process.env.API_SECRET_KEY,

    // Environment
    nodeEnv: process.env.NODE_ENV || 'production',
    isDevelopment: process.env.NODE_ENV === 'development',
    isProduction: process.env.NODE_ENV === 'production'
  };
}

/**
 * Validate all environment configuration
 */
function validateConfig() {
  try {
    validateRequiredEnv();
    validateEnvFormats();

    const config = getConfig();

    logger.info('Configuration validated successfully', {
      isLiveMode: config.isLiveMode,
      environment: config.nodeEnv,
      allowedOriginsCount: config.allowedOrigins.length
    });

    return config;
  } catch (error) {
    logger.error('Configuration validation failed', error);
    throw error;
  }
}

/**
 * Initialize and validate configuration
 * Call this at the start of your application
 */
function initConfig() {
  logger.info('Initializing configuration');
  return validateConfig();
}

module.exports = {
  validateRequiredEnv,
  validateWebhookEnv,
  validateEnvFormats,
  validateConfig,
  getConfig,
  initConfig,
  REQUIRED_ENV_VARS,
  OPTIONAL_ENV_VARS,
  WEBHOOK_ENV_VARS
};
