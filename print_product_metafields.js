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

const GET_PRODUCT_METAFIELDS = `
  query getProductMetafields($id: ID!) {
    product(id: $id) {
      id
      title
      metafields(first: 50) {
        edges {
          node {
            namespace
            key
            value
            type
          }
        }
      }
    }
  }
`;

async function printMetafields() {
  const args = process.argv.slice(2);
  const productId = args[0];
  if (!productId) {
    console.error('Please specify a product ID. Example: node print_product_metafields.js gid://shopify/Product/9759854264611');
    process.exit(1);
  }
  
  try {
    const res = await client.request(GET_PRODUCT_METAFIELDS, { variables: { id: productId } });
    const product = res.data.product;
    if (!product) {
      console.log(`Product ${productId} not found.`);
      return;
    }
    
    console.log(`\n======================================`);
    console.log(`Product: "${product.title}" (${product.id})`);
    console.log(`======================================`);
    
    const metafields = product.metafields.edges.map(e => e.node);
    if (metafields.length === 0) {
      console.log('No metafields populated.');
      return;
    }
    
    console.log(JSON.stringify(metafields, null, 2));
  } catch (error) {
    console.error('Error fetching metafields:', error);
  }
}

printMetafields();
