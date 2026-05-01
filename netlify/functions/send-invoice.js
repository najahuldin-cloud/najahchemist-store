// netlify/functions/send-invoice.js
// Sends invoice email via Resend

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { to, subject, message, invoice } = JSON.parse(event.body);

    if (!to || !invoice) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing to or invoice' }) };
    }

    const inv = invoice;
    const fmtJMD = (n) => 'J$' + (parseFloat(n)||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtDate = (d) => {
      if (!d) return '—';
      const dt = new Date(d);
      if (isNaN(dt)) return String(d);
      return String(dt.getDate()).padStart(2,'0') + '/' + String(dt.getMonth()+1).padStart(2,'0') + '/' + dt.getFullYear();
    };
    const esc = (s) => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const itemRows = (inv.items||[]).map(it => {
      const rowTotal = (parseFloat(it.qty)||0) * (parseFloat(it.price)||0);
      return `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #f0ece8;font-size:0.78rem;">${esc(it.sku||'—')}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f0ece8;">${esc(it.name||'—')}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f0ece8;text-align:center;">${esc(it.size||'—')}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f0ece8;text-align:center;">${it.qty||1}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f0ece8;text-align:right;">${fmtJMD(it.price||0)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f0ece8;text-align:right;font-weight:600;">${fmtJMD(rowTotal)}</td>
      </tr>`;
    }).join('');

    const msgHtml = message ? `<p style="color:#555;font-size:0.9rem;margin-bottom:24px;">${esc(message).replace(/\n/g,'<br>')}</p>` : '';

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#faf8f5;font-family:Outfit,Arial,sans-serif;color:#1a1a1a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.07);">

        <!-- Header -->
        <tr><td style="background:#1a1a1a;padding:24px 32px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="font-size:1.3rem;font-weight:700;color:#fff;font-family:Georgia,serif;letter-spacing:0.04em;">NAJAH CHEMIST</div>
              <div style="color:#b8a99a;font-size:0.75rem;margin-top:3px;">najahchemistja.com | +1876-885-1099 | start@najahchemistja.com</div>
              <div style="color:#b8a99a;font-size:0.75rem;">Kingston, Jamaica</div>
            </div>
            <div style="text-align:right;">
              <div style="color:#B45309;font-size:1.4rem;font-weight:700;letter-spacing:0.1em;">INVOICE</div>
            </div>
          </div>
        </td></tr>

        <!-- Invoice meta -->
        <tr><td style="padding:20px 32px;background:#f5f1ec;border-bottom:1px solid #e8e4de;">
          <table width="100%">
            <tr>
              <td style="font-size:0.82rem;color:#777;">Invoice #</td>
              <td style="font-size:0.82rem;font-weight:700;text-align:right;">${esc(inv.number||'—')}</td>
            </tr>
            <tr>
              <td style="font-size:0.82rem;color:#777;padding-top:4px;">Date</td>
              <td style="font-size:0.82rem;text-align:right;padding-top:4px;">${fmtDate(inv.date)}</td>
            </tr>
            <tr>
              <td style="font-size:0.82rem;color:#777;padding-top:4px;">Due Date</td>
              <td style="font-size:0.82rem;font-weight:600;color:#DC2626;text-align:right;padding-top:4px;">${fmtDate(inv.dueDate)}</td>
            </tr>
            <tr>
              <td style="font-size:0.82rem;color:#777;padding-top:4px;">Order Type</td>
              <td style="font-size:0.82rem;text-align:right;padding-top:4px;">${esc(inv.orderType||'—')}</td>
            </tr>
          </table>
        </td></tr>

        <!-- Bill To -->
        <tr><td style="padding:20px 32px 0;">
          ${msgHtml}
          <div style="background:#faf8f5;border-radius:8px;padding:14px 18px;margin-bottom:20px;">
            <div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#777;margin-bottom:6px;">Bill To</div>
            ${inv.bizName ? `<div style="font-weight:700;font-size:0.95rem;">${esc(inv.bizName)}</div>` : ''}
            <div style="font-size:0.82rem;color:#555;margin-top:3px;">
              ${[inv.clientName, inv.phone, inv.email].filter(Boolean).map(esc).join(' &nbsp;|&nbsp; ')}
            </div>
          </div>
        </td></tr>

        <!-- Items table -->
        <tr><td style="padding:0 32px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <thead>
              <tr style="background:#1a1a1a;">
                <th style="padding:8px 10px;text-align:left;font-size:0.68rem;color:#fff;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">SKU</th>
                <th style="padding:8px 10px;text-align:left;font-size:0.68rem;color:#fff;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">Product</th>
                <th style="padding:8px 10px;text-align:center;font-size:0.68rem;color:#fff;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">Size</th>
                <th style="padding:8px 10px;text-align:center;font-size:0.68rem;color:#fff;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">Qty</th>
                <th style="padding:8px 10px;text-align:right;font-size:0.68rem;color:#fff;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">Unit Price</th>
                <th style="padding:8px 10px;text-align:right;font-size:0.68rem;color:#fff;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">Total</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>
        </td></tr>

        <!-- Totals -->
        <tr><td style="padding:16px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="max-width:280px;margin-left:auto;">
            <tr>
              <td style="padding:5px 0;color:#777;font-size:0.88rem;">Subtotal</td>
              <td style="padding:5px 0;text-align:right;font-size:0.88rem;">${fmtJMD(inv.subtotal||0)}</td>
            </tr>
            <tr>
              <td style="padding:5px 0;color:#777;font-size:0.88rem;">Shipping</td>
              <td style="padding:5px 0;text-align:right;font-size:0.88rem;">${fmtJMD(inv.shipping||0)}</td>
            </tr>
            <tr>
              <td style="padding:10px 0 6px;font-weight:700;font-size:1rem;border-top:2px solid #1a1a1a;">TOTAL</td>
              <td style="padding:10px 0 6px;text-align:right;font-weight:700;font-size:1rem;border-top:2px solid #1a1a1a;">${fmtJMD(inv.total||0)}</td>
            </tr>
          </table>
        </td></tr>

        <!-- Payment info -->
        <tr><td style="padding:0 32px 20px;">
          <div style="background:#faf8f5;border-radius:8px;padding:16px 20px;">
            <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px;color:#333;">Payment Information</div>
            <div style="font-size:0.82rem;color:#555;line-height:1.8;">
              <strong>Bank:</strong> National Commercial Bank (NCB)<br>
              <strong>Business Name:</strong> Najah Chemist<br>
              <strong>Account Type:</strong> Business/Savings<br>
              <strong>JMD Account:</strong> 354-747-294<br>
              <strong>USD Account:</strong> 354-747-308<br>
              <strong>Branch:</strong> Knuttsford Boulevard, 1-7 Knuttsford Boulevard, Kingston 5<br>
              <strong>Swift Code:</strong> JNCBJMKX<br>
              <strong>Alternative:</strong> Pay via Fygaro at <a href="https://najahchemistja.com" style="color:#B45309;">najahchemistja.com</a>
            </div>
          </div>
        </td></tr>

        <!-- Notices -->
        <tr><td style="padding:0 32px 28px;">
          <div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;color:#333;">Important Notices</div>
          <ul style="font-size:0.75rem;color:#666;padding-left:18px;line-height:1.8;margin:0;">
            <li>Payment is 100% upfront. Orders are not processed until payment is confirmed.</li>
            <li>No refunds or exchanges on manufactured products.</li>
            <li>Turnaround times: Regular 2–3 business days | Customised 5–7 business days | Custom R&amp;D 14–21 business days after sample approval — all after payment confirmation.</li>
            <li>No COD. Bank transfer or Fygaro only.</li>
            <li>Client is responsible for their own label compliance and product claims.</li>
            <li>Najah Chemist is not liable after product handover.</li>
            <li>Custom formulation R&amp;D fees are non-refundable once work begins.</li>
          </ul>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f5f1ec;padding:18px 32px;text-align:center;border-top:1px solid #e8e4de;">
          <div style="font-size:0.75rem;color:#999;">
            Najah Chemist &nbsp;|&nbsp; najahchemistja.com &nbsp;|&nbsp; WhatsApp: +1 (876) 885-1099
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
        to: [to],
        subject: subject || `Invoice ${inv.number||''} from Najah Chemist`,
        html
      })
    });

    const resendData = await resendRes.json();
    if (!resendRes.ok) throw new Error(resendData.message || JSON.stringify(resendData));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, id: resendData.id })
    };

  } catch (error) {
    console.error('send-invoice error:', error.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message })
    };
  }
};
