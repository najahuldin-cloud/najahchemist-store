// netlify/functions/notify-lead.js
// Sends an internal email notification when a new lead is captured on /start
// Required env var: RESEND_API_KEY

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body);
    const { name, whatsapp, email, branch, brandType, budget, hearAboutUs, answers } = body;

    const displayName     = name        || '—';
    const displayWA       = whatsapp    || '—';
    const displayEmail    = email       || '—';
    const displayBrand    = brandType   || (Array.isArray(answers) && answers[0]) || (branch === 'existing' ? 'Existing seller' : '—');
    const displayBudget   = budget      || '—';
    const displaySource   = hearAboutUs || '—';
    const displayBranch   = branch      || '—';
    const displayAnswers  = Array.isArray(answers) && answers.length ? answers.join(' → ') : '—';
    const displayDate     = new Date().toLocaleString('en-US', { timeZone: 'America/Jamaica', dateStyle: 'medium', timeStyle: 'short' });

    const subject = `New Lead — ${displayName} wants to start a ${displayBrand} brand`;

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0fdf4;font-family:Arial,sans-serif;color:#1a1a1a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.07);">

        <tr><td style="background:#166534;padding:24px 32px;">
          <div style="font-size:1.1rem;font-weight:700;color:#fff;">🔔 New Lead — najahchemistja.com/start</div>
          <div style="font-size:0.8rem;color:rgba(255,255,255,0.75);margin-top:4px;">${displayDate} (Jamaica time)</div>
        </td></tr>

        <tr><td style="padding:32px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              <td style="padding:10px 12px;background:#f9fafb;font-size:0.8rem;color:#6b7280;width:38%;border-radius:6px 0 0 0;">Name</td>
              <td style="padding:10px 12px;background:#f9fafb;font-size:0.92rem;font-weight:700;border-radius:0 6px 0 0;">${displayName}</td>
            </tr>
            <tr>
              <td style="padding:10px 12px;font-size:0.8rem;color:#6b7280;border-top:1px solid #f3f4f6;">WhatsApp</td>
              <td style="padding:10px 12px;font-size:0.92rem;font-weight:700;border-top:1px solid #f3f4f6;">${displayWA}</td>
            </tr>
            <tr>
              <td style="padding:10px 12px;background:#f9fafb;font-size:0.8rem;color:#6b7280;">Email</td>
              <td style="padding:10px 12px;background:#f9fafb;font-size:0.92rem;">${displayEmail}</td>
            </tr>
            <tr>
              <td style="padding:10px 12px;font-size:0.8rem;color:#6b7280;border-top:1px solid #f3f4f6;">Brand Type</td>
              <td style="padding:10px 12px;font-size:0.92rem;border-top:1px solid #f3f4f6;">${displayBrand}</td>
            </tr>
            <tr>
              <td style="padding:10px 12px;background:#f9fafb;font-size:0.8rem;color:#6b7280;">Budget</td>
              <td style="padding:10px 12px;background:#f9fafb;font-size:0.92rem;">${displayBudget}</td>
            </tr>
            <tr>
              <td style="padding:10px 12px;font-size:0.8rem;color:#6b7280;border-top:1px solid #f3f4f6;">Source</td>
              <td style="padding:10px 12px;font-size:0.92rem;border-top:1px solid #f3f4f6;">${displaySource}</td>
            </tr>
            <tr>
              <td style="padding:10px 12px;background:#f9fafb;font-size:0.8rem;color:#6b7280;">Path</td>
              <td style="padding:10px 12px;background:#f9fafb;font-size:0.92rem;">${displayBranch}</td>
            </tr>
            <tr>
              <td style="padding:10px 12px;font-size:0.8rem;color:#6b7280;border-top:1px solid #f3f4f6;">Chatbot Answers</td>
              <td style="padding:10px 12px;font-size:0.88rem;border-top:1px solid #f3f4f6;color:#374151;">${displayAnswers}</td>
            </tr>
          </table>

          <div style="margin-top:28px;padding:16px;background:#dcfce7;border-radius:10px;">
            <p style="margin:0 0 12px;font-size:0.88rem;font-weight:600;color:#166534;">Reply to this lead now:</p>
            <a href="https://wa.me/${(whatsapp || '').replace(/\D/g, '')}?text=${encodeURIComponent('Hi! I\'m from Najah Chemist — I saw your interest in starting a brand. How can I help you today?')}"
               style="display:inline-block;background:#166534;color:white;padding:11px 22px;border-radius:8px;text-decoration:none;font-weight:700;font-size:0.88rem;margin-right:10px;">
              WhatsApp Them
            </a>
          </div>
        </td></tr>

        <tr><td style="background:#f5f5f5;padding:16px 32px;text-align:center;font-size:0.75rem;color:#9ca3af;">
          Najah Chemist · najahchemistja.com/start
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
        to: ['start@najahchemistja.com'],
        subject,
        html
      })
    });

    const resendData = await resendRes.json();
    if (!resendRes.ok) {
      throw new Error(resendData.message || JSON.stringify(resendData));
    }

    console.log('notify-lead: email sent, id:', resendData.id);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, id: resendData.id })
    };

  } catch (error) {
    console.error('notify-lead error:', error.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message })
    };
  }
};
