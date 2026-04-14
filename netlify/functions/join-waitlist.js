const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { Resend } = require('resend');

if (!getApps().length) {
  initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}

if (!process.env.RESEND_API_KEY) {
  console.error('RESEND_API_KEY missing');
}

const db = getFirestore();
const resend = new Resend(process.env.RESEND_API_KEY);

exports.handler = async (event) => {
  console.log('Waitlist function called');
  console.log('RESEND_API_KEY exists:', !!process.env.RESEND_API_KEY);

  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  try {
    const { email, productId, productName } = JSON.parse(event.body);

    if (!email || !productId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing fields' }) };
    }

    // Check for duplicate
    const existing = await db.collection('waitlist')
      .where('email', '==', email)
      .where('productId', '==', productId)
      .get();

    if (!existing.empty) {
      console.log('Duplicate entry — already on waitlist:', email, productId);
      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }

    // Save to Firestore
    console.log('Saving to Firestore...');
    await db.collection('waitlist').add({
      email,
      productId,
      productName,
      createdAt: new Date(),
      notified: false
    });
    console.log('Firestore save complete');

    // Send confirmation email to client
    console.log('Sending email to:', email);
    try {
      await resend.emails.send({
        from: 'Najah Chemist <start@najahchemistja.com>',
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
      console.log('Email sent successfully');
    } catch(emailErr) {
      console.error('EMAIL FAILED:', emailErr);
    }

    // Write a notification doc so admin can see the signup
    await db.collection('notifications').add({
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
