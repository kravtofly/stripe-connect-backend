// /api/lib/constants.js
// Centralized constants to avoid magic strings

module.exports = {
  // Stripe field names
  STRIPE_FIELD_NAMES: {
    COACH_STRIPE_ACCOUNT_ID: 'coach-stripe-account-id',
    STRIPE_ACCOUNT_ID: 'stripe-account-id',
    COACH_STRIPE_ACCOUNT_ID_UNDERSCORE: 'coach_stripe_account_id',
    STRIPE_ACCOUNT_ID_UNDERSCORE: 'stripe_account_id'
  },

  // Metadata keys
  METADATA_KEYS: {
    KIND: 'kind',
    FLIGHT_LAB_ID: 'flight_lab_id',
    COACH_CONNECT_ID: 'coach_connect_id',
    LAB_TITLE: 'lab_title',
    LAB_ID: 'lab_id',
    FLIGHT_LAB_ID_CAMEL: 'flightLabId'
  },

  // Memberstack custom fields
  MEMBERSTACK_FIELDS: {
    STRIPE_ACCOUNT_ID: 'stripe-account-id'
  },

  // Webflow field names
  WEBFLOW_FIELDS: {
    NAME: 'name',
    PRICE_ID: 'price_id',
    TOTAL_PRICE: 'total-price-per-student-per-flight-lab',
    MAX_PARTICIPANTS: 'maximum-number-of-participants',
    COACH: 'coach',
    SUCCESS_URL: 'success_url',
    CANCEL_URL: 'cancel_url',
    GOOGLE_MEET_URL: 'google-meet-url',
    LAB_URL: 'lab-url',
    SESSIONS_JSON: 'sessions-json',
    FULL_DESCRIPTION: 'full-description',
    EMAIL_FIELD: 'email-field',
    INSTAGRAM_PROFILE: 'instagram-profile',
    FACEBOOK_PROFILE: 'facebook-profile',
    PROFILE_PIC: 'profile-pic'
  },

  // Checkout session custom fields
  CHECKOUT_FIELDS: {
    STUDENT_NAME: 'student_name'
  },

  // Default values
  DEFAULTS: {
    COUNTRY: 'US',
    PLATFORM_FEE_PCT: 0.18,
    SUCCESS_URL: '/flight-lab-success',
    CANCEL_URL: '/flight-lab-cancelled',
    LAB_NAME: 'Krāv Flight Lab',
    PAYOUT_INTERVAL: 'weekly',
    PAYOUT_ANCHOR: 'friday'
  },

  // API limits
  LIMITS: {
    WEBFLOW_MAX_OFFSET: 2000,
    WEBFLOW_PAGE_SIZE: 100,
    MAX_RETRY_ATTEMPTS: 3
  },

  // HTTP status codes
  HTTP_STATUS: {
    OK: 200,
    CREATED: 201,
    ACCEPTED: 202,
    NO_CONTENT: 204,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    METHOD_NOT_ALLOWED: 405,
    CONFLICT: 409,
    UNSUPPORTED_MEDIA_TYPE: 415,
    TOO_MANY_REQUESTS: 429,
    INTERNAL_SERVER_ERROR: 500,
    SERVICE_UNAVAILABLE: 503
  },

  // Stripe events
  STRIPE_EVENTS: {
    CHECKOUT_SESSION_COMPLETED: 'checkout.session.completed'
  },

  // Business types
  STRIPE_BUSINESS_TYPE: {
    INDIVIDUAL: 'individual'
  },

  // Account types
  STRIPE_ACCOUNT_TYPE: {
    EXPRESS: 'express'
  },

  // Capabilities
  STRIPE_CAPABILITIES: {
    CARD_PAYMENTS: 'card_payments',
    TRANSFERS: 'transfers'
  },

  // Account link types
  STRIPE_ACCOUNT_LINK_TYPE: {
    ONBOARDING: 'account_onboarding'
  },

  // Checkout modes
  STRIPE_CHECKOUT_MODE: {
    PAYMENT: 'payment'
  },

  // Currency
  CURRENCY: {
    USD: 'usd'
  }
};
