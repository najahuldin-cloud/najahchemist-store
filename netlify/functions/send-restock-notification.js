const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { Resend } = require('resend');

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: "najah-chemist",
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    })
  });
}

const db = getFirestore();
const resend = new Resend(process.env.RESEND_API_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  try {
    const { email, productName, productId } = JSON.parse(event.body);

    // Send restock email
    await resend.emails.send({
      from: 'Najah Chemist <start@najahchemistja.com>',
      to: email,
      subject: `${productName} is back in stock! 🎉`,
      html: `
        <div style="font-family:sans-serif; max-width:520px; margin:0 auto; padding:32px 24px;">
          <img src="https://najahchemistja.com/images/logo.png" alt="Najah Chemist" style="height:48px; margin-bottom:24px;" />
          <h2 style="color:#b8860b; margin:0 0 12px;">Great news — it's back! 🎉</h2>
          <p style="color:#333; font-size:15px; line-height:1.6;">
            <strong>${productName}</strong> is back in stock and ready to order.
            Don't wait — stock is limited and others are watching too.
          </p>
          <a href="https://najahchemistja.com"
             style="display:inline-block; margin:20px 0; padding:14px 28px; background:#b8860b; color:#fff; text-decoration:none; border-radius:6px; font-weight:600; font-size:15px;">
            Order Now →
          </a>
          <p style="color:#666; font-size:13px; line-height:1.6;">
            Questions? WhatsApp us at <a href="https://wa.me/18768851099" style="color:#b8860b;">+1 876-885-1099</a>
          </p>
          <hr style="border:none; border-top:1px solid #eee; margin:24px 0;" />
          <p style="color:#999; font-size:12px;">Najah Chemist · Kingston, Jamaica · najahchemistja.com</p>
        </div>
      `
    });

    // Log notification in Firestore
    await db.collection('notifications').add({
      type: 'restock_notified',
      message: `Restock email sent to ${email} for ${productName}`,
      productId,
      createdAt: new Date(),
      read: false
    });

    return { statusCode: 200, body: JSON.stringify({ success: true }) };

  } catch(e) {
    console.error('Restock notification error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
