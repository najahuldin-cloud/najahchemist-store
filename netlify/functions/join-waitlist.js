const { Resend } = require('resend');

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;
const PROJECT_ID = 'najah-chemist';

if (!process.env.RESEND_API_KEY) {
  console.error('RESEND_API_KEY missing');
}

const resend = new Resend(process.env.RESEND_API_KEY);

async function firestoreAdd(collection, data) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}?key=${FIREBASE_API_KEY}`;
  const fields = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string') fields[k] = { stringValue: v };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else if (typeof v === 'number') fields[k] = { integerValue: v };
    else if (v instanceof Date) fields[k] = { timestampValue: v.toISOString() };
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  return res.json();
}

async function firestoreQuery(collection, field, value) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: collection }],
      where: {
        fieldFilter: {
          field: { fieldPath: field },
          op: 'EQUAL',
          value: { stringValue: value }
        }
      }
    }
  };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

exports.handler = async (event) => {
  console.log('Waitlist function called');
  console.log('RESEND_API_KEY exists:', !!process.env.RESEND_API_KEY);

  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  try {
    const { email, productId, productName } = JSON.parse(event.body);

    if (!email || !productId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing fields' }) };
    }

    // Check for duplicate — query by email, filter productId in JS
    const existing = await firestoreQuery('waitlist', 'email', email);
    const isDuplicate = Array.isArray(existing) && existing.some(r =>
      r.document?.fields?.productId?.stringValue === productId
    );

    if (isDuplicate) {
      console.log('Duplicate entry — already on waitlist:', email, productId);
      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }

    // Save to Firestore
    console.log('Saving to Firestore...');
    await firestoreAdd('waitlist', {
      email,
      productId,
      productName,
      createdAt: new Date(),
      notified: false
    });
    console.log('Firestore save complete');

    // Send confirmation email to client
    console.log('Sending email to:', email);
    console.log('RESEND_API_KEY prefix:', process.env.RESEND_API_KEY ? process.env.RESEND_API_KEY.substring(0, 8) : 'MISSING');
    const emailResult = await resend.emails.send({
      from: 'Najah Chemist <orders@najahchemistja.com>',
      to: email,
      subject: `You're on the waitlist — ${productName}`,
      html: `
        <div style="font-family:sans-serif; max-width:520px; margin:0 auto; padding:32px 24px;">
          <img src="https://najahchemistja.com/images/logo.png" alt="Najah Chemist" style="height:48px; margin-bottom:24px;" />
          <h2 style="color:#b8860b; margin:0 0 12px;">You're on the waitlist!</h2>
          <p style="color:#333; font-size:15px; line-height:1.6;">
            Hi there! We've saved your spot for <strong>${productName}</strong>.
            The moment it's back in stock, you'll be the first to know.
          </p>
          <p style="color:#333; font-size:15px; line-height:1.6;">
            In the meantime, browse our other available products at
            <a href="https://najahchemistja.com" style="color:#b8860b;">najahchemistja.com</a>
          </p>
          <hr style="border:none; border-top:1px solid #eee; margin:24px 0;" />
          <p style="color:#999; font-size:12px;">Najah Chemist · Kingston, Jamaica · najahchemistja.com</p>
        </div>
      `
    });
    if (emailResult.error) {
      console.error('EMAIL FAILED — Resend error:', JSON.stringify(emailResult.error));
      return { statusCode: 500, body: JSON.stringify({ error: 'Email send failed', detail: emailResult.error }) };
    }
    console.log('Email sent successfully, id:', emailResult.data?.id);

    // Write a notification doc so admin can see the signup
    await firestoreAdd('notifications', {
      type: 'waitlist_signup',
      message: `New waitlist signup: ${email} wants ${productName}`,
      createdAt: new Date(),
      read: false
    });

    return { statusCode: 200, body: JSON.stringify({ success: true }) };

  } catch(e) {
    console.error('Waitlist error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
