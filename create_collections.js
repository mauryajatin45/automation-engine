require('dotenv').config();
const { shopifyApi, ApiVersion, Session } = require('@shopify/shopify-api');
require('@shopify/shopify-api/adapters/node');

// 1. Initialize Shopify API
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

// List of Series to create collections for
const seriesList = [
  "40 Series",
  "60 Series",
  "70 Series",
  "75 Series",
  "79 Series",
  "80 Series",
  "100 Series",
  "105 Series",
  "200 Series",
  "300 Series"
];

async function createCollections() {
  console.log('🚀 Starting Automated Collection Creation...');

  for (const series of seriesList) {
    console.log(`\nCreating Collection for: ${series}`);
    
    // In Shopify, to use a Metafield in a Smart Collection via API:
    // We can tag the products or use the exact string match if supported.
    // However, if the store isn't on the absolute latest API version for metafield smart collections,
    // we can create a generic smart collection and the user can manually set the condition in the UI, 
    // OR we use the title/tags. 
    // Since we created custom.vehicle_series, let's create the collection structure first.
    
    const input = {
      title: `${series} Accessories`,
      descriptionHtml: `<p>Shop premium aftermarket accessories for your ${series}.</p>`,
      // Note: Setting Metafield rules via GraphQL requires the specific internal Metafield Definition ID.
      // To keep this script simple and robust, we will create standard collections, 
      // and you will just need to set the rule to "Vehicle Series" = "${series}" in the Shopify Admin.
    };

    try {
      const response = await client.request(CREATE_COLLECTION_MUTATION, {
        variables: { input }
      });

      if (response.data.collectionCreate.userErrors.length > 0) {
        console.error(`❌ Error creating ${series}:`, response.data.collectionCreate.userErrors);
      } else {
        console.log(`✅ Success! Created: ${response.data.collectionCreate.collection.title} (URL: /collections/${response.data.collectionCreate.collection.handle})`);
      }
      
      // Sleep to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`Fatal Error on ${series}:`, error.message);
    }
  }
  
  console.log('\n🏁 Collection Creation Complete! Go to Shopify Admin -> Products -> Collections to see them, and add the "Vehicle Series" rule to each one.');
}

createCollections();
