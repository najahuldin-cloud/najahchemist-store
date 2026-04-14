// One-time script: insert 3 missing orders into Firestore
// Uses Firebase CLI OAuth token — no service account needed locally
// Run: node scripts/insert-missing-orders.js

const os = require('os');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'najah-chemist-362ad';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const TOKEN_PATH = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json');

// ── helpers ──────────────────────────────────────────────────────────────────

async function getToken() {
  const data = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  const t = data.tokens;
  if (t.expires_at - Date.now() < 5 * 60 * 1000) {
    throw new Error('Token expired — run: firebase projects:list   to refresh it, then re-run this script');
  }
  return t.access_token;
}

function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = toFirestoreValue(val);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

function toFirestoreDoc(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) fields[k] = toFirestoreValue(v);
  return { fields };
}

async function docExists(token, id) {
  // Query for existing doc with this id field
  const res = await fetch(
    `${FIRESTORE_BASE}:runQuery`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'orders' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'id' },
              op: 'EQUAL',
              value: { stringValue: id }
            }
          },
          limit: 1
        }
      })
    }
  );
  const results = await res.json();
  return results.some(r => r.document);
}

async function insertOrder(token, order) {
  const already = await docExists(token, order.id);
  if (already) {
    console.log(`SKIP (already exists): ${order.id}`);
    return;
  }
  const doc = toFirestoreDoc(order);
  const res = await fetch(`${FIRESTORE_BASE}/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(doc)
  });
  const json = await res.json();
  if (json.error) throw new Error(`Firestore error for ${order.id}: ${JSON.stringify(json.error)}`);
  console.log(`Inserted: ${order.id}`);
}

// ── order data ────────────────────────────────────────────────────────────────

const orders = [
  {
    id: 'NC-19834',
    client: 'Dawnett Toppin',
    phone: '18765273235',
    items: [
      { name: 'Yoni Oil (Without Petals) 1L Strawberry With Mint', qty: 1, price: 5500 },
      { name: '2oz Dropper Bottle (Per Unit)', qty: 16, price: 4320 },
      { name: 'Brightening Body Butter 2lbs Strawberry', qty: 1, price: 6500 },
      { name: 'Kojic & Turmeric Soap (10 Bars)', qty: 1, price: 6500 }
    ],
    product: 'Yoni Oil (Without Petals) 1L Strawberry With Mint | 2oz Dropper Bottle (Per Unit) x16 | Brightening Body Butter 2lbs Strawberry | Kojic & Turmeric Soap (10 Bars)',
    qty: 19,
    subtotal: 22820,
    deliveryLocation: 'Knutsford Express',
    shippingDetail: 'Knutsford Express',
    total: 22820,
    status: 'Pending',
    paymentStatus: 'Unpaid',
    payment: 'Unpaid',
    payMethod: 'Bank/Lynk',
    source: 'Admin Insert',
    date: new Date('2026-04-14').toLocaleString('en-JM'),
    createdAt: new Date('2026-04-14')
  },
  {
    id: 'NC-30925',
    client: 'Lisa Heath-combs',
    phone: '8768283730',
    items: [
      { name: 'Boric Acid & Probiotics Gel Wash 1L', qty: 1, price: 4200 },
      { name: 'Turmeric Only Soap (10 Bars)', qty: 1, price: 6500 },
      { name: 'VagiMist 1L Strawberry With Mint', qty: 1, price: 4600 },
      { name: 'Yoni Oil (With Petals) 1L Pineapple With Mint', qty: 1, price: 6300 }
    ],
    product: 'Boric Acid & Probiotics Gel Wash 1L | Turmeric Only Soap (10 Bars) | VagiMist 1L Strawberry With Mint | Yoni Oil (With Petals) 1L Pineapple With Mint',
    qty: 4,
    subtotal: 21600,
    deliveryLocation: 'Knutsford Express Montego Bay',
    shippingDetail: 'Knutsford Express Montego Bay',
    total: 32950,
    status: 'Pending',
    paymentStatus: 'Unpaid',
    payment: 'Unpaid',
    payMethod: 'Bank/Lynk',
    source: 'Admin Insert',
    date: new Date('2026-04-14').toLocaleString('en-JM'),
    createdAt: new Date('2026-04-14')
  },
  {
    id: 'NC-47238',
    client: 'Bryanna Taylor',
    phone: '+447845173152',
    items: [
      { name: 'Yoni Oil (Without Petals) 1L Unscented With Mint', qty: 1, price: 5500 },
      { name: 'Yoni Foaming Wash 1L Watermelon With Mint', qty: 1, price: 3550 },
      { name: 'Salicylic Acid Soap (10 Bars)', qty: 1, price: 7500 }
    ],
    product: 'Yoni Oil (Without Petals) 1L Unscented With Mint | Yoni Foaming Wash 1L Watermelon With Mint | Salicylic Acid Soap (10 Bars)',
    qty: 3,
    subtotal: 16550,
    deliveryLocation: 'Knutsford Express Montego Bay',
    shippingDetail: 'Knutsford Express Montego Bay',
    total: 17050,
    status: 'Pending',
    paymentStatus: 'Unpaid',
    payment: 'Unpaid',
    payMethod: 'Bank/Lynk',
    source: 'Admin Insert',
    date: new Date('2026-04-14').toLocaleString('en-JM'),
    createdAt: new Date('2026-04-14')
  }
];

// ── run ───────────────────────────────────────────────────────────────────────

(async () => {
  try {
    const token = await getToken();
    for (const order of orders) {
      await insertOrder(token, order);
    }
    console.log('Done.');
  } catch(e) {
    console.error('Script failed:', e);
    process.exit(1);
  }
})();
