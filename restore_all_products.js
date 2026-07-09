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

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function restoreAllCatalogue() {
  console.log('🏁 Starting Master Catalog Restore Pipeline...');
  
  const restoreMap = new Map(); // id -> { title, descriptionHtml }

  // Read backups.jsonl for all products, capturing the first (earliest) entry for each ID
  if (fs.existsSync('backups.jsonl')) {
    console.log('📖 Scanning backups.jsonl chronologically to find the absolute earliest (human) state of each product...');
    const lines = fs.readFileSync('backups.jsonl', 'utf8').split('\n');
    let productsFoundCount = 0;
    
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.id && entry.original_title) {
          // By check mapping existence, we lock onto the absolute FIRST (earliest) backup entry
          if (!restoreMap.has(entry.id)) {
            restoreMap.set(entry.id, {
              title: entry.original_title,
              descriptionHtml: entry.original_descriptionHtml
            });
            productsFoundCount++;
          }
        }
      } catch (e) {
        // ignore parse error
      }
    }
    console.log(`✅ Completed scan. Found ${productsFoundCount} total products that were processed by the AI.`);
  } else {
    console.error('❌ backups.jsonl file not found!');
    process.exit(1);
  }

  const productsToRestore = Array.from(restoreMap.entries());
  console.log(`\n======================================`);
  console.log(`Total Products to Restore: ${productsToRestore.length}`);
  console.log(`======================================\n`);

  if (productsToRestore.length === 0) {
    console.log('Done: No backup entries found to restore.');
    return;
  }

  for (let i = 0; i < productsToRestore.length; i++) {
    const [productId, originalData] = productsToRestore[i];
    const productNum = i + 1;
    
    console.log(`[${productNum}/${productsToRestore.length}] Reverting Product ID: ${productId}`);
    console.log(`👉 Title: "${originalData.title}"`);
    
    try {
      const response = await client.request(UPDATE_PRODUCT_MUTATION, {
        variables: {
          input: {
            id: productId,
            title: originalData.title,
            descriptionHtml: originalData.descriptionHtml
          }
        }
      });
      
      const errors = response.data?.productUpdate?.userErrors;
      if (errors && errors.length > 0) {
        console.error(`❌ Errors updating product ${productId}:`, JSON.stringify(errors, null, 2));
      } else {
        console.log(`✅ Success`);
      }
    } catch (err) {
      console.error(`❌ Request failed for product ${productId}:`, err.message);
    }
    
    // Pace requests to stay within Shopify GraphQL API rate limits
    await delay(350);
  }

  console.log('\n🎉 Revert complete! All product titles and descriptions restored to original human-written copies.');
}

restoreAllCatalogue();
