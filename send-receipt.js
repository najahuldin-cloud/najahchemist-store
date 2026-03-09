// netlify/functions/send-receipt.js
// Sends order confirmation email to customer via Resend
// Required env variable: RESEND_API_KEY

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch(e) {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { orderId, customerName, email, items, subtotal, deliveryFee, total, shipDetail } = data;

  // Don't send if no email provided
  if (!email || !email.includes('@')) {
    return { statusCode: 200, body: JSON.stringify({ skipped: true }) };
  }

  // Build items HTML
  const itemsHtml = items.map(i =>
    `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #F0EDE8;font-size:14px;color:#4B4846;">${i.name} (${i.size})</td>
      <td style="padding:8px 0;border-bottom:1px solid #F0EDE8;font-size:14px;color:#4B4846;text-align:center;">×${i.qty}</td>
      <td style="padding:8px 0;border-bottom:1px solid #F0EDE8;font-size:14px;color:#0F0E0D;text-align:right;font-weight:600;">J$${(i.price * i.qty).toLocaleString()}</td>
    </tr>`
  ).join('');

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F2ED;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

    <!-- Header -->
    <div style="background:#0F0E0D;padding:32px 36px;text-align:center;">
      <div style="display:inline-block;width:48px;height:48px;background:#25D366;border-radius:50%;line-height:48px;text-align:center;font-size:22px;margin-bottom:12px;">✓</div>
      <h1 style="color:white;font-size:22px;margin:0 0 4px;font-weight:700;">Order Received!</h1>
      <p style="color:#9CA3AF;font-size:13px;margin:0;">Thank you for ordering from Najah Chemist</p>
    </div>

    <!-- Body -->
    <div style="padding:32px 36px;">
      <p style="font-size:15px;color:#4B4846;margin:0 0 24px;">Hi <strong style="color:#0F0E0D;">${customerName}</strong>, your order has been received and is being reviewed. Please complete payment to begin processing.</p>

      <!-- Order ID -->
      <div style="background:#F5F2ED;border-radius:10px;padding:14px 18px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#8A8480;">Order ID</span>
        <span style="font-size:18px;font-weight:800;color:#0F0E0D;font-family:Georgia,serif;">${orderId}</span>
      </div>

      <!-- Items table -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <thead>
          <tr>
            <th style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#8A8480;text-align:left;padding-bottom:8px;border-bottom:2px solid #E8E4DE;">Product</th>
            <th style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#8A8480;text-align:center;padding-bottom:8px;border-bottom:2px solid #E8E4DE;">Qty</th>
            <th style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#8A8480;text-align:right;padding-bottom:8px;border-bottom:2px solid #E8E4DE;">Price</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>

      <!-- Totals -->
      <div style="border-top:2px solid #0F0E0D;padding-top:12px;margin-bottom:28px;">
        <div style="display:flex;justify-content:space-between;font-size:13px;color:#8A8480;margin-bottom:6px;">
          <span>Subtotal</span><span>J$${Number(subtotal).toLocaleString()}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:13px;color:#8A8480;margin-bottom:10px;">
          <span>Shipping (${shipDetail})</span><span>J$${Number(deliveryFee).toLocaleString()}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:17px;font-weight:800;color:#0F0E0D;">
          <span>Total</span><span>J$${Number(total).toLocaleString()}</span>
        </div>
      </div>

      <!-- Payment instructions -->
      <div style="background:#FFF3E0;border-radius:10px;padding:18px 20px;margin-bottom:28px;border-left:4px solid #B45309;">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#B45309;margin-bottom:10px;">💳 Payment Instructions</div>
        <div style="font-size:13px;color:#4B4846;line-height:1.8;">
          <strong>Bank Transfer — NCB</strong><br>
          JMD Account: <strong>354-747-294</strong><br>
          USD Account: <strong>354-747-308</strong><br>
          Account Name: <strong>Najah Chemist</strong><br>
          <br>
          <strong>Lynk:</strong> @najahchemist<br>
          <br>
          <span style="font-size:12px;color:#8A8480;">Payment required before order is processed. Send proof of payment on WhatsApp: +1 (876) 885-1099</span>
        </div>
      </div>

      <!-- Next steps -->
      <div style="font-size:13px;color:#4B4846;line-height:2;margin-bottom:28px;">
        <strong style="color:#0F0E0D;display:block;margin-bottom:6px;">What happens next:</strong>
        1️⃣ Make payment using the details above<br>
        2️⃣ Send proof of payment on WhatsApp<br>
        3️⃣ We confirm and process within 2–3 business days<br>
        4️⃣ You receive tracking info once dispatched ✅
      </div>

      <!-- CTA -->
      <div style="text-align:center;margin-bottom:8px;">
        <a href="https://wa.me/18768851099" style="display:inline-block;background:#25D366;color:white;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:14px;font-weight:700;">
          💬 Message Us on WhatsApp
        </a>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#F5F2ED;padding:20px 36px;text-align:center;">
      <p style="font-size:12px;color:#8A8480;margin:0;">Najah Chemist · Jamaica's Natural Skincare Manufacturer<br>
      <a href="https://najahchemist.netlify.app" style="color:#8A8480;">najahchemist.netlify.app</a> · @najahchemist</p>
    </div>

  </div>
</body>
</html>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Najah Chemist <orders@najahchemistja.com>',
        to: [email],
        subject: `Order Confirmed — ${orderId} | Najah Chemist`,
        html
      })
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Resend error:', err);
      return { statusCode: 500, body: JSON.stringify({ error: err }) };
    }

    return { statusCode: 200, body: JSON.stringify({ sent: true }) };

  } catch(e) {
    console.error('Send receipt failed:', e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
