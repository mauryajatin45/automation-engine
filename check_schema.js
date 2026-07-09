require('dotenv').config();
const { shopifyApi, ApiVersion, Session } = require('@shopify/shopify-api');
require('@shopify/shopify-api/adapters/node');

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

async function checkSchema() {
  const query = `
    query {
      __schema {
        mutationType {
          fields {
            name
            args {
              name
              type {
                name
                kind
                ofType { name }
              }
            }
          }
        }
      }
    }
  `;
  try {
    const res = await client.request(query);
    const fields = res.data.__schema.mutationType.fields;
    const menuCreate = fields.find(f => f.name === 'menuCreate');
    console.log(JSON.stringify(menuCreate, null, 2));
  } catch(e) {
    console.log(e.message);
  }
}

checkSchema();
