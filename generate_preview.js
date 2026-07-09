require('dotenv').config();
const { OpenAI } = require('openai');
const { shopifyApi, ApiVersion, Session } = require('@shopify/shopify-api');
const fs = require('fs');
require('@shopify/shopify-api/adapters/node');

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

const GET_PRODUCTS_QUERY = `
  query getProducts($first: Int!) {
    products(first: $first) {
      edges {
        node {
          id
          title
          descriptionHtml
          vendor
          productType
          tags
        }
      }
    }
  }
`;

async function analyzeProductWithAI(product) {
  const prompt = `
You are an expert automotive ecommerce data specialist for 'Track Auto'.
Analyze the following product details and extract specific structured information based on our requirements.

Product Title: ${product.title}
Product Type: ${product.productType}
Vendor: ${product.vendor}
Tags: ${product.tags.join(', ')}
Current Description: ${product.descriptionHtml.replace(/<[^>]+>/g, '')} 

INSTRUCTIONS:
1. "clean_title": Rewrite the title to be clean and customer-friendly but CRITICALLY MAINTAIN the Vehicle Make and Model for SEO purposes. Use "Suitable for" if it is an aftermarket part. Example: Instead of "Aftermarket Left Hand Rear Door for Toyota LandCruiser 60 Series", use "Aftermarket LH Rear Door Suitable for Toyota LandCruiser 60 Series".
2. "vehicle_make": (e.g., Toyota, Nissan, Ford, Universal)
3. "vehicle_model": (e.g., LandCruiser, Hilux, Patrol, Universal)
4. "vehicle_series": (e.g., 60 Series, 75 Series, 79 Series, GU Patrol, Universal)
5. "product_department": (e.g., Power & 12V, Solar, Camping & Touring, Vehicle Parts)
6. "fitment_position": (e.g., Front Left, Rear Right, Front, Pair, N/A)
7. "start_year": The starting year of vehicle fitment (e.g., "1990"). Return null if not specified.
8. "end_year": The ending year of vehicle fitment (e.g., "2007"). Return null if not specified.
9. "chassis_type": The chassis or body type (e.g., Ute, Wagon, Troopy, Dual Cab). Return null if not specified.
10. "engine_code": The engine code or type (e.g., 1VD-FTV, 1HZ, TD42, ZD30). Return null if not specified.
11. "trim_badge": The specific trim level or badge (e.g., Workmate, GXL, SR5, Wildtrak). Return null if not specified.
12. "transmission": The transmission type (e.g., Manual, Automatic). Return null if not specified.
13. "new_description_html": Generate a high-converting HTML description following this exact template:
   <h3>Short Intro</h3><p>[Explain what the product is and who it is suitable for]</p>
   <h3>Key Features</h3><ul><li>[Feature 1]</li><li>[Feature 2]</li>...</ul>
   <h3>Compatibility</h3><p>[Clearly explain vehicle fitment, including year ranges, chassis types, engines, and trims if applicable]</p>
   <h3>Installation Notes</h3><p>[Explain minor adjustments, wiring, trimming, etc.]</p>
   <h3>Why Buy From Track Auto</h3><ul><li>Fair pricing</li><li>Quality aftermarket parts</li><li>Australia-wide shipping</li><li>Helpful fitment support</li><li>Built for real 4WD owners</li></ul>

Return the response EXCLUSIVELY as a raw JSON object with these exact keys:
{
  "clean_title": "",
  "vehicle_make": "",
  "vehicle_model": "",
  "vehicle_series": "",
  "product_department": "",
  "fitment_position": "",
  "start_year": "",
  "end_year": "",
  "chassis_type": "",
  "engine_code": "",
  "trim_badge": "",
  "transmission": "",
  "new_description_html": ""
}
`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });
    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error(`❌ OpenAI API Error:`, error.message);
    return null;
  }
}

async function runPreview() {
  console.log('🚀 Generating Preview for 10 Sample Products...');
  
  // Create HTML Report foundation
  let htmlReport = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>Track Auto - AI Catalog Preview</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; background-color: #f4f6f8; }
      h1 { text-align: center; color: #333; }
      .product-card { background: white; border-radius: 8px; padding: 20px; margin-bottom: 30px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
      .grid { display: flex; gap: 20px; }
      .col { flex: 1; padding: 15px; border: 1px solid #ddd; border-radius: 5px; }
      .old { background-color: #fff0f0; }
      .new { background-color: #f0fff0; }
      .metafields { background-color: #f0f8ff; margin-top: 15px; padding: 15px; border-radius: 5px; }
      .meta-tag { display: inline-block; background: #0056b3; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; margin: 2px; }
    </style>
  </head>
  <body>
    <h1>Track Auto - AI Title & Description Preview (Sample)</h1>
    <p style="text-align:center;">Review the Original data against the proposed AI-generated data before approving the final automation.</p>
  `;

  try {
    const response = await client.request(GET_PRODUCTS_QUERY, {
      variables: { first: 10 },
    });

    const products = response.data.products.edges.map(edge => edge.node);
    
    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      console.log(`[${i+1}/10] Analyzing: ${product.title}`);
      
      const aiData = await analyzeProductWithAI(product);
      
      if (aiData) {
        htmlReport += `
        <div class="product-card">
          <div class="grid">
            <div class="col old">
              <h3 style="color:#d9534f;">ORIGINAL</h3>
              <h4>${product.title}</h4>
              <hr>
              ${product.descriptionHtml || '<em>No description</em>'}
            </div>
            <div class="col new">
              <h3 style="color:#5cb85c;">AI GENERATED</h3>
              <h4>${aiData.clean_title}</h4>
              <hr>
              ${aiData.new_description_html}
            </div>
          </div>
          <div class="metafields">
            <strong>Extracted Metafields for Categorization:</strong><br>
            <span class="meta-tag">Make: ${aiData.vehicle_make}</span>
            <span class="meta-tag">Model: ${aiData.vehicle_model}</span>
            <span class="meta-tag">Series: ${aiData.vehicle_series}</span>
            <span class="meta-tag">Department: ${aiData.product_department}</span>
            <span class="meta-tag">Position: ${aiData.fitment_position}</span>
            <span class="meta-tag">Year: ${aiData.start_year}-${aiData.end_year}</span>
            <span class="meta-tag">Chassis: ${aiData.chassis_type}</span>
            <span class="meta-tag">Engine: ${aiData.engine_code}</span>
            <span class="meta-tag">Trim: ${aiData.trim_badge}</span>
            <span class="meta-tag">Transmission: ${aiData.transmission}</span>
          </div>
        </div>
        `;
      }
      
      // Delay to avoid hitting OpenAI limits
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    
    htmlReport += `</body></html>`;
    
    fs.writeFileSync('preview_report.html', htmlReport);
    console.log(`\n✅ Preview generated successfully! Saved to preview_report.html`);
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

runPreview();
