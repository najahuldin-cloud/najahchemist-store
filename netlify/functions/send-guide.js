// netlify/functions/send-guide.js
// Sends the 24-Hour Brand Launch Guide to a lead via Resend
// Required env var: RESEND_API_KEY

const PDF_URL = 'https://najahchemistja.com/guide/24-hour-brand-launch-blueprint.pdf';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { name, email, whatsapp, branch, brandType, targetCustomer, journey, budget } = JSON.parse(event.body);
    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing email' }) };
    }

    const displayName = name || 'there';
    const pdfUrl = PDF_URL;

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0fdf4;font-family:Arial,sans-serif;color:#1a1a1a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.07);">

        <tr><td style="background:#166534;padding:28px 32px;text-align:center;">
          <div style="font-size:1.4rem;font-weight:700;color:#fff;">Najah Chemist</div>
          <div style="color:rgba(255,255,255,0.75);font-size:0.82rem;margin-top:4px;">Your Free 24-Hour Brand Launch Guide</div>
        </td></tr>

        <tr><td style="padding:32px;">
          <p style="margin:0 0 16px;font-size:1rem;">Hi <strong>${displayName}</strong>,</p>
          <p style="margin:0 0 20px;color:#555;font-size:0.92rem;line-height:1.7;">
            Thank you for your interest in starting your own brand with Najah Chemist!
            Here is your free <strong>24-Hour Brand Launch Blueprint</strong> — a step-by-step guide
            to getting your first products market-ready fast.
          </p>

          <div style="text-align:center;margin:28px 0;">
            <a href="${pdfUrl}"
               style="display:inline-block;background:#166534;color:white;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:0.95rem;">
              📥 Download Your Free Guide
            </a>
          </div>

          <div style="background:#f0fdf4;border-radius:10px;padding:18px 20px;margin-bottom:24px;">
            <p style="margin:0 0 10px;font-size:0.85rem;font-weight:700;color:#166534;">What's inside:</p>
            <ul style="margin:0;padding-left:18px;font-size:0.85rem;color:#374151;line-height:2;">
              <li>How to launch a brand in 24 hours</li>
              <li>Which products to start with</li>
              <li>Pricing and profit breakdown</li>
              <li>Private labelling options</li>
              <li>How to start selling online immediately</li>
            </ul>
          </div>

          <p style="margin:0 0 8px;color:#555;font-size:0.88rem;line-height:1.7;">
            Our team will also reach out on WhatsApp shortly with personalised product
            recommendations tailored to your brand.
          </p>
          <p style="margin:0;color:#555;font-size:0.88rem;">
            Questions? Reply to this email or WhatsApp us at <strong>+1 876-885-1099</strong>.
          </p>
        </td></tr>

        <tr><td style="background:#f5f5f5;padding:20px 32px;text-align:center;">
          <div style="font-size:0.75rem;color:#9ca3af;">
            Najah Chemist &nbsp;·&nbsp; najahchemistja.com &nbsp;·&nbsp; Kingston, Jamaica
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Najah Chemist <orders@najahchemistja.com>',
        to: [email],
        subject: 'Your Free 24-Hour Brand Launch Guide — Najah Chemist',
        html
      })
    });

    const resendData = await resendRes.json();
    console.error('send-guide: Resend status', resendRes.status, '| body:', JSON.stringify(resendData));
    if (!resendRes.ok) {
      throw new Error(resendData.message || JSON.stringify(resendData));
    }

    console.log('send-guide: accepted by Resend, id:', resendData.id, '| to:', email, '| from: orders@najahchemistja.com');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, emailSent: true, pdfUrl: pdfUrl, id: resendData.id })
    };

  } catch (error) {
    console.error('send-guide error:', error.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message })
    };
  }
};
