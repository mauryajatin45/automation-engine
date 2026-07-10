require('dotenv').config();
const { shopifyApi, ApiVersion, Session } = require('@shopify/shopify-api');
const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
require('@shopify/shopify-api/adapters/node');
const { 
  analyzeProductWithAI, 
  buildSpecsTableHtml, 
  compileDescriptionHtml, 
  requestWithRetry 
} = require('./enricher');

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
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const FETCH_ALL_PRODUCTS = `
  query getAllProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          descriptionHtml
          vendor
          productType
          tags
          variants(first: 5) {
            edges {
              node {
                sku
              }
            }
          }
        }
      }
    }
  }
`;

async function main() {
  console.log('📡 Fetching catalog to locate the requested target product...');
  let hasNextPage = true;
  let cursor = null;
  const allProducts = [];
  
  try {
    while (hasNextPage) {
      const response = await requestWithRetry(client, FETCH_ALL_PRODUCTS, { first: 50, after: cursor });
      const data = response.data.products;
      allProducts.push(...data.edges.map(e => e.node));
      hasNextPage = data.pageInfo.hasNextPage;
      cursor = data.pageInfo.endCursor;
    }
    console.log(`✅ Loaded ${allProducts.length} total products.`);
    
    // Find the target product: "TAG Chrome Tow Ball EFS - 50mm, 3.5 tonne"
    // We will do a fuzzy match (case-insensitive) on "TAG Chrome Tow Ball"
    const titlesToFind = [
      "TAG Chrome Tow Ball EFS - 50mm, 3.5 tonne",
      "Aftermarket Side Step Bracket Suitable for 40 Series Landcruiser",
      "Aftermarket Sandy Taupe Colour Coded Grille Suitable for Landcruiser 79 Series",
      "Oricom 2-in-1 All-Terrain UHF CB Antenna for low/high gain (3dbi/6.5dbi) ANU806AT",
      "ABS Floor Mats for Toyota LandCruiser 79 Series Single Cab"
    ];
    
    const selected = [];
    titlesToFind.forEach(title => {
      const prod = allProducts.find(p => p.title.toLowerCase().includes(title.toLowerCase().split(' - ')[0].trim().substring(0, 30)));
      if (prod) {
        selected.push(prod);
      }
    });
    
    // Fallback if some aren't matched
    if (selected.length < 5) {
      const missingCount = 5 - selected.length;
      const candidates = allProducts.filter(p => !selected.map(s => s.id).includes(p.id));
      const shuffled = candidates.sort(() => 0.5 - Math.random());
      for (let i = 0; i < Math.min(shuffled.length, missingCount); i++) {
        selected.push(shuffled[i]);
      }
    }
    
    console.log(`🔄 Selected ${selected.length} products to process:`);
    selected.forEach((p, idx) => console.log(`  ${idx+1}. "${p.title}"`));
    
    // Open markdown output files
    const localMarkdownFile = 'original_vs_proposed_5_products.md';
    const artifactDir = 'C:\\Users\\Bhavin Kapadiya\\.gemini\\antigravity\\brain\\1c836e4a-8fb0-4ce0-8b23-0b889457605b';
    const artifactMarkdownFile = path.join(artifactDir, 'original_vs_proposed_5_products.md');
    
    let mdContent = `# AI Copy Generation Preview Report - 5 Products\n\n`;
    mdContent += `This report lists the original descriptions side-by-side with the newly generated AI layouts (featuring updated headers: **Short Intro** instead of Description, and **Specifications** instead of the title suffix), along with optimized SEO Titles and Meta Descriptions.\n\n`;
    mdContent += `> [!IMPORTANT]\n`;
    mdContent += `> **No changes have been pushed to your Shopify Store.** This is a local sandbox report for verification.\n\n`;
    mdContent += `----\n\n`;
    
    for (let i = 0; i < selected.length; i++) {
      const product = selected[i];
      const sku = product.variants.edges[0]?.node?.sku || 'Not specified';
      
      console.log(`\n🤖 [${i+1}/${selected.length}] Running AI on "${product.title}"...`);
      const aiData = await analyzeProductWithAI(openai, product, sku);
      
      const specsTableHtml = buildSpecsTableHtml(aiData.specifications, product.title);
      const compiledDescriptionHtml = compileDescriptionHtml(aiData, specsTableHtml, product.descriptionHtml);
      
      mdContent += `## Product ${i+1}: ${product.title}\n\n`;
      mdContent += `*   **Shopify Product ID**: \`${product.id}\`\n`;
      mdContent += `*   **SKU**: \`${sku}\`\n\n`;
      
      mdContent += `### Search Engine Listing (SEO)\n\n`;
      mdContent += `*   **Proposed SEO Title (Max 70 chars)**: \`${aiData.seo_title || ''}\` (Length: ${aiData.seo_title ? aiData.seo_title.length : 0} characters)\n`;
      mdContent += `*   **Proposed Meta Description (Max 160 chars)**: \`${aiData.seo_meta_description || ''}\` (Length: ${aiData.seo_meta_description ? aiData.seo_meta_description.length : 0} characters)\n\n`;
      
      mdContent += `### Description Comparison\n\n`;
      mdContent += `\`\`\`carousel\n`;
      mdContent += `#### Original Description (Current Shopify)\n\n`;
      mdContent += `${product.descriptionHtml || '*No description set.*'}\n`;
      mdContent += `<!-- slide -->\n`;
      mdContent += `#### Proposed Description (AI Output)\n\n`;
      mdContent += `${compiledDescriptionHtml}\n`;
      mdContent += `\`\`\`\n\n`;
      mdContent += `----\n\n`;
    }
    
    // Save to files
    fs.writeFileSync(localMarkdownFile, mdContent);
    console.log(`✅ Saved report locally to ${localMarkdownFile}`);
    
    if (fs.existsSync(artifactDir)) {
      fs.writeFileSync(artifactMarkdownFile, mdContent);
      console.log(`✅ Saved report to Artifacts directory: ${artifactMarkdownFile}`);
    }
    
  } catch (error) {
    console.error('❌ Error during report generation:', error.message);
  }
}

main();
