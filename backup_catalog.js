require('dotenv').config();
const { shopifyApi, ApiVersion, Session } = require('@shopify/shopify-api');
const fs = require('fs');
require('@shopify/shopify-api/adapters/node');

// Ensure required environment variables are set
const requiredEnvs = ['SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET', 'SHOPIFY_ACCESS_TOKEN', 'SHOP_URL'];
for (const env of requiredEnvs) {
  if (!process.env[env]) {
    console.error(`Missing required environment variable: ${env}`);
    process.exit(1);
  }
}

const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SHOPIFY_SCOPES.split(','),
  hostName: process.env.HOST ? process.env.HOST.replace(/https?:\/\//, '') : 'localhost',
  apiVersion: '2024-04',
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

const GET_PRODUCTS_QUERY = `
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
          descriptionHtml
        }
      }
    }
  }
`;

async function backupCatalog() {
  console.log('🚀 Starting Full Catalog Backup...');
  
  let hasNextPage = true;
  let cursor = null;
  let totalBackedUp = 0;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = `catalog_backup_${timestamp}.json`;
  
  // Clear file if it exists, or create a new array
  fs.writeFileSync(backupFile, '[\n');
  
  let isFirst = true;

  try {
    while (hasNextPage) {
      const response = await client.request(GET_PRODUCTS_QUERY, {
        variables: { first: 50, after: cursor },
      });

      const edges = response.data.products.edges;
      const pageInfo = response.data.products.pageInfo;

      for (const edge of edges) {
        const product = edge.node;
        const backupEntry = JSON.stringify({
          id: product.id,
          original_title: product.title,
          original_descriptionHtml: product.descriptionHtml
        }, null, 2);
        
        if (!isFirst) {
          fs.appendFileSync(backupFile, ',\n');
        }
        fs.appendFileSync(backupFile, backupEntry);
        isFirst = false;
        totalBackedUp++;
      }

      hasNextPage = pageInfo.hasNextPage;
      cursor = pageInfo.endCursor;
      console.log(`[Progress] Backed up ${totalBackedUp} products...`);
    }
    
    fs.appendFileSync(backupFile, '\n]\n');
    console.log(`✅ Backup Complete! Successfully backed up ${totalBackedUp} products to ${backupFile}`);

  } catch (error) {
    console.error('Error during backup:', error.message);
  }
}

backupCatalog();
