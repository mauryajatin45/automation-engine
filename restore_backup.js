require('dotenv').config();
const { shopifyApi, ApiVersion, Session } = require('@shopify/shopify-api');
const fs = require('fs');
require('@shopify/shopify-api/adapters/node');

// Ensure required environment variables are set
const requiredEnv = ['SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET', 'SHOPIFY_SCOPES', 'SHOP_URL', 'SHOPIFY_ACCESS_TOKEN'];
for (const env of requiredEnv) {
  if (!process.env[env]) {
    console.error(`❌ Missing required environment variable: ${env}`);
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

// Helper delay to respect rate limits
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function restoreBackup() {
  const backupFile = 'catalog_backup_2026-07-04T09-23-11-006Z.json';
  
  if (!fs.existsSync(backupFile)) {
    console.error(`❌ Backup file not found: ${backupFile}`);
    process.exit(1);
  }

  console.log(`📖 Reading backup file: ${backupFile}...`);
  let backupData;
  try {
    const rawContent = fs.readFileSync(backupFile, 'utf8');
    // The backup script writes a trailing comma if it was interrupted, but it closed with ']'
    // Let's clean up any possible trailing comma issue or malformed brackets at the end
    let cleaned = rawContent.trim();
    if (cleaned.endsWith(',')) {
      cleaned = cleaned.slice(0, -1) + '\n]';
    } else if (!cleaned.endsWith(']')) {
      cleaned = cleaned + '\n]';
    }
    backupData = JSON.parse(cleaned);
  } catch (err) {
    console.error('❌ Failed to parse backup file JSON:', err.message);
    process.exit(1);
  }

  console.log(`🔄 Found ${backupData.length} products to restore.`);

  for (let i = 0; i < backupData.length; i++) {
    const item = backupData[i];
    const productNum = i + 1;
    console.log(`\n[${productNum}/${backupData.length}] Restoring Product ID: ${item.id}`);
    console.log(`👉 Title: "${item.original_title}"`);

    try {
      const response = await client.request(UPDATE_PRODUCT_MUTATION, {
        variables: {
          input: {
            id: item.id,
            title: item.original_title,
            descriptionHtml: item.original_descriptionHtml,
          }
        }
      });

      const errors = response.data?.productUpdate?.userErrors;
      if (errors && errors.length > 0) {
        console.error(`❌ Errors updating product ${item.id}:`, JSON.stringify(errors, null, 2));
      } else {
        console.log(`✅ Successfully restored!`);
      }
    } catch (err) {
      console.error(`❌ Request error for product ${item.id}:`, err.message);
    }

    // Pacing to avoid API rate limit triggers
    await delay(300);
  }

  console.log('\n🎉 Restore complete! All products reverted to original titles and descriptions.');
}

restoreBackup();
