// netlify/functions/notify-lead.js
// Sends an internal email notification when a new lead is captured on /start
// Required env var: RESEND_API_KEY

const WA_NUMBER = '18768851099';

function detectSegment(brandType, journey) {
  const t = ((brandType || '') + ' ' + (journey || '')).toLowerCase();
  if (/skin|glow|bright|facial|face|serum|toner|moistur|vitamin c|kojic|turmeric|dark spot/.test(t)) return 'skincare';
  if (/body|butter|scrub|lotion|oil|hair/.test(t)) return 'body';
  if (/yoni|feminine|intimate|boric|probiotic|vaginal/.test(t)) return 'feminine';
  if (/men|beard|grooming|barber/.test(t)) return 'mens';
  return 'general';
}

function getTemplates(segment, name) {
  const n = (name || 'there').split(' ')[0];

  const templates = {
    skincare: {
      main: `Hi ${n}! 👋 I'm Najah from Najah Chemist. I saw you're interested in starting a skincare brand — congrats on taking that step! 🌿\n\nWe manufacture private-label skincare here in Jamaica: brightening serums, Vitamin C soaps, Kojic + Turmeric bars, dark spot correctors and more.\n\nWhat product are you most interested in starting with?`,
      followup: `Hi ${n}, just following up! We have low MOQs (from 1 litre / 2 lbs) so you can start small and scale up. Happy to send you a product list and pricing. Still interested? 😊`
    },
    body: {
      main: `Hi ${n}! 👋 I'm Najah from Najah Chemist. I saw you want to start a body care brand — exciting! 🧴\n\nWe make private-label body butters, whipped scrubs, body oils and more right here in Jamaica. Small batches welcome — MOQ from 2 lbs.\n\nWhat body care product are you thinking of starting with?`,
      followup: `Hi ${n}, just checking in! If you'd like to see our body care product catalogue with wholesale pricing, I can send it over now. Still interested? 😊`
    },
    feminine: {
      main: `Hi ${n}! 👋 I'm Najah from Najah Chemist. I saw you're interested in feminine care products — great niche! 🌸\n\nWe manufacture Yoni Washes, Boric Acid Suppositories, Probiotic Foaming Washes and more. Private label, made in Jamaica.\n\nAre you looking to brand an existing formula or create something custom?`,
      followup: `Hi ${n}, just following up! The feminine care market is growing fast in Jamaica. We can have your branded product ready in 2–3 business days. Still want to chat? 😊`
    },
    mens: {
      main: `Hi ${n}! 👋 I'm Najah from Najah Chemist. I saw you're interested in men's grooming products — smart move! 💪\n\nWe can private-label beard oils, body washes, skin soaps and more. Made in Jamaica, small MOQs.\n\nWhat men's product are you looking to launch?`,
      followup: `Hi ${n}, just checking in! Men's grooming is one of the fastest-growing categories right now. We can help you get started quickly. Still keen? 😊`
    },
    general: {
      main: `Hi ${n}! 👋 I'm Najah from Najah Chemist. I saw you're interested in starting your own product brand — congrats! 🌿\n\nWe manufacture private-label natural skincare and body care products here in Jamaica. Low MOQs, fast turnaround (2–3 days).\n\nWhat type of product are you thinking of starting with?`,
      followup: `Hi ${n}, just following up! Whether it's skincare, body care or feminine wellness — we can help you launch your brand. Still interested in chatting? 😊`
    }
  };

  return templates[segment] || templates.general;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body);
    const { name, whatsapp, email, branch, brandType, journey, budget, hearAboutUs, answers } = body;

    const displayName     = name        || '—';
    const displayWA       = whatsapp    || '—';
    const displayEmail    = email       || '—';
    const displayBrand    = brandType   || (Array.isArray(answers) && answers[0]) || (branch === 'existing' ? 'Existing seller' : '—');
    const displayJourney  = journey     || '—';
    const displayBudget   = budget      || '—';
    const displaySource   = hearAboutUs || '—';
    const displayBranch   = branch      || '—';
    const displayAnswers  = Array.isArray(answers) && answers.length ? answers.join(' → ') : '—';
    const displayDate     = new Date().toLocaleString('en-US', { timeZone: 'America/Jamaica', dateStyle: 'medium', timeStyle: 'short' });

    const segment   = detectSegment(displayBrand, displayJourney);
    const templates = getTemplates(segment, name);
    const waDigits  = (whatsapp || '').replace(/\D/g, '');
    const waMainLink     = waDigits ? `https://wa.me/${waDigits}?text=${encodeURIComponent(templates.main)}` : null;
    const waFollowupLink = waDigits ? `https://wa.me/${waDigits}?text=${encodeURIComponent(templates.followup)}` : null;

    const subject = `New Lead — ${displayName} (${segment}) — ${displayDate}`;

    const waSection = waDigits ? `
          <div style="margin-top:28px;background:#dcfce7;border-radius:10px;padding:20px 24px;">
            <p style="margin:0 0 6px;font-size:0.95rem;font-weight:700;color:#14532d;">⚡ Reply within 30 minutes for best conversion</p>
            <p style="margin:0 0 16px;font-size:0.82rem;color:#166534;">Segment detected: <strong>${segment.toUpperCase()}</strong> · WhatsApp: <strong>${displayWA}</strong></p>

            <p style="margin:0 0 8px;font-size:0.88rem;font-weight:700;color:#1a1a1a;">WHATSAPP REPLY — SEND THIS NOW:</p>
            <div style="background:#fff;border-radius:8px;padding:14px 16px;font-size:0.85rem;color:#374151;white-space:pre-wrap;line-height:1.65;border:1px solid #bbf7d0;margin-bottom:12px;">${templates.main.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
            <a href="${waMainLink}" style="display:inline-block;background:#166534;color:white;padding:11px 22px;border-radius:8px;text-decoration:none;font-weight:700;font-size:0.88rem;">
              📲 Tap to open in WhatsApp
            </a>

            <div style="margin-top:24px;border-top:1px solid #bbf7d0;padding-top:20px;">
              <p style="margin:0 0 8px;font-size:0.88rem;font-weight:700;color:#1a1a1a;">FOLLOW-UP — send if no reply in 30 mins:</p>
              <div style="background:#fff;border-radius:8px;padding:14px 16px;font-size:0.85rem;color:#374151;white-space:pre-wrap;line-height:1.65;border:1px solid #bbf7d0;margin-bottom:12px;">${templates.followup.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
              <a href="${waFollowupLink}" style="display:inline-block;background:#4b5563;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.85rem;">
                📲 Send Follow-up
              </a>
            </div>
          </div>` : `
          <div style="margin-top:28px;background:#fef9c3;border-radius:10px;padding:16px 20px;">
            <p style="margin:0;font-size:0.88rem;color:#92400e;">⚠️ No WhatsApp number captured — cannot send message.</p>
          </div>`;

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
              <td style="padding:10px 12px;background:#f9fafb;font-size:0.8rem;color:#6b7280;">Journey Stage</td>
              <td style="padding:10px 12px;background:#f9fafb;font-size:0.92rem;">${displayJourney}</td>
            </tr>
            <tr>
              <td style="padding:10px 12px;font-size:0.8rem;color:#6b7280;border-top:1px solid #f3f4f6;">Budget</td>
              <td style="padding:10px 12px;font-size:0.92rem;border-top:1px solid #f3f4f6;">${displayBudget}</td>
            </tr>
            <tr>
              <td style="padding:10px 12px;background:#f9fafb;font-size:0.8rem;color:#6b7280;">Source</td>
              <td style="padding:10px 12px;background:#f9fafb;font-size:0.92rem;">${displaySource}</td>
            </tr>
            <tr>
              <td style="padding:10px 12px;font-size:0.8rem;color:#6b7280;border-top:1px solid #f3f4f6;">Path</td>
              <td style="padding:10px 12px;font-size:0.92rem;border-top:1px solid #f3f4f6;">${displayBranch}</td>
            </tr>
            <tr>
              <td style="padding:10px 12px;background:#f9fafb;font-size:0.8rem;color:#6b7280;">Chatbot Answers</td>
              <td style="padding:10px 12px;background:#f9fafb;font-size:0.88rem;color:#374151;">${displayAnswers}</td>
            </tr>
          </table>

          ${waSection}
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
