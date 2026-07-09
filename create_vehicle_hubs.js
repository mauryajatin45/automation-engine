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

const CREATE_COLLECTION_MUTATION = `
  mutation collectionCreate($input: CollectionInput!) {
    collectionCreate(input: $input) {
      collection {
        id
        title
        handle
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const vehicles = [
  "40 Series", "60 Series", "75 Series", "76 Series", "79 Series", 
  "Hilux", "Patrol", "Ranger", "D-MAX", "BT-50"
];

async function createHubs() {
  console.log('🚀 Creating Base Vehicle Hub Collections to fix 404s...');

  for (const vehicle of vehicles) {
    const input = {
      title: vehicle,
      handle: vehicle.toLowerCase().replace(/\s+/g, '-'),
      descriptionHtml: `<p>Shop premium aftermarket parts and accessories for your ${vehicle}.</p>`,
    };

    try {
      const response = await client.request(CREATE_COLLECTION_MUTATION, {
        variables: { input }
      });

      if (response.data.collectionCreate.userErrors.length > 0) {
        console.error(`❌ Error creating ${vehicle}:`, response.data.collectionCreate.userErrors[0].message);
      } else {
        console.log(`✅ Created: ${response.data.collectionCreate.collection.title} (/collections/${response.data.collectionCreate.collection.handle})`);
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`Fatal Error on ${vehicle}:`, error.message);
    }
  }
}

createHubs();
