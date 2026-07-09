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

const UPDATE_MENU_MUTATION = `
  mutation menuUpdate($id: ID!, $title: String!, $items: [MenuItemUpdateInput!]!) {
    menuUpdate(id: $id, title: $title, items: $items) {
      menu {
        id
        title
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// Helper to remove IDs so Shopify cleanly recreates the nested structure
function cleanItem(item) {
  const { id, ...rest } = item;
  if (rest.items && rest.items.length > 0) {
    rest.items = rest.items.map(cleanItem);
  }
  return rest;
}

// 1. The original items from your MAIN MENU (copy)
const originalMainMenuItems = [
  {
    "title": "Shop",
    "url": "/collections/all",
    "type": "HTTP",
    "items": [
      {
        "title": "Aftermarket Rear Door RH Suitable for Landcruiser Dual cab and 76 Series V8 07 to 2023",
        "url": "/products/copy-of-79-series-dual-cab-and-76-series-rear-door-lh",
        "type": "HTTP"
      },
      {
        "title": "Silver Stainless Steel Door Step/Sill Trims Suitable for 70 Series Landcruiser Single Cab",
        "url": "/products/stainless-steel-door-step-trims-suitable-for-70-series-landcruiser-single-cab",
        "type": "HTTP"
      },
      {
        "title": "Black Stainless Steel Door Step/Sill Trims Suitable for 70 Series Landcruiser Single Cab",
        "url": "/products/black-stainless-steel-door-step-sill-trims-suitable-for-70-series-landcruiser-single-cab",
        "type": "HTTP"
      },
      {
        "title": "Aftermarket Rear Door LH Suitable for Landcruiser Dual cab and 76 Series V8 07 to 2023",
        "url": "/products/79-series-dual-cab-and-76-series-rear-door-rh",
        "type": "HTTP"
      },
      {
        "title": "Black Stainless Steel Door Step/Sill Trims Suitable for 70 Series Landcruiser Dual Cab and 76",
        "url": "/products/black-stainless-steel-door-step-sill-trims-suitable-for-70-series-landcruiser-dual-cab-and-76",
        "type": "HTTP"
      },
      {
        "title": "Aftermarket Chrome Door Handle Suitable for Landcruiser 70 Series",
        "url": "/products/landcruiser-70-series-silver-door-handles",
        "type": "HTTP"
      },
      {
        "title": "Silver Stainless Steel Door Step/Sill Trims Suitable for 70 Series Landcruiser Dual Cab and 76",
        "url": "/products/silver-stainless-steel-door-step-sill-trims-suitable-for-70-series-landcruiser-dual-cab-and-76-copy",
        "type": "HTTP"
      },
      {
        "title": "Aftermarket Landcruiser Short RH Barn Door Suitable for Landcruiser 75 Series",
        "url": "/products/landcruiser-76-troop-carrier-short-rh-barn-door",
        "type": "HTTP"
      },
      {
        "title": "Landcruiser 76/Short Left Hand Barn Door",
        "url": "/products/landcruiser-door-2",
        "type": "HTTP"
      },
      {
        "title": "Aftermarket LH Barn Door Suitable for Landcruiser 40 Series",
        "url": "/products/40-series-lh-barn-door",
        "type": "HTTP"
      },
      {
        "title": "Aftermarket RH Half Door Suitable for Landcruiser 40 Series",
        "url": "/products/40-series-rh-half-door",
        "type": "HTTP"
      },
      {
        "title": "Aftermarket LH Half Door Suitable for Landcruiser 40 Series",
        "url": "/products/40-series-lh-half-door",
        "type": "HTTP"
      }
    ]
  },
  {
    "title": "About Us",
    "url": "/pages/about-us",
    "type": "HTTP",
    "items": []
  },
  {
    "title": "FAQs",
    "url": "/pages/faqs",
    "type": "HTTP",
    "items": []
  },
  {
    "title": "Contact Us",
    "url": "/pages/contact",
    "type": "HTTP",
    "items": []
  },
  {
    "title": "Restoration Services",
    "url": "https://www.ibuildcruiser.com.au",
    "type": "HTTP",
    "items": []
  },
  {
    "title": "Shop by Vehicle",
    "url": "/",
    "type": "HTTP",
    "items": [
      { "title": "40 Series", "url": "/collections/40-series", "type": "HTTP", "items": [] },
      { "title": "60 Series", "url": "/collections/60-series", "type": "HTTP", "items": [] },
      { "title": "75 Series", "url": "/collections/75-series", "type": "HTTP", "items": [] },
      { "title": "76 Series", "url": "/collections/76-series", "type": "HTTP", "items": [] },
      { "title": "79 Series", "url": "/collections/79-series", "type": "HTTP", "items": [] },
      { "title": "Hilux", "url": "/collections/hilux", "type": "HTTP", "items": [] },
      { "title": "Patrol", "url": "/collections/patrol", "type": "HTTP", "items": [] },
      { "title": "Ranger", "url": "/collections/ranger", "type": "HTTP", "items": [] },
      { "title": "D-MAX", "url": "/collections/d-max", "type": "HTTP", "items": [] },
      { "title": "BT-50", "url": "/collections/bt-50", "type": "HTTP", "items": [] }
    ]
  },
  {
    "title": "Shop by Category",
    "url": "/",
    "type": "HTTP",
    "items": [
      { "title": "Accessories", "url": "/collections/accessories", "type": "HTTP", "items": [] },
      { "title": "Doors", "url": "/collections/doors", "type": "HTTP", "items": [] },
      { "title": "Bonnets", "url": "/collections/bonnets", "type": "HTTP", "items": [] },
      { "title": "Guards & Supports", "url": "/collections/guards-and-supports", "type": "HTTP", "items": [] },
      { "title": "Tubs", "url": "/collections/tubs", "type": "HTTP", "items": [] },
      { "title": "Cabins & Supports", "url": "/collections/cabins-and-supports", "type": "HTTP", "items": [] },
      { "title": "Suspension", "url": "/collections/suspension", "type": "HTTP", "items": [] },
      { "title": "Lighting", "url": "/collections/lighting", "type": "HTTP", "items": [] },
      { "title": "Solar & Power", "url": "/collections/solar-and-power", "type": "HTTP", "items": [] },
      { "title": "Batteries", "url": "/collections/batteries", "type": "HTTP", "items": [] },
      { "title": "Fridge/Freezers", "url": "/collections/fridge-freezers", "type": "HTTP", "items": [] },
      { "title": "Interior", "url": "/collections/interior", "type": "HTTP", "items": [] },
      { "title": "Exterior", "url": "/collections/exterior", "type": "HTTP", "items": [] },
      { "title": "Camping", "url": "/collections/camping", "type": "HTTP", "items": [] }
    ]
  }
];

async function injectMenus() {
  console.log('🚀 Injecting nested options into MAIN MENU (copy)...');

  const mainMenuId = "gid://shopify/Menu/311189995811";

  try {
    const res = await client.request(UPDATE_MENU_MUTATION, { 
      variables: { 
        id: mainMenuId,
        title: "MAIN MENU (copy)",
        items: originalMainMenuItems 
      } 
    });

    if (res.data.menuUpdate.userErrors.length > 0) {
      console.error(res.data.menuUpdate.userErrors);
    } else {
      console.log(`✅ Success! Injected menus into: ${res.data.menuUpdate.menu.title}`);
    }
  } catch (error) {
    console.error(`Fatal Error:`, error.message);
  }
}

injectMenus();
