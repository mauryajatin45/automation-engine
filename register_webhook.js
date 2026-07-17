require('dotenv').config();
const { shopifyApi, ApiVersion, Session } = require('@shopify/shopify-api');
require('@shopify/shopify-api/adapters/node');

// Ensure required environment variables are set
const requiredEnvs = ['SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET', 'SHOPIFY_ACCESS_TOKEN', 'SHOP_URL'];
for (const env of requiredEnvs) {
  if (!process.env[env]) {
    console.error(`Missing required environment variable: ${env}`);
    process.exit(1);
  }
}

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

const WEBHOOK_CREATE_MUTATION = `
  mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription {
        id
        topic
        endpoint {
          __typename
          ... on WebhookHttpEndpoint {
            callbackUrl
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_WEBHOOKS_QUERY = `
  query {
    webhookSubscriptions(first: 50) {
      edges {
        node {
          id
          topic
          endpoint {
            __typename
            ... on WebhookHttpEndpoint {
              callbackUrl
            }
          }
        }
      }
    }
  }
`;

async function registerWebhook() {
  const args = process.argv.slice(2);
  let callbackUrl = args[0] || process.env.HOST;

  if (!callbackUrl) {
    console.error('❌ Error: Please specify a public URL for the webhook (e.g. node register_webhook.js https://xyz.ngrok-free.app)');
    process.exit(1);
  }

  const baseUrl = callbackUrl.replace(/\/webhooks\/products-create$/, '').replace(/\/$/, '');
  const createUrl = baseUrl + '/webhooks/products-create';
  const updateUrl = baseUrl + '/webhooks/products-update';

  console.log(`🌐 Registering webhooks pointing to:\n   - Create: ${createUrl}\n   - Update: ${updateUrl}`);

  try {
    // 1. Fetch existing webhooks
    const getRes = await client.request(GET_WEBHOOKS_QUERY);
    const existingWebhooks = getRes.data.webhookSubscriptions.edges;

    const topicsToRegister = [
      { topic: 'PRODUCTS_CREATE', url: createUrl },
      { topic: 'PRODUCTS_UPDATE', url: updateUrl }
    ];

    for (const item of topicsToRegister) {
      const existing = existingWebhooks.find(
        edge => edge.node.topic === item.topic
      );

      if (existing) {
        console.log(`⚠️ A webhook for ${item.topic} is already registered:`);
        console.log(`   ID: ${existing.node.id}`);
        console.log(`   Endpoint: ${existing.node.endpoint.callbackUrl}`);
        
        if (existing.node.endpoint.callbackUrl === item.url) {
          console.log(`✅ The registered webhook URL for ${item.topic} matches the target URL. Skipping.`);
          continue;
        }
        console.log(`🔄 The registered URL for ${item.topic} is different. Registering new endpoint...`);
      }

      // 2. Register Webhook
      const res = await client.request(WEBHOOK_CREATE_MUTATION, {
        variables: {
          topic: item.topic,
          webhookSubscription: {
            callbackUrl: item.url,
            format: 'JSON'
          }
        }
      });

      if (res.data.webhookSubscriptionCreate.userErrors.length > 0) {
        console.error(`❌ Error registering webhook for ${item.topic}:`, res.data.webhookSubscriptionCreate.userErrors);
      } else {
        const sub = res.data.webhookSubscriptionCreate.webhookSubscription;
        console.log(`✅ Success! Webhook registered successfully.`);
        console.log(`   ID: ${sub.id}`);
        console.log(`   Topic: ${sub.topic}`);
        console.log(`   Endpoint: ${sub.endpoint.callbackUrl}`);
      }
    }

  } catch (error) {
    console.error('❌ Fatal error registering webhook:', error.message);
  }
}

registerWebhook();
