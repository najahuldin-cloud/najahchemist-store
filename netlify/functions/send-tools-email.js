// netlify/functions/send-tools-email.js
// Sends the tools unlock email to a lead after funnel completion
// Required env var: RESEND_API_KEY

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { name, email } = JSON.parse(event.body);
    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing email' }) };
    }

    const displayName = name || 'there';
    const calcUrl     = 'https://najahchemistja.com/calculator?unlock=true';
    const genUrl      = 'https://najahchemistja.com/generator?unlock=true';

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#faf8f5;font-family:Arial,sans-serif;color:#1a1a1a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.07);">

        <tr><td style="background:#1a1a1a;padding:28px 32px;text-align:center;">
          <div style="font-size:1.5rem;font-weight:700;color:#fff;letter-spacing:0.04em;font-family:Georgia,serif;">Najah Chemist</div>
          <div style="color:#c9a96e;font-size:0.82rem;margin-top:5px;letter-spacing:0.06em;text-transform:uppercase;">Your free brand tools are unlocked</div>
        </td></tr>

        <tr><td style="padding:36px 32px;">
          <p style="margin:0 0 10px;font-size:1rem;">Hi <strong>${displayName}</strong>,</p>
          <p style="margin:0 0 28px;color:#555;font-size:0.92rem;line-height:1.7;">
            You have unlocked two free tools to help you build your skincare brand in Jamaica.
            Click either button below to open the tool — clicking the link also unlocks both tools
            on any device you use.
          </p>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr>
              <td style="padding:0 8px 0 0;">
                <a href="${calcUrl}"
                   style="display:block;background:#c9a96e;color:white;text-align:center;padding:14px 20px;border-radius:10px;text-decoration:none;font-weight:700;font-size:0.9rem;">
                  📊 Open Profit Calculator
                </a>
              </td>
              <td style="padding:0 0 0 8px;">
                <a href="${genUrl}"
                   style="display:block;background:#1a1a1a;color:white;text-align:center;padding:14px 20px;border-radius:10px;text-decoration:none;font-weight:700;font-size:0.9rem;">
                  ✍️ Open Content Generator
                </a>
              </td>
            </tr>
          </table>

          <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdf8ef;border-radius:10px;border:1px solid #e8e2d9;margin-bottom:24px;">
            <tr>
              <td style="padding:16px 20px;">
                <p style="margin:0 0 8px;font-size:0.82rem;font-weight:700;color:#a07840;">What each tool does:</p>
                <p style="margin:0 0 6px;font-size:0.82rem;color:#374151;line-height:1.6;">
                  <strong>Profit Calculator</strong> — Enter any product, quantity, and selling price to see your exact profit margin before you order.
                </p>
                <p style="margin:0;font-size:0.82rem;color:#374151;line-height:1.6;">
                  <strong>Content Generator</strong> — Generate a professional headline, product description, key benefits, and Instagram caption for your brand in seconds.
                </p>
              </td>
            </tr>
          </table>

          <p style="margin:0;color:#888;font-size:0.82rem;line-height:1.7;">
            Questions? WhatsApp us at <strong>+1 876-885-1099</strong> or reply to this email.
          </p>
        </td></tr>

        <tr><td style="background:#f5f5f5;padding:18px 32px;text-align:center;font-size:0.75rem;color:#9ca3af;">
          Najah Chemist &middot; najahchemistja.com &middot; Kingston, Jamaica
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
        subject: 'Your Najah Chemist brand tools are ready',
        html
      })
    });

    const resendData = await resendRes.json();
    if (!resendRes.ok) {
      throw new Error(resendData.message || JSON.stringify(resendData));
    }

    console.log('send-tools-email: sent, id:', resendData.id, '| to:', email);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, id: resendData.id })
    };

  } catch (error) {
    console.error('send-tools-email error:', error.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message })
    };
  }
};
