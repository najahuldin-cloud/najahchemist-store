const { Resend } = require('resend');

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const PROJECT_ID = 'najah-chemist';
const resend = new Resend(process.env.RESEND_API_KEY);

async function firestoreList(col) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${col}?key=${FIREBASE_API_KEY}&pageSize=1000`;
  const res = await fetch(url);
  const data = await res.json();
  return Array.isArray(data.documents) ? data.documents : [];
}

async function firestoreQuery(col, field, value) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: col }],
      where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } }
    }})
  });
  const data = await res.json();
  return Array.isArray(data) ? data.filter(r => r.document).map(r => r.document) : [];
}

function str(doc, field) {
  return doc.fields?.[field]?.stringValue || '';
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  try {
    const { productId, productName } = JSON.parse(event.body);
    if (!productId || !productName) return { statusCode: 400, body: JSON.stringify({ error: 'Missing productId or productName' }) };

    const emails = new Set();

    // 1. Leads
    try {
      const docs = await firestoreList('leads');
      docs.forEach(d => { const e = str(d, 'email'); if (e.includes('@')) emails.add(e.toLowerCase()); });
    } catch(e) { console.warn('leads failed:', e.message); }

    // 2. Clients
    try {
      const docs = await firestoreList('clients');
      docs.forEach(d => { const e = str(d, 'email'); if (e.includes('@')) emails.add(e.toLowerCase()); });
    } catch(e) { console.warn('clients failed:', e.message); }

    // 3. Orders — match product field or client email where order contains product
    try {
      const docs = await firestoreList('orders');
      docs.forEach(d => {
        const prod  = str(d, 'product');
        const email = str(d, 'email') || str(d, 'clientEmail');
        if (email.includes('@') && (prod === productId || prod === productName)) {
          emails.add(email.toLowerCase());
        }
      });
    } catch(e) { console.warn('orders failed:', e.message); }

    // 4. Waitlist for this product
    try {
      const docs = await firestoreQuery('waitlist', 'productId', productId);
      docs.forEach(d => { const e = str(d, 'email'); if (e.includes('@')) emails.add(e.toLowerCase()); });
    } catch(e) { console.warn('waitlist failed:', e.message); }

    const emailList = [...emails];
    const productUrl = `https://najahchemistja.com/?openProduct=${productId}`;
    let sent = 0;

    for (const email of emailList) {
      try {
        await resend.emails.send({
          from: 'Najah Chemist <orders@najahchemistja.com>',
          to: email,
          subject: `${productName} is back in stock at Najah Chemist`,
          html: `
            <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
              <h2 style="color:#b8860b;margin:0 0 12px;">Great news — it's back! 🎉</h2>
              <p style="color:#333;font-size:15px;line-height:1.6;">
                <strong>${productName}</strong> is back in stock and ready to order.
                Don't wait — stock is limited and others are watching too.
              </p>
              <a href="${productUrl}"
                 style="display:inline-block;margin:20px 0;padding:14px 28px;background:#b8860b;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:15px;">
                Order Now →
              </a>
              <p style="color:#666;font-size:13px;line-height:1.6;">
                Questions? WhatsApp us at <a href="https://wa.me/18768851099" style="color:#b8860b;">+1 876-885-1099</a>
              </p>
              <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
              <p style="color:#999;font-size:12px;">Najah Chemist · Kingston, Jamaica · najahchemistja.com</p>
            </div>`
        });
        sent++;
      } catch(e) { console.warn('email failed for', email, e.message); }
    }

    // WhatsApp summary to owner
    try {
      const msg = encodeURIComponent(
        `✅ Restock alert fired: *${productName}* is back in stock. ${sent} people notified by email. Handle WhatsApp broadcast manually if needed.`
      );
      await fetch(`https://api.callmebot.com/whatsapp.php?phone=18768851099&text=${msg}&apikey=9757849`);
    } catch(e) { console.warn('WhatsApp failed:', e.message); }

    return { statusCode: 200, body: JSON.stringify({ success: true, count: sent }) };

  } catch(e) {
    console.error('send-restock-bulk error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
