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

const client = new shopify.clients.Graphql({ session });

async function fetchProduct() {
  const query = `
    query {
      product(id: "gid://shopify/Product/8621563674915") {
        title
        descriptionHtml
      }
    }
  `;
  const res = await client.request(query);
  console.log("=== NEW TITLE ===");
  console.log(res.data.product.title);
  console.log("=== NEW DESCRIPTION ===");
  console.log(res.data.product.descriptionHtml);
}

fetchProduct().catch(console.error);
