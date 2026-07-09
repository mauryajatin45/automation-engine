const fs = require('fs');

// --- GRAPHQL QUERIES & MUTATIONS ---

const GET_PRODUCT_DETAILS = `
  query getProductDetails($id: ID!) {
    product(id: $id) {
      id
      title
      descriptionHtml
      vendor
      productType
      tags
      variants(first: 1) {
        edges {
          node {
            sku
          }
        }
      }
    }
  }
`;

const UPDATE_PRODUCT_MUTATION = `
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

const ADD_TO_COLLECTION_MUTATION = `
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

// Helper: GraphQL request with retry for temporary connection glitches
async function requestWithRetry(client, query, variables = {}, retries = 3, delayMs = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await client.request(query, { variables });
      return response;
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      console.warn(`⚠️ Shopify Request failed (Attempt ${attempt}/${retries}): ${error.message}. Retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

// Helper: Get all existing collections in Shopify
async function getExistingCollections(client) {
  const query = `
    query getCollections($first: Int!, $after: String) {
      collections(first: $first, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            id
            title
            handle
            ruleSet {
              rules {
                column
                relation
                condition
              }
            }
          }
        }
      }
    }
  `;
  let hasNextPage = true;
  let cursor = null;
  const list = [];
  while (hasNextPage) {
    const res = await requestWithRetry(client, query, { first: 250, after: cursor });
    const edges = res.data.collections.edges;
    for (const edge of edges) {
      list.push(edge.node);
    }
    hasNextPage = res.data.collections.pageInfo.hasNextPage;
    cursor = res.data.collections.pageInfo.endCursor;
  }
  return list;
}

// Helper: Slugify key for metafield mapping
function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')           // Replace spaces with _
    .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
    .replace(/\-\-+/g, '_')         // Replace multiple - or _ with single _
    .replace(/^-+/, '')             // Trim - from start
    .replace(/-+$/, '');            // Trim - from end
}

// Helper: Build HTML specifications table
function buildSpecsTableHtml(specifications, title) {
  let html = `<h3>Specifications – ${title}</h3>\n`;
  html += `<table style="width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 20px; font-size: 14px; text-align: left; font-family: sans-serif;">\n`;
  html += `  <thead>\n`;
  html += `    <tr style="background-color: #f2f2f2; border-bottom: 2px solid #ddd;">\n`;
  html += `      <th style="padding: 10px; font-weight: bold; border: 1px solid #ddd; width: 35%;">Specification</th>\n`;
  html += `      <th style="padding: 10px; font-weight: bold; border: 1px solid #ddd;">Details</th>\n`;
  html += `    </tr>\n`;
  html += `  </thead>\n`;
  html += `  <tbody>\n`;
  
  let rowIdx = 0;
  for (const [key, value] of Object.entries(specifications)) {
    if (!value) continue;
    const bgColor = rowIdx % 2 === 0 ? '#ffffff' : '#f9f9f9';
    html += `    <tr style="background-color: ${bgColor}; border-bottom: 1px solid #ddd;">\n`;
    html += `      <td style="padding: 10px; font-weight: bold; border: 1px solid #ddd;">${key}</td>\n`;
    html += `      <td style="padding: 10px; border: 1px solid #ddd;">${value}</td>\n`;
    rowIdx++;
  }
  
  html += `  </tbody>\n`;
  html += `</table>\n`;
  return html;
}

// Helper: Compile description HTML from segments
function compileDescriptionHtml(aiData, specsTableHtml) {
  let html = '';
  
  // 1. Description
  if (aiData.description_sections.short_intro) {
    html += `<h3>Description</h3>\n<p>${aiData.description_sections.short_intro}</p>\n\n`;
  }
  
  // 2. Specifications Table (inserted right after the Description)
  html += specsTableHtml + '\n';
  
  // 3. Key Features
  if (aiData.description_sections.key_features && aiData.description_sections.key_features.length > 0) {
    html += `<h3>Key Features</h3>\n<ul>\n`;
    for (const feature of aiData.description_sections.key_features) {
      html += `  <li>${feature}</li>\n`;
    }
    html += `</ul>\n\n`;
  }
  
  // 4. Compatibility
  if (aiData.description_sections.compatibility) {
    html += `<h3>Compatibility</h3>\n<p>${aiData.description_sections.compatibility}</p>\n\n`;
  }
  
  // 5. Important Fitment Notes
  if (aiData.description_sections.installation_notes) {
    html += `<h3>Important Fitment Notes</h3>\n<p>${aiData.description_sections.installation_notes}</p>\n\n`;
  }
  
  // 6. Product Specific FAQs (Accordion-ready semantic HTML)
  if (aiData.faqs && aiData.faqs.length > 0) {
    html += `<h3>Product FAQs</h3>\n<div class="faq-section" style="margin-top: 15px; margin-bottom: 20px; font-family: sans-serif;">\n`;
    for (const faq of aiData.faqs) {
      if (!faq.question || !faq.answer) continue;
      html += `  <div class="faq-item" style="margin-bottom: 15px; border-bottom: 1px solid #eee; padding-bottom: 10px;">\n`;
      html += `    <p style="font-weight: bold; margin: 0 0 5px 0; color: #333;">Q: ${faq.question}</p>\n`;
      html += `    <p style="margin: 0; color: #666;">A: ${faq.answer}</p>\n`;
      html += `  </div>\n`;
    }
    html += `</div>\n\n`;
  }
  
  return html;
}

// --- AI LOGIC ---

async function analyzeProductWithAI(openai, product, sku) {
  const prompt = `
You are an expert automotive ecommerce data specialist for 'Track Auto'.
Analyze the following product details and extract specific structured information based on our requirements.

Product Title: ${product.title}
Product Type: ${product.productType}
Vendor: ${product.vendor}
Tags: ${product.tags.join(', ')}
SKU: ${sku || 'Not specified'}
Current Description: ${product.descriptionHtml ? product.descriptionHtml.replace(/<[^>]+>/g, '') : ''}

INSTRUCTIONS:

1. "clean_title": Rewrite the title to be clean, short, customer-friendly, and optimized for SEO.
   - For aftermarket parts, use the structure: "Aftermarket [Part Name] Suitable for [Series / Model]".
   - CRITICAL: Omit manufacturer branding (like "Toyota LandCruiser" or "Nissan Patrol") from the clean title if it is aftermarket. Use only the series or clean model name.
   - Example: Instead of "Aftermarket Left Hand Rear Door for Toyota LandCruiser 60 Series", use "Aftermarket LH Rear Door Suitable for 60 Series".
   - Example: Instead of "Aftermarket DPF Bonnet for Toyota LandCruiser 79 Series V8", use "Aftermarket DPF Bonnet Suitable for 79 Series".

2. "product_type": Categorize the product into a specific standard customer-facing type / category.
   - Use clean, user-friendly, pluralized category names.
   - CRITICAL: Never use generic category names like "Accessories", "Parts", "Vehicle Parts", or "Solar" as a product_type. You must select from the following specific, descriptive category names:
     * "Doors", "Bonnets", "Guards & Supports", "Tubs", "Cabins & Supports", "Suspension", "Lighting", "Differentials & Lockers", "Recovery Gear", "Electrical", "Fridge/Freezers", "Batteries", "Solar & Power", "Camping", "Interior", "Exterior", "UHF Radios & Antennas", "Tow Balls", "Tow Ball Mounts", "Winch Accessories", "Tyre Deflators".

3. "specifications": Generate a comprehensive list of technical specifications and features for this product as a key-value object (flat JSON object). 
   - ALWAYS include "Brand" (extract or infer, default to "Track Auto" if unknown).
   - ALWAYS include "Product Name" (use the new clean_title).
   - ALWAYS include "SKU" (use the SKU provided above if available).
   - CRITICAL: Never use terms like "OEM Steel" or "OEM Plastic" for aftermarket products. Write "Pressed Steel", "ABS Plastic", or "EDP Coated Steel" instead. 
   - Extract dimensions, materials, finishes, compliance, applications, capacity, weight, or fitment details, presenting them clearly as specs.

4. "is_vehicle_specific": Boolean. Set to true if the product is specific to a particular vehicle make/model/series. Set to false if it is universal or generic (e.g. tow balls, tyre deflators, universal fridge slides).

5. "core_metafields": Populate the 5 key vehicle fitment/department fields for navigation and automated collection filters:
   - "vehicle_make": The manufacturer (e.g., "Toyota", "Nissan", "Ford", "Mahindra", "Iszuzu", "Mazda"). Set to "Universal" if is_vehicle_specific is false.
   - "vehicle_model": The model (e.g., "LandCruiser", "Hilux", "Patrol", "Ranger", "Pik Up", "BT-50"). Set to "Universal" if is_vehicle_specific is false.
   - "vehicle_series": Array of strings representing all compatible series/platforms (e.g. ["79 Series"], ["60 Series"], ["MQ", "MR"], ["Next-Gen T6.2"], ["2006 - ON"]). Set to ["Universal"] if is_vehicle_specific is false.
     * CRITICAL: If a product is compatible with multiple series (e.g., "70, 75, 78, 79 Series"), list ALL of them in this array.
   - "product_department": Top-level navigation category. You MUST select exactly one of: "Vehicle Parts" (for doors, bonnets, suspension, lighting, grilles, recovery gear), "Power & 12V" (for batteries, generators, chargers, electrical accessories), "Solar" (for solar panels, solar controllers), "Camping & Touring" (for fridges, folding chairs, camping gear).
   - "fitment_position": Location on the vehicle. Use one of: "Front Left", "Front Right", "Front", "Rear Left", "Rear Right", "Rear", "Pair", "N/A" (if not applicable).

6. "faqs": Generate exactly 3 product-specific Frequently Asked Questions (FAQs) and answers. These must address actual technical restoration, fitment, or installation concerns specific to this item (e.g. transfer of factory latches, safety catch inclusion, gas strut compatibility, hinge alignment, reuse of glass/seals, or wiring modifications). CRITICAL: Never generate basic repetition questions like "What is it made of?" or "Is it rust resistant?". Every FAQ must provide unique technical value. Do not repeat facts from the key features list.

7. "description_sections": Generate the text sections for the description:
   - "short_intro": A direct, descriptive paragraph explaining the part's build quality, material, surface finish, and primary function. Avoid marketing clichés (e.g. "Upgrade your ride", "seeking enhanced durability"). Write in the voice of an experienced Australian 4WD parts specialist.
   - "key_features": Array of 3 to 6 technical highlights (e.g., pre-tapped captured nuts, snorkel cutout details, EDP rust protection).
   - "compatibility": Clearly explain vehicle fitment, including year ranges, body types (Troopy, Ute, FRP Top, Wagon), chassis codes, and engine variants if applicable.
   - "installation_notes": Explicitly detail what components are NOT included and must be transferred from the original part (e.g., glass, window seals, regulator assembly, lock cylinders, wiper motor), and recommend professional prep and painting.
   - "seo_title": Generate a high-performance SEO Page Title. It must be strictly 70 characters or less (preferably between 50 and 65 characters) and contain the product name, key vehicle compatibilities, and brand 'Track Auto'. DO NOT exceed 70 characters.
   - "seo_meta_description": Generate a highly optimized search engine meta description. It must be strictly 160 characters or less (preferably between 120 and 150 characters) summarizing what the product is, its key fitment, and a call-to-action or selling point. DO NOT exceed 160 characters.

Return the response EXCLUSIVELY as a raw JSON object with these exact keys:
{
  "clean_title": "",
  "product_type": "",
  "specifications": {},
  "is_vehicle_specific": true/false,
  "core_metafields": {
    "vehicle_make": "",
    "vehicle_model": "",
    "vehicle_series": [],
    "product_department": "",
    "fitment_position": ""
  },
  "faqs": [
    { "question": "", "answer": "" }
  ],
  "description_sections": {
    "short_intro": "",
    "key_features": [],
    "compatibility": "",
    "installation_notes": ""
  },
  "seo_title": "",
  "seo_meta_description": ""
}
`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error(`❌ OpenAI API Error for product ${product.id}:`, error.message);
    throw error;
  }
}

// --- CORE PIPELINE EXECUTION ---

async function enrichProduct(client, openai, productId, dryRun = true) {
  console.log(`\n======================================================`);
  console.log(`🔍 Enricher: Fetching Product: ${productId}`);
  
  let product;
  try {
    const res = await requestWithRetry(client, GET_PRODUCT_DETAILS, { id: productId });
    product = res.data.product;
    if (!product) {
      console.error(`❌ Product not found: ${productId}`);
      return false;
    }
  } catch (error) {
    console.error('❌ Error fetching product details:', error.message);
    return false;
  }
  
  const sku = product.variants.edges[0]?.node?.sku || '';
  
  console.log(`🧠 Running AI Analysis and Specification generation...`);
  const aiData = await analyzeProductWithAI(openai, product, sku);
  if (!aiData) {
    console.error('❌ AI analysis failed.');
    return false;
  }
  
  console.log(`Proposed Title: "${aiData.clean_title}"`);
  console.log(`Product Type: "${aiData.product_type}"`);
  console.log(`Is Vehicle Specific: ${aiData.is_vehicle_specific}`);
  
  const specsTableHtml = buildSpecsTableHtml(aiData.specifications, aiData.clean_title);
  const newDescriptionHtml = compileDescriptionHtml(aiData, specsTableHtml);
  
  if (dryRun) {
    console.log(`⚠️ Dry run enabled. Logged changes only.`);
    console.log(`\n--- PROPOSED DESCRIPTION HTML ---`);
    console.log(newDescriptionHtml);
    console.log(`---------------------------------\n`);
    console.log(`======================================================\n`);
    return true;
  }
  
  // Backup
  const backupData = {
    id: product.id,
    timestamp: new Date().toISOString(),
    original_title: product.title,
    original_descriptionHtml: product.descriptionHtml
  };
  fs.appendFileSync('backups.jsonl', JSON.stringify(backupData) + '\n');
  
  // 1. Update Title, Description, and Native Product Type
  const updateRes = await requestWithRetry(client, UPDATE_PRODUCT_MUTATION, {
    input: {
      id: product.id,
      title: aiData.clean_title,
      descriptionHtml: newDescriptionHtml,
      productType: aiData.product_type
    }
  });
  
  if (updateRes.data.productUpdate.userErrors.length > 0) {
    console.error(`❌ Error updating title/description/type:`, updateRes.data.productUpdate.userErrors);
    return false;
  }
  console.log(`✅ Title, Description, and Product Type updated successfully.`);
  
  // 2. Set Metafields (5 Core Navigation Metafields + Specification Metafields)
  const metafieldsPayload = [];
  
  // Write the 5 Core Metafields
  const coreMetafields = {
    vehicle_make: aiData.core_metafields.vehicle_make,
    vehicle_model: aiData.core_metafields.vehicle_model,
    vehicle_series: Array.isArray(aiData.core_metafields.vehicle_series) ? aiData.core_metafields.vehicle_series.join(', ') : aiData.core_metafields.vehicle_series,
    product_department: aiData.core_metafields.product_department,
    fitment_position: aiData.core_metafields.fitment_position
  };
  
  for (const [key, value] of Object.entries(coreMetafields)) {
    if (value === undefined || value === null) continue;
    metafieldsPayload.push({
      ownerId: product.id,
      namespace: 'custom',
      key: key,
      value: value.toString(),
      type: 'single_line_text_field'
    });
  }

  // Write technical specifications
  for (const [key, value] of Object.entries(aiData.specifications)) {
    if (!value) continue;
    const slugifiedKey = slugify(key);
    // Avoid colliding with the 5 core metafield keys
    if (['vehicle_make', 'vehicle_model', 'vehicle_series', 'product_department', 'fitment_position'].includes(slugifiedKey)) {
      continue;
    }
    metafieldsPayload.push({
      ownerId: product.id,
      namespace: 'custom',
      key: slugifiedKey,
      value: value.toString(),
      type: value.toString().length > 150 ? 'multi_line_text_field' : 'single_line_text_field'
    });
  }
  
  if (metafieldsPayload.length > 0) {
    const metaRes = await requestWithRetry(client, SET_METAFIELDS_MUTATION, { metafields: metafieldsPayload });
    if (metaRes.data.metafieldsSet.userErrors.length > 0) {
      console.error(`❌ Error writing metafields:`, metaRes.data.metafieldsSet.userErrors);
    } else {
      console.log(`✅ Set ${metaRes.data.metafieldsSet.metafields.length} metafields under namespace 'custom'.`);
    }
  }
  
  console.log(`🎉 Enrichment complete for product ${productId}`);
  console.log(`======================================================\n`);
  return true;
}

module.exports = {
  enrichProduct,
  analyzeProductWithAI,
  buildSpecsTableHtml,
  compileDescriptionHtml,
  slugify,
  requestWithRetry
};
