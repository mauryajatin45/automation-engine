require('dotenv').config();
const { shopifyApi, ApiVersion, Session } = require('@shopify/shopify-api');
require('@shopify/shopify-api/adapters/node');
const { requestWithRetry } = require('./enricher');

const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SHOPIFY_SCOPES.split(','),
  hostName: process.env.HOST.replace(/https?:\/\//, ''),
  apiVersion: ApiVersion.April26,
  isEmbeddedApp: false,
});

const session = new Session({
  id: `offline_${process.env.SHOP_URL}`,
  shop: process.env.SHOP_URL,
  state: 'offline',
  isOnline: false,
  accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
});

const client = new shopify.clients.Graphql({ session });

const FETCH_PRODUCTS_TYPES = `
  query getProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          productType
          tags
        }
      }
    }
  }
`;

async function analyze() {
  console.log('📡 Fetching catalog from Shopify for local analysis...');
  let hasNextPage = true;
  let cursor = null;
  const products = [];

  while (hasNextPage) {
    const response = await requestWithRetry(client, FETCH_PRODUCTS_TYPES, { first: 50, after: cursor });
    const data = response.data.products;
    products.push(...data.edges.map(e => e.node));
    hasNextPage = data.pageInfo.hasNextPage;
    cursor = data.pageInfo.endCursor;
  }

  console.log(`✅ Loaded ${products.length} products locally.`);

  // We want to group products by type and analyze which ones are universal/simple accessories vs complex body/mechanical parts.
  const groupedByType = {};
  products.forEach(p => {
    const type = p.productType || 'Uncategorized';
    if (!groupedByType[type]) {
      groupedByType[type] = [];
    }
    groupedByType[type].push(p);
  });

  console.log('\n--- Catalog Grouped By Product Type ---');
  const typeAnalysis = [];
  
  for (const [type, list] of Object.entries(groupedByType)) {
    // Check if the type is known to be universal/simple
    const typeLower = type.toLowerCase();
    
    // We classify as "Simple/No Fitment Notes Needed" if it matches these categories
    let categoryClassification = 'Complex (Requires Fitment Notes)';
    if (
      typeLower.includes('ball') ||
      typeLower.includes('mount') ||
      typeLower.includes('fridge') ||
      typeLower.includes('freezer') ||
      typeLower.includes('solar') ||
      typeLower.includes('battery') ||
      typeLower.includes('camping') ||
      typeLower.includes('mats') ||
      typeLower.includes('radio') ||
      typeLower.includes('antenna') ||
      typeLower.includes('recovery') ||
      typeLower.includes('winch') ||
      typeLower.includes('deflator') ||
      typeLower.includes('deflators') ||
      typeLower.includes('tie down') ||
      typeLower.includes('strap') ||
      typeLower.includes('table') ||
      typeLower.includes('light bar')
    ) {
      categoryClassification = 'Simple/Universal (NO Fitment Notes Needed)';
    }

    typeAnalysis.push({
      type,
      count: list.length,
      classification: categoryClassification,
      samples: list.slice(0, 3).map(p => p.title)
    });
  }

  // Print results
  console.log(JSON.stringify(typeAnalysis, null, 2));
}

analyze();
