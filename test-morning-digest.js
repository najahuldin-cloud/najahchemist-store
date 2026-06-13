/**
 * test-morning-digest.js
 * Fires a WhatsApp text message using WHATSAPP_SYSTEM_TOKEN
 * exactly as morningDigest does — confirms token migration end-to-end
 */

const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

const PROJECT_ID = 'najah-chemist';
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID || ''; // set below if needed
const TO_NUMBER = '18768851099'; // your admin WhatsApp

async function getSecret(secretName) {
  const client = new SecretManagerServiceClient();
  const [version] = await client.accessSecretVersion({
    name: `projects/${PROJECT_ID}/secrets/${secretName}/versions/latest`,
  });
  return version.payload.data.toString('utf8').trim();
}

async function main() {
  console.log('🔐 Fetching WHATSAPP_SYSTEM_TOKEN from Secret Manager...');
  const token = await getSecret('WHATSAPP_SYSTEM_TOKEN');
  console.log('✅ Token fetched — length:', token.length);

  // Get phone ID — also from secret manager or hardcode if you know it
  let phoneId = WHATSAPP_PHONE_ID;
  if (!phoneId) {
    console.log('📱 Fetching WHATSAPP_PHONE_ID from Secret Manager...');
    try {
      phoneId = await getSecret('WHATSAPP_PHONE_ID');
    } catch {
      console.error('❌ WHATSAPP_PHONE_ID not found in Secret Manager. Set it in the script.');
      process.exit(1);
    }
  }
  console.log('✅ Phone ID:', phoneId);

  const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;

  const body = {
    messaging_product: 'whatsapp',
    to: TO_NUMBER,
    type: 'text',
    text: {
      body: '🧪 [TEST] morningDigest token test fired manually — WHATSAPP_SYSTEM_TOKEN confirmed working.'
    }
  };

  console.log(`📤 Sending to ${TO_NUMBER} via ${url}...`);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (res.ok) {
    console.log('✅ MESSAGE SENT — token migration confirmed end-to-end');
    console.log('Response:', JSON.stringify(data, null, 2));
  } else {
    console.error('❌ FAILED — token or phone ID issue');
    console.error('Status:', res.status);
    console.error('Response:', JSON.stringify(data, null, 2));
  }
}

main().catch(console.error);
