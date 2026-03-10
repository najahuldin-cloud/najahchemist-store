// netlify/functions/send-receipt.js
// Sends order receipt email via Resend
// Required env var: RESEND_API_KEY

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { orderId, customerName, email, items, subtotal, deliveryFee, total, shipDetail } = JSON.parse(event.body);

    if (!email || !orderId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing email or orderId' }) };
    }

    const itemRows = (items || []).map(i => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f0ece8;">${i.name}${i.size && i.size !== '—' ? ' — ' + i.size : ''}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0ece8;text-align:center;">${i.qty}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0ece8;text-align:right;">J$${Number(i.price).toLocaleString()}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#faf8f5;font-family:Outfit,Arial,sans-serif;color:#1a1a1a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.07);">

        <!-- Header -->
        <tr><td style="background:#1a1a1a;padding:28px 32px;text-align:center;">
          <div style="font-size:1.5rem;font-weight:700;color:#fff;letter-spacing:0.04em;">Najah Chemist</div>
          <div style="color:#b8a99a;font-size:0.82rem;margin-top:4px;">Order Confirmation</div>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;font-size:1rem;">Hi <strong>${customerName || 'there'}</strong>,</p>
          <p style="margin:0 0 24px;color:#555;font-size:0.9rem;">Thank you for your order! Here's your receipt.</p>

          <!-- Order Meta -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5;border-radius:8px;margin-bottom:24px;">
            <tr>
              <td style="padding:12px 16px;font-size:0.82rem;color:#777;">Order ID</td>
              <td style="padding:12px 16px;font-size:0.82rem;font-weight:600;text-align:right;">${orderId}</td>
            </tr>
            ${shipDetail ? `<tr>
              <td style="padding:12px 16px;font-size:0.82rem;color:#777;border-top:1px solid #f0ece8;">Payment</td>
              <td style="padding:12px 16px;font-size:0.82rem;font-weight:600;text-align:right;border-top:1px solid #f0ece8;">${shipDetail}</td>
            </tr>` : ''}
          </table>

          <!-- Items -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <thead>
              <tr style="background:#f5f1ec;">
                <th style="padding:8px 12px;text-align:left;font-size:0.78rem;color:#777;font-weight:600;">Item</th>
                <th style="padding:8px 12px;text-align:center;font-size:0.78rem;color:#777;font-weight:600;">Qty</th>
                <th style="padding:8px 12px;text-align:right;font-size:0.78rem;color:#777;font-weight:600;">Price</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>

          <!-- Totals -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            ${subtotal != null ? `<tr>
              <td style="padding:6px 0;color:#777;font-size:0.88rem;">Subtotal</td>
              <td style="padding:6px 0;text-align:right;font-size:0.88rem;">J$${Number(subtotal).toLocaleString()}</td>
            </tr>` : ''}
            ${deliveryFee != null ? `<tr>
              <td style="padding:6px 0;color:#777;font-size:0.88rem;">Delivery</td>
              <td style="padding:6px 0;text-align:right;font-size:0.88rem;">${Number(deliveryFee) === 0 ? 'Included' : 'J$' + Number(deliveryFee).toLocaleString()}</td>
            </tr>` : ''}
            <tr>
              <td style="padding:10px 0 6px;font-weight:700;font-size:1rem;border-top:2px solid #1a1a1a;">Total</td>
              <td style="padding:10px 0 6px;text-align:right;font-weight:700;font-size:1rem;border-top:2px solid #1a1a1a;">J$${Number(total).toLocaleString()}</td>
            </tr>
          </table>

          <!-- Payment Instructions -->
          <div style="background:#faf8f5;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
            <div style="font-size:0.82rem;font-weight:600;margin-bottom:8px;color:#555;">Payment Options</div>
            <div style="font-size:0.82rem;color:#666;line-height:1.6;">
              NCB JMD: <strong>354-747-294</strong><br>
              NCB USD: <strong>354-747-308</strong> (Swift: JNCBJMKX)<br>
              Lynk: <strong>@najahchemist</strong>
            </div>
          </div>

          <p style="margin:0;color:#777;font-size:0.82rem;">Orders are processed within 2–3 business days after payment is confirmed. Reply to this email with your payment confirmation and we'll get started right away.</p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f5f1ec;padding:20px 32px;text-align:center;">
          <div style="font-size:0.78rem;color:#999;">
            Najah Chemist &nbsp;|&nbsp; najahchemistja.com<br>
            WhatsApp: +1 (876) 885-1099
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
        subject: `Your Najah Chemist Order — ${orderId}`,
        html
      })
    });

    const resendData = await resendRes.json();

    if (!resendRes.ok) {
      throw new Error(resendData.message || JSON.stringify(resendData));
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, id: resendData.id })
    };

  } catch (error) {
    console.error('send-receipt error:', error.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message })
    };
  }
};
