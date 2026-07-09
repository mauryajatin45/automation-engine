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

const CREATE_MENU_MUTATION = `
  mutation menuCreate($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) {
    menuCreate(title: $title, handle: $handle, items: $items) {
      menu {
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

async function createMenus() {
  console.log('🚀 Building Automated Menus...');

  // 1. Create "Shop by Vehicle" Menu
  const vehicleMenuVariables = {
    title: "Shop by Vehicle",
    handle: "shop-by-vehicle",
    items: [
      { title: "Toyota", type: "HTTP", url: "/collections/toyota" },
      { title: "Holden", type: "HTTP", url: "/collections/holden" },
      { title: "Ford", type: "HTTP", url: "/collections/ford" },
      { title: "Mazda", type: "HTTP", url: "/collections/mazda" },
      { title: "Nissan", type: "HTTP", url: "/collections/nissan" }
    ]
  };

  // 2. Create "Shop by Category" Menu
  const categoryMenuVariables = {
    title: "Shop by Category",
    handle: "shop-by-category",
    items: [
      { 
        title: "TUB", 
        type: "HTTP", 
        url: "/collections/tub",
        items: [
          { title: "75 Series Single Cab Tub", type: "HTTP", url: "/collections/75-series-single-cab-tub" },
          { title: "79 Series Dual Cab Tub", type: "HTTP", url: "/collections/79-series-dual-cab-tub" }
        ]
      },
      { 
        title: "GUARDS AND RAD SUPPORTS", 
        type: "HTTP", 
        url: "/collections/guards-and-rad-supports",
        items: [
          { title: "Landcruiser 79 Series LED Tail Light Tray", type: "HTTP", url: "/collections/led-tail-light-tray" }
        ]
      },
      { 
        title: "BONNET", 
        type: "HTTP", 
        url: "/collections/bonnet",
        items: [
          { title: "Standard Replacement", type: "HTTP", url: "/collections/bonnet" },
          { title: "Scoop Bonnet", type: "HTTP", url: "/collections/scoop-bonnet" }
        ]
      }
    ]
  };

  try {
    // Create Vehicle Menu
    console.log(`\nCreating ${vehicleMenuVariables.title}...`);
    const res1 = await client.request(CREATE_MENU_MUTATION, { variables: vehicleMenuVariables });
    if (res1.data.menuCreate.userErrors.length > 0) {
      console.error(res1.data.menuCreate.userErrors);
    } else {
      console.log(`✅ Success! Created menu: ${res1.data.menuCreate.menu.title}`);
    }

    // Create Category Menu
    console.log(`\nCreating ${categoryMenuVariables.title}...`);
    const res2 = await client.request(CREATE_MENU_MUTATION, { variables: categoryMenuVariables });
    if (res2.data.menuCreate.userErrors.length > 0) {
      console.error(res2.data.menuCreate.userErrors);
    } else {
      console.log(`✅ Success! Created menu: ${res2.data.menuCreate.menu.title}`);
    }

  } catch (error) {
    console.error(`Fatal Error:`, error.message);
  }
  
  console.log('\n🏁 Done! Go to Shopify Admin -> Online Store -> Navigation to view them. You can attach these to your Main Menu!');
}

createMenus();
