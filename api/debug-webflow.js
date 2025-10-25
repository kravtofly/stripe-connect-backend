// /api/debug-webflow.js
// Lists slugs from your Flight Labs collection so we can verify
const { withCors } = require('./lib/cors');
const { createLogger } = require('./lib/logger');
const { withErrorHandling } = require('./lib/errors');
const { ValidationError } = require('./lib/errors');
const { HTTP_STATUS, LIMITS, WEBFLOW_FIELDS } = require('./lib/constants');
const { requireEnv, getEnv } = require('./lib/validation');
const { listWebflowItems } = require('./lib/webflow');

const logger = createLogger('debug-webflow');

/**
 * GET /api/debug-webflow
 *
 * Debug endpoint to list Flight Lab items from Webflow CMS.
 * Useful for verifying collection ID, locale settings, and item slugs.
 *
 * Query parameters:
 * - limit: Maximum number of items to return (default: 100)
 */
async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(HTTP_STATUS.METHOD_NOT_ALLOWED).json({
      error: 'Method not allowed'
    });
  }

  const collectionId = requireEnv('WEBFLOW_COLLECTION_ID');
  const cmsLocaleId = getEnv('WEBFLOW_CMS_LOCALE_ID', null);
  const limit = Number(req.query.limit || 100);

  if (limit < 1 || limit > 1000) {
    throw new ValidationError('Limit must be between 1 and 1000');
  }

  logger.info('Fetching Webflow items for debug', {
    collectionId,
    cmsLocaleId,
    limit
  });

  const items = await listWebflowItems(collectionId, {
    maxItems: limit
  });

  const sample = items.map(it => ({
    id: it.id,
    slug: it.slug,
    name: it.fieldData?.[WEBFLOW_FIELDS.NAME],
    cmsLocaleId: it.cmsLocaleId || null,
    published: it.isDraft === false && it.isArchived === false,
  }));

  logger.info('Debug items retrieved', {
    count: sample.length,
    collectionId
  });

  return res.status(HTTP_STATUS.OK).json({
    count: sample.length,
    collectionId,
    cmsLocaleId,
    sample
  });
}

module.exports = withErrorHandling(withCors(handler, {
  methods: ['GET', 'OPTIONS']
}));
