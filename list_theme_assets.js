require('dotenv').config();
const { shopifyApi, ApiVersion, Session } = require('@shopify/shopify-api');
require('@shopify/shopify-api/adapters/node');

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

const client = new shopify.clients.Rest({ session });

async function listAssets() {
  try {
    const response = await client.get({
      path: `themes/186366296355/assets`,
    });
    console.log('\n======================================');
    console.log('Shopify Theme Assets List');
    console.log('======================================');
    const assets = response.body.assets;
    const jsonTemplates = assets.filter(a => a.key.startsWith('templates/') && a.key.endsWith('.json'));
    jsonTemplates.forEach(a => {
      console.log(`- ${a.key}`);
    });
  } catch (error) {
    console.error('Error fetching assets:', error);
  }
}

listAssets();
