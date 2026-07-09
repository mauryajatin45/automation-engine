require('dotenv').config();
const { shopifyApi, ApiVersion, Session } = require('@shopify/shopify-api');
const fs = require('fs');
require('@shopify/shopify-api/adapters/node');

const requiredEnv = ['SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET', 'SHOPIFY_ACCESS_TOKEN', 'SHOP_URL'];
for (const env of requiredEnv) {
  if (!process.env[env]) {
    console.error(`❌ Missing required env: ${env}`);
    process.exit(1);
  }
}

const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SHOPIFY_SCOPES.split(','),
  hostName: process.env.HOST ? process.env.HOST.replace(/https?:\/\//, '') : 'localhost',
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

const UPDATE_PRODUCT_MUTATION = `
  mutation productUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product {
        id
        title
      }
      userErrors {
        field
        message
      }
    }
  }
`;

async function restoreSingleProduct(targetId) {
  console.log(`🔍 Scanning backups.jsonl for product ID: ${targetId}...`);
  
  if (!fs.existsSync('backups.jsonl')) {
    console.error('❌ backups.jsonl file not found!');
    process.exit(1);
  }

  const lines = fs.readFileSync('backups.jsonl', 'utf8').split('\n');
  let originalEntry = null;

  // We loop forward and take the FIRST occurrence because it represents the original state before any AI updates
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.id === targetId) {
        originalEntry = entry;
        break; // Stop at first match
      }
    } catch (e) {
      // ignore JSON parse errors on malformed lines
    }
  }

  if (!originalEntry) {
    console.error(`❌ No backup record found for ID: ${targetId}`);
    process.exit(1);
  }

  console.log(`\n======================================`);
  console.log(`Found original backup record:`);
  console.log(`- Title: "${originalEntry.original_title}"`);
  console.log(`- Timestamp: ${originalEntry.timestamp}`);
  console.log(`======================================\n`);

  console.log(`🔄 Reverting product in Shopify...`);
  try {
    const response = await client.request(UPDATE_PRODUCT_MUTATION, {
      variables: {
        input: {
          id: targetId,
          title: originalEntry.original_title,
          descriptionHtml: originalEntry.original_descriptionHtml
        }
      }
    });

    const errors = response.data?.productUpdate?.userErrors;
    if (errors && errors.length > 0) {
      console.error(`❌ Errors updating product:`, JSON.stringify(errors, null, 2));
    } else {
      console.log(`✅ Successfully restored product: "${originalEntry.original_title}"!`);
    }
  } catch (error) {
    console.error(`❌ Request error:`, error.message);
  }
}

// Target product ID for the fridge slide
const targetId = 'gid://shopify/Product/10285331677475';
restoreSingleProduct(targetId);
