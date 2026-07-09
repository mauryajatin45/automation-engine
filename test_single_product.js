require('dotenv').config();
const { OpenAI } = require('openai');
const { shopifyApi, ApiVersion, Session } = require('@shopify/shopify-api');
require('@shopify/shopify-api/adapters/node');
const { enrichProduct } = require('./enricher');

// Ensure required environment variables are set
const requiredEnvs = ['SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET', 'SHOPIFY_ACCESS_TOKEN', 'SHOP_URL', 'OPENAI_API_KEY'];
for (const env of requiredEnvs) {
  if (!process.env[env]) {
    console.error(`Missing required environment variable: ${env}`);
    process.exit(1);
  }
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

// Get the product ID and run
const args = process.argv.slice(2);
const productId = args[0] || 'gid://shopify/Product/8755157991715'; // Default to Toyota DPF Bonnet
const dryRun = args[1] !== 'commit'; // Default to dry-run unless 'commit' is specified

console.log(`🧪 Running single product enrichment test with imported pipeline...`);
enrichProduct(client, openai, productId, dryRun)
  .then(success => {
    if (success) {
      console.log('✅ Test run completed successfully!');
    } else {
      console.log('❌ Test run failed.');
    }
  })
  .catch(console.error);
