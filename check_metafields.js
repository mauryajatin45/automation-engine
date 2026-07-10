require('dotenv').config();
const { shopifyApi, ApiVersion, Session } = require('@shopify/shopify-api');
require('@shopify/shopify-api/adapters/node');

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

const GET_METAEFIELDS_TEST = `
  query getProducts {
    products(first: 10) {
      edges {
        node {
          id
          title
          vehicleMake: metafield(namespace: "custom", key: "vehicle_make") {
            value
          }
        }
      }
    }
  }
`;

async function check() {
  const res = await client.request(GET_METAEFIELDS_TEST);
  console.log(JSON.stringify(res.data.products.edges, null, 2));
}

check();
