// /api/lib/webflow.js
// Webflow API client with caching and retry logic

const { requireEnv } = require('./validation');
const { createLogger } = require('./logger');
const { WEBFLOW_FIELDS, LIMITS, HTTP_STATUS, DEFAULTS } = require('./constants');

const logger = createLogger('webflow');

/**
 * Simple in-memory cache with TTL
 */
class SimpleCache {
  constructor(ttlMs = 5 * 60 * 1000) { // Default 5 minutes
    this.cache = new Map();
    this.ttlMs = ttlMs;
  }

  set(key, value) {
    this.cache.set(key, {
      value,
      expiry: Date.now() + this.ttlMs
    });
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;

    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }

    return item.value;
  }

  clear() {
    this.cache.clear();
  }

  delete(key) {
    this.cache.delete(key);
  }
}

// Global cache instance
const webflowCache = new SimpleCache(5 * 60 * 1000); // 5 minute TTL

/**
 * Sleep utility for retry backoff
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch from Webflow API with retry logic
 */
async function webflowFetch(url, options = {}) {
  const token = requireEnv('WEBFLOW_TOKEN');
  const maxAttempts = LIMITS.MAX_RETRY_ATTEMPTS;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...options.headers
        }
      });

      if (!response.ok) {
        const text = await response.text();
        const error = new Error(`Webflow API error: ${response.status} ${text}`);
        error.status = response.status;
        error.responseText = text;

        // Don't retry on client errors (except rate limiting)
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw error;
        }

        // Retry on server errors or rate limiting
        if (attempt < maxAttempts) {
          const backoffMs = Math.pow(2, attempt) * 1000; // Exponential backoff
          logger.warn('Webflow API error, retrying', {
            url,
            status: response.status,
            attempt,
            backoffMs
          });
          await sleep(backoffMs);
          continue;
        }

        throw error;
      }

      return response.json();
    } catch (error) {
      // Network errors - retry
      if (attempt < maxAttempts && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT')) {
        const backoffMs = Math.pow(2, attempt) * 1000;
        logger.warn('Network error, retrying', {
          url,
          error: error.message,
          attempt,
          backoffMs
        });
        await sleep(backoffMs);
        continue;
      }

      throw error;
    }
  }
}

/**
 * Get Webflow item by ID with caching
 */
async function getWebflowItem(collectionId, itemId, useCache = true) {
  const cacheKey = `item:${collectionId}:${itemId}`;

  if (useCache) {
    const cached = webflowCache.get(cacheKey);
    if (cached) {
      logger.debug('Webflow cache hit', { collectionId, itemId });
      return cached;
    }
  }

  const url = `https://api.webflow.com/v2/collections/${collectionId}/items/${itemId}`;
  const data = await webflowFetch(url);

  if (useCache) {
    webflowCache.set(cacheKey, data);
  }

  return data;
}

/**
 * List Webflow items with pagination
 */
async function listWebflowItems(collectionId, options = {}) {
  const {
    limit = LIMITS.WEBFLOW_PAGE_SIZE,
    maxItems = 1000,
    filter = null
  } = options;

  const localeId = process.env.WEBFLOW_CMS_LOCALE_ID;
  const localeParam = localeId ? `&cmsLocaleId=${encodeURIComponent(localeId)}` : '';

  const items = [];
  let offset = 0;
  let iterations = 0;
  const maxIterations = Math.ceil(LIMITS.WEBFLOW_MAX_OFFSET / LIMITS.WEBFLOW_PAGE_SIZE);

  while (offset < LIMITS.WEBFLOW_MAX_OFFSET && items.length < maxItems && iterations < maxIterations) {
    iterations++;
    const url = `https://api.webflow.com/v2/collections/${collectionId}/items?limit=${limit}&offset=${offset}${localeParam}`;

    const data = await webflowFetch(url);
    const pageItems = data.items || [];

    // Apply filter if provided
    const filteredItems = filter ? pageItems.filter(filter) : pageItems;
    items.push(...filteredItems);

    // Break if we got fewer items than requested (last page)
    if (pageItems.length < limit) {
      break;
    }

    offset += limit;
  }

  return items;
}

/**
 * Find Webflow item by slug
 */
async function findWebflowItemBySlug(collectionId, slug) {
  const cacheKey = `slug:${collectionId}:${slug}`;

  const cached = webflowCache.get(cacheKey);
  if (cached) {
    logger.debug('Webflow slug cache hit', { collectionId, slug });
    return cached;
  }

  const items = await listWebflowItems(collectionId, {
    filter: item => item.slug === slug,
    maxItems: 1
  });

  const found = items.length > 0 ? items[0] : null;

  if (found) {
    webflowCache.set(cacheKey, found);
  }

  return found;
}

/**
 * Map Webflow item to Lab object
 */
function mapItemToLab(item) {
  const f = item?.item?.fieldData || item?.fieldData || {};
  return {
    id: item?.item?.id || item?.id,
    title: f[WEBFLOW_FIELDS.NAME] || DEFAULTS.LAB_NAME,
    priceId: f[WEBFLOW_FIELDS.PRICE_ID] || null,
    priceCents:
      typeof f[WEBFLOW_FIELDS.TOTAL_PRICE] === 'number'
        ? Math.round(f[WEBFLOW_FIELDS.TOTAL_PRICE] * 100)
        : null,
    seatsRemaining:
      typeof f[WEBFLOW_FIELDS.MAX_PARTICIPANTS] === 'number'
        ? f[WEBFLOW_FIELDS.MAX_PARTICIPANTS]
        : null,
    coachRefId: f[WEBFLOW_FIELDS.COACH] || null,
    successUrl: f[WEBFLOW_FIELDS.SUCCESS_URL] || null,
    cancelUrl: f[WEBFLOW_FIELDS.CANCEL_URL] || null,
    meetUrl: f[WEBFLOW_FIELDS.GOOGLE_MEET_URL] || null,
    labUrl: f[WEBFLOW_FIELDS.LAB_URL] || null,
    sessionsJson: f[WEBFLOW_FIELDS.SESSIONS_JSON] || '[]',
    description: f[WEBFLOW_FIELDS.FULL_DESCRIPTION] || null
  };
}

/**
 * Get lab by ID
 */
async function getLabById(labId) {
  const collectionId = requireEnv('WEBFLOW_COLLECTION_ID');
  const item = await getWebflowItem(collectionId, labId);
  return mapItemToLab(item);
}

/**
 * Get lab by slug
 */
async function getLabBySlug(slug) {
  const collectionId = requireEnv('WEBFLOW_COLLECTION_ID');
  const item = await findWebflowItemBySlug(collectionId, slug);
  return item ? mapItemToLab(item) : null;
}

/**
 * Get coach's Stripe Connect account ID
 * Tries multiple field name variations for compatibility
 */
async function getCoachStripeAccountId(coachItemId) {
  if (!coachItemId) return null;

  const coachCollectionId = requireEnv('COACH_COLLECTION_ID');
  const coachItem = await getWebflowItem(coachCollectionId, coachItemId);

  const f = coachItem?.item?.fieldData || coachItem?.fieldData || {};

  // Try multiple field name variations (legacy compatibility)
  const candidates = [
    f['coach-stripe-account-id'],
    f['stripe-account-id'],
    f['coach_stripe_account_id'],
    f['stripe_account_id']
  ];

  const accountId = candidates.find(v => typeof v === 'string' && v.startsWith('acct_')) || null;

  if (!accountId) {
    logger.warn('Coach Stripe account ID not found', {
      coachItemId,
      availableFields: Object.keys(f)
    });
  }

  return accountId;
}

/**
 * Get coach details
 */
async function getCoachDetails(coachItemId) {
  if (!coachItemId) return null;

  const coachCollectionId = requireEnv('COACH_COLLECTION_ID');

  try {
    const coachItem = await getWebflowItem(coachCollectionId, coachItemId);
    const f = coachItem?.item?.fieldData || coachItem?.fieldData || {};

    return {
      id: coachItemId,
      name: f[WEBFLOW_FIELDS.NAME] || null,
      email: f[WEBFLOW_FIELDS.EMAIL_FIELD] || null,
      instagram: f[WEBFLOW_FIELDS.INSTAGRAM_PROFILE] || null,
      facebook: f[WEBFLOW_FIELDS.FACEBOOK_PROFILE] || null,
      profilePic: f[WEBFLOW_FIELDS.PROFILE_PIC]?.url || null,
      stripeAccountId: await getCoachStripeAccountId(coachItemId)
    };
  } catch (error) {
    logger.error('Failed to fetch coach details', error, { coachItemId });
    return null;
  }
}

/**
 * Clear cache (useful for testing or manual cache invalidation)
 */
function clearCache() {
  webflowCache.clear();
  logger.info('Webflow cache cleared');
}

module.exports = {
  webflowFetch,
  getWebflowItem,
  listWebflowItems,
  findWebflowItemBySlug,
  mapItemToLab,
  getLabById,
  getLabBySlug,
  getCoachStripeAccountId,
  getCoachDetails,
  clearCache,
  webflowCache // Export for testing
};
