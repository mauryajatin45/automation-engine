require('dotenv').config();

// Validate required environment variables at boot
const requiredEnvs = ['SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET', 'SHOPIFY_ACCESS_TOKEN', 'SHOP_URL', 'OPENAI_API_KEY', 'HOST'];
const missingEnvs = [];
for (const env of requiredEnvs) {
  if (!process.env[env]) {
    missingEnvs.push(env);
  }
}
if (missingEnvs.length > 0) {
  console.error('\n❌ FATAL CONFIGURATION ERROR: Missing required environment variables:');
  missingEnvs.forEach(env => console.error(`   - ${env}`));
  console.error('\n💡 Troubleshooting tips for Coolify / Render:');
  console.error('   1. Ensure these are defined in the "Environment Variables" tab of your service.');
  console.error('   2. Verify that they are enabled for RUNTIME (and not just Build time).');
  console.error('   3. Re-deploy the service with "Force Rebuild" or "Clear cache" to apply the changes.\n');
  process.exit(1);
}

const express = require('express');
const { shopifyApi, ApiVersion, LogSeverity, Session } = require('@shopify/shopify-api');
const { OpenAI } = require('openai');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');
require('@shopify/shopify-api/adapters/node');

// Database setup and helpers
let useMysql = false;
let dbPool = null;

async function initDb() {
  if (process.env.DB_HOST) {
    try {
      console.log('🔌 Connecting to MySQL database...');
      dbPool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME,
        port: parseInt(process.env.DB_PORT) || 3306,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
      });
      
      // Test connection and create table
      await dbPool.query(`
        CREATE TABLE IF NOT EXISTS reviewed_products (
          product_id VARCHAR(255) PRIMARY KEY,
          status VARCHAR(50) DEFAULT 'Reviewed',
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      await dbPool.query(`
        CREATE TABLE IF NOT EXISTS ai_drafts (
          product_id VARCHAR(255) PRIMARY KEY,
          draft_data LONGTEXT,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      useMysql = true;
      console.log('✅ MySQL Database initialized successfully.');
    } catch (e) {
      console.error('❌ Failed to connect to MySQL database:', e.message);
      console.log('⚠️ Falling back to local JSON status_tracker.json');
    }
  } else {
    console.log('ℹ️ No DB_HOST found. Using local JSON status_tracker.json');
  }
}

async function getReviewedProductIds() {
  if (useMysql && dbPool) {
    try {
      const [rows] = await dbPool.query('SELECT product_id FROM reviewed_products');
      return rows.map(r => r.product_id);
    } catch (err) {
      console.error('Error fetching reviewed products from MySQL:', err.message);
      return [];
    }
  } else {
    const statusTracker = readStatusTracker();
    return Object.keys(statusTracker).filter(key => statusTracker[key].status === 'Reviewed');
  }
}

async function markProductAsReviewed(productId) {
  if (useMysql && dbPool) {
    try {
      await dbPool.query(
        'INSERT INTO reviewed_products (product_id, status) VALUES (?, ?) ON DUPLICATE KEY UPDATE status = ?',
        [productId, 'Reviewed', 'Reviewed']
      );
      console.log(`💾 Product ${productId} status saved to MySQL.`);
    } catch (err) {
      console.error('Error saving reviewed product to MySQL:', err.message);
    }
  } else {
    const statusTracker = readStatusTracker();
    statusTracker[productId] = {
      status: 'Reviewed',
      timestamp: new Date().toISOString()
    };
    writeStatusTracker(statusTracker);
  }
}

const DRAFTS_FILE = path.join(__dirname, 'ai_drafts.json');

function readDrafts() {
  if (!fs.existsSync(DRAFTS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(DRAFTS_FILE, 'utf8')); }
  catch (e) { return {}; }
}
function writeDrafts(data) {
  try { fs.writeFileSync(DRAFTS_FILE, JSON.stringify(data, null, 2)); }
  catch (e) { console.error('Error writing drafts:', e.message); }
}

async function getDraft(productId) {
  if (useMysql && dbPool) {
    try {
      const [rows] = await dbPool.query('SELECT draft_data FROM ai_drafts WHERE product_id = ?', [productId]);
      if (rows.length > 0) return JSON.parse(rows[0].draft_data);
    } catch (err) { console.error('Error getting draft from MySQL:', err.message); }
  } else {
    const drafts = readDrafts();
    return drafts[productId] || null;
  }
  return null;
}

async function saveDraft(productId, data) {
  if (useMysql && dbPool) {
    try {
      await dbPool.query(
        'INSERT INTO ai_drafts (product_id, draft_data) VALUES (?, ?) ON DUPLICATE KEY UPDATE draft_data = ?',
        [productId, JSON.stringify(data), JSON.stringify(data)]
      );
      console.log(`💾 Product draft ${productId} saved to MySQL.`);
    } catch (err) { console.error('Error saving draft to MySQL:', err.message); }
  } else {
    const drafts = readDrafts();
    drafts[productId] = data;
    writeDrafts(drafts);
  }
}

async function deleteDraft(productId) {
  if (useMysql && dbPool) {
    try {
      await dbPool.query('DELETE FROM ai_drafts WHERE product_id = ?', [productId]);
    } catch (err) { console.error('Error deleting draft from MySQL:', err.message); }
  } else {
    const drafts = readDrafts();
    delete drafts[productId];
    writeDrafts(drafts);
  }
}

const { 
  enrichProduct, 
  analyzeProductWithAI, 
  buildSpecsTableHtml, 
  compileDescriptionHtml, 
  slugify, 
  requestWithRetry 
} = require('./enricher');

const app = express();
const PORT = process.env.PORT || 3000;

// Capture raw request body for Shopify webhook HMAC verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Initialize Shopify API client
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SHOPIFY_SCOPES.split(','),
  hostName: process.env.HOST.replace(/https?:\/\//, ''),
  apiVersion: ApiVersion.April26,
  isEmbeddedApp: false, // We are a standalone automation engine, not an embedded admin app
  logger: {
    level: LogSeverity.Info,
  },
});

// Offline session for Graphql Client background tasks
const session = new Session({
  id: `offline_${process.env.SHOP_URL}`,
  shop: process.env.SHOP_URL,
  state: 'offline',
  isOnline: false,
  accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
});
const client = new shopify.clients.Graphql({ session });

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Middleware: Verify Shopify Webhook HMAC Signature
function verifyShopifyWebhook(req, res, next) {
  const hmacHeader = req.headers['x-shopify-hmac-sha256'];
  if (!hmacHeader) {
    console.error('❌ Webhook rejected: Missing x-shopify-hmac-sha256 header');
    return res.status(401).send('Unauthorized');
  }

  const hash = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(req.rawBody || '')
    .digest('base64');

  if (hash === hmacHeader) {
    return next();
  }

  console.error('❌ Webhook signature verification failed');
  return res.status(401).send('Unauthorized');
}

// Serve static frontend assets from public directory
app.use(express.static(path.join(__dirname, 'public')));

const STATUS_TRACKER_FILE = path.join(__dirname, 'status_tracker.json');

function readStatusTracker() {
  if (!fs.existsSync(STATUS_TRACKER_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(STATUS_TRACKER_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function writeStatusTracker(data) {
  try {
    fs.writeFileSync(STATUS_TRACKER_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Error writing status tracker:', e.message);
  }
}

// REST API Queries & Mutations
const LIST_PRODUCTS_QUERY = `
  query listProducts($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          status
          featuredImage {
            url
          }
        }
      }
    }
  }
`;

const COUNT_PRODUCTS_QUERY = `
  query countProducts($query: String) {
    productsCount(query: $query) {
      count
    }
  }
`;

const GET_PRODUCT_DETAILS_QUERY = `
  query getProductDetails($id: ID!) {
    product(id: $id) {
      id
      title
      descriptionHtml
      status
      vendor
      productType
      tags
      seo {
        title
        description
      }
      variants(first: 10) {
        edges {
          node {
            sku
          }
        }
      }
    }
  }
`;

const UPDATE_PRODUCT_DETAILS_MUTATION = `
  mutation productUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product {
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

const SET_METAFIELDS_MUTATION = `
  mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        key
        value
      }
      userErrors {
        field
        message
      }
    }
  }
`;

// GET /api/status: Fetch all product statuses
app.get('/api/status', async (req, res) => {
  if (useMysql && dbPool) {
    try {
      const [rows] = await dbPool.query('SELECT product_id, status FROM reviewed_products');
      const statuses = {};
      rows.forEach(r => {
        statuses[r.product_id] = {
          status: r.status
        };
      });
      return res.json(statuses);
    } catch (err) {
      console.error('Error fetching status tracker from MySQL:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }
  res.json(readStatusTracker());
});

// GET /api/products: Fetch products with search and pagination support
app.get('/api/products', async (req, res) => {
  try {
    const first = parseInt(req.query.first) || 10;
    const endCursor = req.query.after || null;
    const query = req.query.search ? `title:*${req.query.search}*` : null;
    
    // Fetch limited products (e.g. 10)
    const response = await requestWithRetry(client, LIST_PRODUCTS_QUERY, { first, after: endCursor, query });
    const productsData = response.data.products;
    
    const reviewedIds = await getReviewedProductIds();

    // Format response payload
    const productsList = productsData.edges.map(edge => {
      const id = edge.node.id;
      const isReviewed = reviewedIds.includes(id);
      return {
        id,
        title: edge.node.title,
        status: edge.node.status,
        imageUrl: edge.node.featuredImage ? edge.node.featuredImage.url : null,
        isReviewed: isReviewed
      };
    });
    
    let counts = { all: 0, pending: 0, reviewed: 0 };
    
    // Fetch total count from Shopify
    try {
      const countResponse = await requestWithRetry(client, COUNT_PRODUCTS_QUERY, { query });
      counts.all = countResponse.data.productsCount ? countResponse.data.productsCount.count : 0;
    } catch (e) {
      console.log("Count query failed", e.message);
      counts.all = productsList.length; // fallback
    }
    
    // Calculate pending/reviewed accurately if no search, otherwise locally for subset
    if (!query) {
      counts.reviewed = reviewedIds.length;
      counts.pending = Math.max(0, counts.all - counts.reviewed);
    } else {
      counts.reviewed = productsList.filter(p => p.isReviewed).length;
      counts.pending = productsList.length - counts.reviewed;
      counts.all = productsList.length; 
    }

    res.json({
      products: productsList,
      pageInfo: productsData.pageInfo,
      counts: counts
    });
  } catch (error) {
    console.error('Error fetching products list:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/products/:id: Fetch specific product detail
app.get('/api/products/:id', async (req, res) => {
  try {
    const productId = `gid://shopify/Product/${req.params.id}`;
    const response = await requestWithRetry(client, GET_PRODUCT_DETAILS_QUERY, { id: productId });
    
    if (!response.data || !response.data.product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    const product = response.data.product;
    const sku = product.variants.edges[0] ? product.variants.edges[0].node.sku : '';
    
    res.json({
      id: product.id,
      title: product.title,
      descriptionHtml: product.descriptionHtml,
      status: product.status,
      vendor: product.vendor,
      productType: product.productType,
      tags: product.tags,
      sku: sku,
      seo: product.seo || { title: '', description: '' }
    });
  } catch (error) {
    console.error('Error fetching product details:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/products/:id/draft: Fetch existing AI generated draft if any
app.get('/api/products/:id/draft', async (req, res) => {
  try {
    const productId = `gid://shopify/Product/${req.params.id}`;
    const draft = await getDraft(productId);
    res.json({ draft });
  } catch (error) {
    console.error('Error fetching draft:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/products/:id/generate: Call AI model to generate preview text
app.post('/api/products/:id/generate', async (req, res) => {
  try {
    const productId = `gid://shopify/Product/${req.params.id}`;
    const response = await requestWithRetry(client, GET_PRODUCT_DETAILS_QUERY, { id: productId });
    
    if (!response.data || !response.data.product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    const product = response.data.product;
    const sku = product.variants.edges[0] ? product.variants.edges[0].node.sku : '';

    console.log(`🤖 Generating AI preview for product: "${product.title}"...`);
    const aiData = await analyzeProductWithAI(openai, product, sku);
    
    // Compile proposed description HTML using standard specifications
    const specsTableHtml = buildSpecsTableHtml(aiData.specifications, product.title);
    const compiledDescriptionHtml = compileDescriptionHtml(aiData, specsTableHtml, product.descriptionHtml);
    
    const payload = {
      id: product.id,
      aiData: aiData,
      compiledDescriptionHtml: compiledDescriptionHtml,
      seoTitle: aiData.seo_title || '',
      seoMetaDescription: aiData.seo_meta_description || ''
    };
    
    await saveDraft(product.id, payload);
    
    res.json(payload);
  } catch (error) {
    console.error('Error generating AI preview:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/products/:id/publish: Publish changes to Shopify store
app.post('/api/products/:id/publish', async (req, res) => {
  try {
    const productId = `gid://shopify/Product/${req.params.id}`;
    const { title, descriptionHtml, seoTitle, seoMetaDescription, productType, specifications, coreMetafields } = req.body;
    
    console.log(`🔄 Publishing modifications for product ID: ${productId}...`);
    
    // 1. Update title, description, and product type
    const updateInput = {
      id: productId,
      title: title,
      descriptionHtml: descriptionHtml,
      productType: productType,
      seo: {
        title: seoTitle,
        description: seoMetaDescription
      }
    };
    
    const updateResponse = await requestWithRetry(client, UPDATE_PRODUCT_DETAILS_MUTATION, { input: updateInput });
    
    if (updateResponse.data.productUpdate.userErrors.length > 0) {
      console.error(`❌ Error updating Shopify product details:`, updateResponse.data.productUpdate.userErrors);
      return res.status(400).json({ errors: updateResponse.data.productUpdate.userErrors });
    }
    
    // 2. Set Metafields
    if (coreMetafields && specifications) {
      const metafieldsPayload = [];
      
      const coreMetafieldsPayload = {
        vehicle_make: coreMetafields.vehicle_make,
        vehicle_model: coreMetafields.vehicle_model,
        vehicle_series: Array.isArray(coreMetafields.vehicle_series) ? coreMetafields.vehicle_series.join(', ') : coreMetafields.vehicle_series,
        product_department: coreMetafields.product_department,
        fitment_position: coreMetafields.fitment_position
      };
      
      for (const [key, value] of Object.entries(coreMetafieldsPayload)) {
        if (value === undefined || value === null) continue;
        metafieldsPayload.push({
          ownerId: productId,
          namespace: 'custom',
          key: key,
          value: value.toString(),
          type: 'single_line_text_field'
        });
      }
      
      for (const [key, value] of Object.entries(specifications)) {
        if (!value) continue;
        const slugifiedKey = slugify(key);
        if (['vehicle_make', 'vehicle_model', 'vehicle_series', 'product_department', 'fitment_position'].includes(slugifiedKey)) {
          continue;
        }
        metafieldsPayload.push({
          ownerId: productId,
          namespace: 'custom',
          key: slugifiedKey,
          value: value.toString(),
          type: value.toString().length > 150 ? 'multi_line_text_field' : 'single_line_text_field'
        });
      }
      
      if (metafieldsPayload.length > 0) {
        const metaResponse = await requestWithRetry(client, SET_METAFIELDS_MUTATION, { metafields: metafieldsPayload });
        if (metaResponse.data.metafieldsSet.userErrors.length > 0) {
          console.error(`❌ Error setting metafields on publish:`, metaResponse.data.metafieldsSet.userErrors);
        }
      }
    }
    
    // 3. Mark status as Reviewed
    await markProductAsReviewed(productId);
    
    // 4. Delete the AI draft
    await deleteDraft(productId);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error publishing product details:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/admin/create-smart-collection: Create a smart collection on Shopify
app.post('/api/admin/create-smart-collection', async (req, res) => {
  try {
    const { title, rules, disjunctive } = req.body;
    
    if (!title || !rules || !Array.isArray(rules)) {
      return res.status(400).json({ error: 'title and rules[] are required' });
    }

    const restClient = new shopify.clients.Rest({ session });
    const response = await restClient.post({
      path: 'smart_collections',
      data: {
        smart_collection: {
          title: title,
          rules: rules,
          disjunctive: disjunctive || false
        }
      }
    });

    console.log(`✅ Smart Collection created: "${title}"`);
    res.json({ success: true, collection: response.body.smart_collection });
  } catch (error) {
    console.error('Error creating smart collection:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/transfer-suspension', async (req, res) => {
  try {
    const GET_COLLECTIONS_RULES = `
      query {
        suspensionColl: collectionByHandle(handle: "suspension-1") {
          id
          title
          ruleSet {
            rules {
              column
              relation
              condition
            }
          }
        }
        recoveryColl: collectionByHandle(handle: "recovery-air") {
          id
          title
          ruleSet {
            rules {
              column
              relation
              condition
            }
          }
        }
      }
    `;

    console.log("🚀 Querying collection rules...");
    const rulesRes = await client.request(GET_COLLECTIONS_RULES);
    const suspensionColl = rulesRes.data.suspensionColl;
    const recoveryColl = rulesRes.data.recoveryColl;

    if (!suspensionColl || !recoveryColl) {
      return res.status(404).json({ error: 'Collections not found by handles suspension-1 and recovery-air' });
    }

    console.log("Suspension Rules:", JSON.stringify(suspensionColl.ruleSet));
    console.log("Recovery Rules:", JSON.stringify(recoveryColl.ruleSet));

    // The 4 towbar/towball products to transfer
    // Let's search for these products first to get their exact IDs and current tags/types
    const SEARCH_PRODUCTS = `
      query searchProducts($query: String!) {
        products(first: 10, query: $query) {
          edges {
            node {
              id
              title
              productType
              tags
            }
          }
        }
      }
    `;

    const PRODUCT_UPDATE = `
      mutation productUpdate($input: ProductInput!) {
        productUpdate(input: $input) {
          product {
            id
            title
            tags
            productType
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const COLLECTION_ADD = `
      mutation collectionAddProducts($id: ID!, $productIds: [ID!]!) {
        collectionAddProducts(id: $id, productIds: $productIds) {
          collection {
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

    const COLLECTION_REMOVE = `
      mutation collectionRemoveProducts($id: ID!, $productIds: [ID!]!) {
        collectionRemoveProducts(id: $id, productIds: $productIds) {
          collection {
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

    const searchRes = await client.request(SEARCH_PRODUCTS, { variables: { query: "title:towbar OR title:'tow bar' OR title:'tow ball' OR title:EFS" } });
    const allMatchingProducts = searchRes.data.products.edges.map(e => e.node);

    // Filter to the exact 4 products
    const targetTitles = [
      "TAG Heavy Duty Towbar EFS to suit Toyota LandCruiser 79 Series (Single/double cab) (08/12-on)",
      "TAG+ Heavy Duty Towbar EFS -TOYOTA LANDCRUISER UTE 75Series / 79 Series. Single Cab models only 1985-07/2012.",
      "TAG Chrome Tow Ball EFS - 50mm, 3.5 tonne",
      "TAG Tow Ball EFS Weight Scale"
    ];

    const targetProducts = allMatchingProducts.filter(p => targetTitles.includes(p.title));
    console.log(`Found ${targetProducts.length} target products to transfer.`);

    const results = [];

    // Case 1: Manual Collections
    // If ruleSet is null, the collections are manual!
    const isSuspensionManual = !suspensionColl.ruleSet;
    const isRecoveryManual = !recoveryColl.ruleSet;

    if (isSuspensionManual && isRecoveryManual) {
      console.log("ℹ️ Both collections are Manual. Using collectionAddProducts/collectionRemoveProducts...");
      const productIds = targetProducts.map(p => p.id);

      if (productIds.length > 0) {
        // Add to Recovery & Air
        const addRes = await client.request(COLLECTION_ADD, { variables: { id: recoveryColl.id, productIds } });
        // Remove from Suspension
        const removeRes = await client.request(COLLECTION_REMOVE, { variables: { id: suspensionColl.id, productIds } });
        
        results.push({
          method: "manual_transfer",
          addedTo: recoveryColl.title,
          removedFrom: suspensionColl.title,
          productIds
        });
      }
    } else {
      // Case 2: Smart Collections
      // If either collection is automated, we must modify the product properties (Tags/Types)
      // to make them fall out of the Suspension smart collection filters and into the Recovery smart collection filters.
      console.log("ℹ️ Collections are Automated/Smart. Updating product tags/types...");

      for (const p of targetProducts) {
        // Let's adjust tags:
        // 1. Remove 'Suspension'
        // 2. Add 'Recovery & Air' or 'Recovery' or 'towing' (based on Recovery collection rules, default to 'Recovery & Air' and 'Recovery')
        const originalTags = p.tags || [];
        const newTags = originalTags.filter(t => t.toLowerCase() !== 'suspension');
        
        if (!newTags.includes('Recovery & Air')) newTags.push('Recovery & Air');
        if (!newTags.includes('Recovery Gear')) newTags.push('Recovery Gear');
        if (!newTags.includes('Recovery')) newTags.push('Recovery');

        // Let's also adjust productType:
        // Change from 'EFS' or suspension-based type to 'Towing Accessories' or 'Recovery Gear'
        let newType = p.productType;
        if (p.title.includes('Towbar') || p.title.includes('Tow Ball')) {
          newType = "Recovery Gear";
        }

        console.log(`Updating "${p.title}" tags to:`, newTags, `and productType to:`, newType);
        
        const updateRes = await client.request(PRODUCT_UPDATE, {
          variables: {
            input: {
              id: p.id,
              tags: newTags,
              productType: newType
            }
          }
        });

        const errors = updateRes.data.productUpdate.userErrors;
        if (errors && errors.length > 0) {
          results.push({
            title: p.title,
            success: false,
            error: errors[0].message
          });
        } else {
          results.push({
            title: p.title,
            success: true,
            newTags,
            newType
          });
        }
      }
    }

    res.json({
      success: true,
      suspensionCollTitle: suspensionColl.title,
      recoveryCollTitle: recoveryColl.title,
      results
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Shopify Webhook: Product Created
app.post('/webhooks/products-create', verifyShopifyWebhook, (req, res) => {
  const shopifyProduct = req.body;
  if (!shopifyProduct || !shopifyProduct.id) {
    console.error('❌ Webhook received with empty or invalid body');
    return res.status(400).send('Invalid payload');
  }

  const productId = `gid://shopify/Product/${shopifyProduct.id}`;
  console.log(`📡 Webhook received for new product: ${productId} ("${shopifyProduct.title}")`);

  // Process product enrichment and categorization in the background
  enrichProduct(client, openai, productId, false)
    .then(success => {
      if (success) {
        console.log(`✅ Webhook processing completed successfully for ${productId}`);
      } else {
        console.error(`❌ Webhook processing failed for ${productId}`);
      }
    })
    .catch(err => {
      console.error(`❌ Webhook processing error for ${productId}:`, err);
    });

  // Acknowledge receipt of webhook immediately to Shopify (within 5 seconds)
  res.status(200).send('OK');
});

// Shopify Webhook: Product Updated
app.post('/webhooks/products-update', verifyShopifyWebhook, (req, res) => {
  const shopifyProduct = req.body;
  if (!shopifyProduct || !shopifyProduct.id) {
    console.error('❌ Webhook received with empty or invalid body');
    return res.status(400).send('Invalid payload');
  }

  const productId = `gid://shopify/Product/${shopifyProduct.id}`;
  console.log(`📡 Webhook received for updated product: ${productId} ("${shopifyProduct.title}")`);

  // Process product enrichment and categorization in the background
  enrichProduct(client, openai, productId, false)
    .then(success => {
      if (success) {
        console.log(`✅ Webhook processing completed successfully for updated ${productId}`);
      } else {
        console.log(`❌ Webhook processing skipped or failed for updated ${productId}`);
      }
    })
    .catch(err => {
      console.error(`❌ Webhook processing error for updated ${productId}:`, err);
    });

  // Acknowledge receipt of webhook immediately to Shopify (within 5 seconds)
  res.status(200).send('OK');
});

// OAuth: Step 1 - Begin Auth
app.get('/auth', async (req, res) => {
  try {
    const shop = req.query.shop;
    if (!shop) {
      return res.status(400).send('Missing shop parameter.');
    }
    await shopify.auth.begin({
      shop: shopify.utils.sanitizeShop(shop, true),
      callbackPath: '/auth/callback',
      isOnline: false, // We want an offline access token for background automation
      rawRequest: req,
      rawResponse: res,
    });
  } catch (error) {
    console.error('Error starting OAuth:', error);
    res.status(500).send(error.message);
  }
});

// OAuth: Step 2 - Callback
app.get('/auth/callback', async (req, res) => {
  try {
    const callbackResponse = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res,
    });

    const { session } = callbackResponse;
    console.log('App Installed Successfully!');
    console.log('Offline Access Token:', session.accessToken);
    console.log('Save this access token to query the Shopify API.');
    
    res.send('App installed successfully! Check the server logs for the access token.');
  } catch (error) {
    console.error('Error in OAuth callback:', error);
    res.status(500).send(error.message);
  }
});

app.listen(PORT, async () => {
  await initDb();
  console.log(`Server is running on port ${PORT}`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhooks/products-create`);
  console.log(`To install the app, navigate to: http://localhost:${PORT}/auth?shop=${process.env.SHOP_URL}`);
});
