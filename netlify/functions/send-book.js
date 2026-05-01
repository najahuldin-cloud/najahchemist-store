// netlify/functions/send-book.js
// Sends The First Sale System download link to buyer + notifies owner

const DOWNLOAD_URL = 'https://najahchemistja.com/assets/downloads/the-first-sale-system.pdf';
const OWNER_EMAIL = 'start@najahchemistja.com';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { email, name } = JSON.parse(event.body);
    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing email' }) };
    }

    const displayName = name || 'there';

    const buyerHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#faf8f5;font-family:'Outfit',Arial,sans-serif;color:#1a1a1a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.07);">

        <tr><td style="background:#0A0908;padding:28px 32px;text-align:center;">
          <div style="font-size:1.3rem;font-weight:700;color:#fff;font-family:Georgia,serif;letter-spacing:0.04em;">NAJAH CHEMIST</div>
          <div style="color:#c9a96e;font-size:0.8rem;margin-top:4px;letter-spacing:0.08em;text-transform:uppercase;">The First Sale System</div>
        </td></tr>

        <tr><td style="padding:36px 32px;">
          <p style="margin:0 0 16px;font-size:1rem;">Hi <strong>${displayName}</strong>,</p>
          <p style="margin:0 0 20px;color:#555;font-size:0.92rem;line-height:1.75;">
            Thank you for purchasing <strong>The First Sale System</strong>. Your download is ready.
          </p>

          <div style="text-align:center;margin:32px 0;">
            <a href="${DOWNLOAD_URL}"
               style="display:inline-block;background:#c9a96e;color:#fff;padding:16px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:1rem;letter-spacing:0.02em;">
              Download Your Book
            </a>
          </div>

          <p style="margin:0 0 12px;color:#555;font-size:0.88rem;line-height:1.75;">
            The PDF will open directly in your browser. Save it to your device to read anytime, on any device.
          </p>

          <div style="background:#faf8f5;border-radius:10px;padding:18px 22px;margin:24px 0;border-left:3px solid #c9a96e;">
            <p style="margin:0 0 8px;font-size:0.85rem;font-weight:700;color:#0A0908;">What's inside:</p>
            <ul style="margin:0;padding-left:18px;font-size:0.85rem;color:#555;line-height:2.1;">
              <li>The exact system Najahuldin used to get her first sale with J$5,000</li>
              <li>How to pick your first product and price it to profit</li>
              <li>Content that converts — without a big following</li>
              <li>The sales conversation framework that closes</li>
              <li>How to turn one sale into a repeating business</li>
            </ul>
          </div>

          <p style="margin:0;color:#777;font-size:0.85rem;line-height:1.7;">
            Questions? Reply to this email or WhatsApp us at <strong>+1 876-885-1099</strong>.
          </p>
        </td></tr>

        <tr><td style="background:#f5f1ec;padding:18px 32px;text-align:center;border-top:1px solid #e8e4de;">
          <div style="font-size:0.75rem;color:#999;">
            Najah Chemist &nbsp;|&nbsp; najahchemistja.com &nbsp;|&nbsp; Kingston, Jamaica
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const ownerHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;color:#1a1a1a;padding:24px;">
  <h2 style="margin:0 0 16px;">📚 New Book Sale</h2>
  <p><strong>The First Sale System</strong> was just purchased.</p>
  <table style="border-collapse:collapse;margin-top:16px;">
    <tr><td style="padding:6px 16px 6px 0;color:#777;font-size:0.88rem;">Name</td><td style="font-size:0.88rem;">${displayName}</td></tr>
    <tr><td style="padding:6px 16px 6px 0;color:#777;font-size:0.88rem;">Email</td><td style="font-size:0.88rem;">${email}</td></tr>
    <tr><td style="padding:6px 16px 6px 0;color:#777;font-size:0.88rem;">Amount</td><td style="font-size:0.88rem;font-weight:700;">J$3,999</td></tr>
  </table>
  <p style="margin-top:20px;font-size:0.85rem;color:#555;">Download link was sent automatically to the buyer.</p>
</body>
</html>`;

    const [buyerRes, ownerRes] = await Promise.all([
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Najahuldin Martin <orders@najahchemistja.com>',
          to: [email],
          subject: 'Your copy of The First Sale System is ready',
          html: buyerHtml
        })
      }),
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Najah Chemist <orders@najahchemistja.com>',
          to: [OWNER_EMAIL],
          subject: `Book sale: ${displayName} (${email})`,
          html: ownerHtml
        })
      })
    ]);

    const buyerData = await buyerRes.json();
    if (!buyerRes.ok) throw new Error(buyerData.message || JSON.stringify(buyerData));

    const ownerData = await ownerRes.json();
    console.log('send-book: buyer email sent, id:', buyerData.id, '| owner notified:', ownerRes.ok);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, id: buyerData.id })
    };

  } catch (error) {
    console.error('send-book error:', error.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message })
    };
  }
};
