require('dotenv').config();
const { OpenAI } = require('openai');
const { shopifyApi, ApiVersion, Session } = require('@shopify/shopify-api');
const fs = require('fs');
require('@shopify/shopify-api/adapters/node');
const { enrichProduct } = require('./enricher');

// Ensure required environment variables are set
const requiredEnvs = ['SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET', 'SHOPIFY_ACCESS_TOKEN', 'SHOP_URL', 'OPENAI_API_KEY'];
for (const env of requiredEnvs) {
  if (!process.env[env]) {
    console.error(`Missing required environment variable: ${env}`);
    process.exit(1);
  }
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

const GET_PRODUCTS_QUERY = `
  query getProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
        }
      }
    }
  }
`;

const dryRun = process.argv.includes('dryrun') || process.argv.includes('--dry-run');

async function runAutomation() {
  console.log(`🚀 Starting Track Auto AI Product Automation Engine (${dryRun ? 'DRY-RUN MODE' : 'COMMIT MODE'})...`);
  
  let hasNextPage = true;
  let cursor = null;
  let totalProcessed = 0;
  
  // Load processed IDs to allow resuming
  const trackerFile = 'processed_ids.json';
  let processedIds = [];
  if (fs.existsSync(trackerFile)) {
    processedIds = JSON.parse(fs.readFileSync(trackerFile, 'utf8'));
    console.log(`[Resume] Found ${processedIds.length} already processed products.`);
  }

  while (hasNextPage) {
    console.log(`\nFetching batch of products from Shopify...`);
    
    try {
      const response = await client.request(GET_PRODUCTS_QUERY, {
        variables: {
          first: 10,
          after: cursor,
        },
      });

      const edges = response.data.products.edges;
      const pageInfo = response.data.products.pageInfo;
      
      for (const edge of edges) {
        const product = edge.node;
        
        if (processedIds.includes(product.id)) {
          console.log(`⏭️ Skipping ${product.title} (already processed)`);
          continue;
        }

        console.log(`\n[${totalProcessed + 1}] Processing: "${product.title}"`);
        
        // Enrich and commit this product
        try {
          const success = await enrichProduct(client, openai, product.id, dryRun);
          
          if (success) {
            processedIds.push(product.id);
            fs.writeFileSync(trackerFile, JSON.stringify(processedIds));
            totalProcessed++;
          } else {
            console.error(`❌ Failed to enrich product ${product.id}`);
          }
        } catch (openaiError) {
          console.error(`🛑 Critical OpenAI API Error: ${openaiError.message}`);
          console.error(`Execution aborted to prevent corrupting Shopify catalog data.`);
          process.exit(1);
        }
        
        // Pacing delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      hasNextPage = pageInfo.hasNextPage;
      cursor = pageInfo.endCursor;

    } catch (error) {
      console.error('❌ Fatal Error communicating with Shopify:', error.message);
      break;
    }
  }
  
  console.log(`\n🏁 Automation Complete. Processed ${totalProcessed} products.`);
}

runAutomation().catch(console.error);
