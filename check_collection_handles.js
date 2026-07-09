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

const GET_COLLECTIONS = `
  query {
    collections(first: 250) {
      edges {
        node {
          id
          title
          handle
        }
      }
    }
  }
`;

async function checkCollections() {
  try {
    const res = await client.request(GET_COLLECTIONS);
    const collections = res.data.collections.edges.map(e => e.node);
    console.log('\n======================================');
    console.log('Shopify Collections List (Title -> Handle)');
    console.log('======================================');
    collections.forEach(c => {
      console.log(`- "${c.title}" -> handle: "${c.handle}"`);
    });
  } catch (error) {
    console.error('Error fetching collections:', error);
  }
}

checkCollections();
