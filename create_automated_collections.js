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

const GET_METAFIELD_DEFINITIONS = `
  query {
    metafieldDefinitions(first: 100, ownerType: PRODUCT) {
      edges {
        node {
          id
          key
          namespace
          name
        }
      }
    }
  }
`;

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

// Helper: GraphQL request with retry
async function requestWithRetry(client, query, variables = {}, retries = 3, delayMs = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await client.request(query, { variables });
      return response;
    } catch (error) {
      if (attempt === retries) throw error;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

// Define the structural data matching our catalog
const vehicles = [
  { name: '40 Series Parts', seriesName: '40 Series' },
  { name: '60 Series Parts', seriesName: '60 Series' },
  { name: '70 Series Parts', seriesName: '70 Series' },
  { name: '75 Series Parts', seriesName: '75 Series' },
  { name: '76 Series Parts', seriesName: '76 Series' },
  { name: '79 Series Parts', seriesName: '79 Series' },
  { name: 'Hilux Parts', seriesName: 'Hilux' },
  { name: 'Patrol Parts', seriesName: 'Patrol' },
  { name: 'Ranger Parts', seriesName: 'Ranger' },
  { name: 'D-MAX Parts', seriesName: 'D-MAX' },
  { name: 'BT-50 Parts', seriesName: 'BT-50' }
];

const categories = [
  'Accessories',
  'Doors',
  'Bonnets',
  'Guards & Supports',
  'Tubs',
  'Cabins & Supports',
  'Suspension',
  'Lighting',
  'Differentials & Lockers',
  'Recovery Gear',
  'Electrical',
  'Interior',
  'Exterior',
  'Camping',
  'Fridge/Freezers',
  'Batteries',
  'Solar & Power',
  'UHF Radios & Antennas',
  'Tow Balls',
  'Tow Ball Mounts',
  'Winch Accessories',
  'Tyre Deflators'
];

async function createCollections() {
  console.log(`📡 Fetching metafield definitions to configure rules...`);
  let metafieldDefs = [];
  try {
    const res = await requestWithRetry(client, GET_METAFIELD_DEFINITIONS);
    metafieldDefs = res.data.metafieldDefinitions.edges.map(e => e.node);
  } catch (err) {
    console.error('❌ Error fetching metafield definitions:', err.message);
    return;
  }

  const seriesDef = metafieldDefs.find(d => d.key === 'vehicle_series' && d.namespace === 'custom');
  if (!seriesDef) {
    console.error('❌ Error: Could not find product metafield definition for "custom.vehicle_series".');
    console.error('Make sure you have created the vehicle_series metafield in Shopify Admin settings.');
    return;
  }

  console.log(`✅ Found custom.vehicle_series definition ID: ${seriesDef.id}`);

  // 1. Create Category Collections (e.g. Doors)
  console.log(`\n📦 Creating Category Collections...`);
  for (const cat of categories) {
    const input = {
      title: cat,
      ruleSet: {
        appliedDisjunctively: false,
        rules: [
          {
            column: 'TYPE',
            relation: 'EQUALS',
            condition: cat
          }
        ]
      }
    };
    await attemptCreateCollection(input);
  }

  // 2. Create Vehicle Hub Collections (e.g. 79 Series Parts)
  console.log(`\n🚗 Creating Vehicle Hub Collections...`);
  for (const veh of vehicles) {
    const input = {
      title: veh.name,
      ruleSet: {
        appliedDisjunctively: false,
        rules: [
          {
            column: 'TITLE',
            relation: 'CONTAINS',
            condition: veh.seriesName
          }
        ]
      }
    };
    await attemptCreateCollection(input);
  }

  // 3. Create Vehicle + Category Collections (e.g. 79 Series Doors)
  console.log(`\n🔗 Creating Vehicle + Category Combinations (for top vehicle series)...`);
  const topVehicles = ['79 Series Parts', '60 Series Parts', '70 Series Parts'];
  const activeHubs = vehicles.filter(v => topVehicles.includes(v.name));

  for (const veh of activeHubs) {
    for (const cat of ['Doors', 'Bonnets', 'Suspension', 'Lighting', 'Accessories']) {
      const colTitle = `${veh.seriesName} ${cat}`;
      const input = {
        title: colTitle,
        ruleSet: {
          appliedDisjunctively: false, // Match ALL rules
          rules: [
            {
              column: 'TITLE',
              relation: 'CONTAINS',
              condition: veh.seriesName
            },
            {
              column: 'TYPE',
              relation: 'EQUALS',
              condition: cat
            }
          ]
        }
      };
      await attemptCreateCollection(input);
    }
  }

  console.log('\n🏁 Automated Collection setup complete!');
}

async function attemptCreateCollection(input) {
  try {
    const res = await requestWithRetry(client, CREATE_COLLECTION_MUTATION, { input });
    const errors = res.data.collectionCreate.userErrors;
    if (errors.length > 0) {
      console.log(`❌ Failed to create "${input.title}":`, errors.map(e => e.message).join(', '));
    } else {
      console.log(`✅ Created automated collection: "${res.data.collectionCreate.collection.title}"`);
    }
  } catch (e) {
    console.error(`❌ Error creating "${input.title}":`, e.message);
  }
}

createCollections();
