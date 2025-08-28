// /api/debug-webflow.js
// Lists slugs from your Flight Labs collection so we can verify
const ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  else if (ORIGINS.length) res.setHeader('Access-Control-Allow-Origin', ORIGINS[0]);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function wfFetch(url) {
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.WEBFLOW_TOKEN}`,
      'Content-Type': 'application/json',
    },
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Webflow ${url} -> ${r.status}: ${t}`);
  }
  return r.json();
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { setCors(req, res); return res.status(204).end(); }
  try {
    setCors(req, res);

    const collectionId = process.env.WEBFLOW_COLLECTION_ID;
    if (!collectionId) return res.status(400).json({ error: 'Missing WEBFLOW_COLLECTION_ID' });

    const limit = Number(req.query.limit || 100);
    const localeParam = process.env.WEBFLOW_CMS_LOCALE_ID
      ? `&cmsLocaleId=${encodeURIComponent(process.env.WEBFLOW_CMS_LOCALE_ID)}`
      : '';

    let offset = 0;
    const seen = [];
    while (offset < 1000 && seen.length < limit) {
      const url = `https://api.webflow.com/v2/collections/${collectionId}/items?limit=100&offset=${offset}${localeParam}`;
      const data = await wfFetch(url);
      const items = data.items || [];
      items.forEach(it => {
        seen.push({
          id: it.id,
          slug: it.slug,
          name: it.fieldData?.name,
          cmsLocaleId: it.cmsLocaleId || null,
          published: it.isDraft === false && it.isArchived === false,
        });
      });
      if (items.length < 100) break;
      offset += 100;
    }

    return res.status(200).json({
      count: seen.length,
      collectionId,
      cmsLocaleId: process.env.WEBFLOW_CMS_LOCALE_ID || null,
      sample: seen.slice(0, limit),
    });
  } catch (e) {
    console.error('debug-webflow error:', e);
    setCors(req, res);
    return res.status(500).json({ error: String(e.message || e) });
  }
};
