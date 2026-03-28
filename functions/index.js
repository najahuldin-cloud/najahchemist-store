// functions/index.js
// Firebase Cloud Functions for Najah Chemist
//
// Functions:
//   onOrderComplete   — Firestore trigger: sets completedAt when status → Complete
//   reorderReminder   — Scheduled daily at 9am Jamaica time
//
// Required environment variables (set via Firebase dashboard or CLI):
//   RESEND_API_KEY       — from Resend dashboard
//   WHATSAPP_TOKEN       — Meta WhatsApp Business Cloud API token
//   WHATSAPP_PHONE_ID    — Meta phone number ID (from Meta for Developers dashboard)

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentUpdated, onDocumentCreated } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');

initializeApp();

// Keywords that identify packaging/containers — not formula products
const CONTAINER_KEYWORDS = [
  'bottle', 'jar', 'container', 'cap', 'pump', 'dispenser',
  'dropper', 'tube', 'label', 'packaging', 'lid', 'closure'
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizePhone(p) {
  return (p || '').replace(/\D/g, '');
}

function getPhone(order) {
  return normalizePhone(
    order.phone || order.wa || order.customerWhatsApp || order.whatsapp || ''
  );
}

function getClientName(order) {
  return order.client || order.customerName || 'there';
}

// Returns true if order contains at least one formula product (not all containers)
function hasFormulaProduct(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  if (items.length > 0) {
    return items.some(item => {
      const name = (item.name || '').toLowerCase();
      return !CONTAINER_KEYWORDS.some(k => name.includes(k));
    });
  }
  // Fallback: single-product format
  const product = (order.product || '').toLowerCase();
  return !CONTAINER_KEYWORDS.some(k => product.includes(k));
}

// Returns items array in a consistent format for email rendering
function buildItemsList(order) {
  if (Array.isArray(order.items) && order.items.length > 0) {
    return order.items;
  }
  if (order.product) {
    return [{
      name: order.product,
      size: order.size || '—',
      qty: order.qty || 1,
      price: order.total || 0
    }];
  }
  return [];
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate();
  if (value.toDate) return value.toDate();
  return new Date(value);
}

// ── Firestore Trigger: set completedAt when status → Complete ─────────────────

exports.onOrderComplete = onDocumentUpdated('orders/{orderId}', async (event) => {
  const before = event.data.before.data();
  const after  = event.data.after.data();

  if (before.status !== 'Complete' && after.status === 'Complete') {
    await event.data.after.ref.update({ completedAt: FieldValue.serverTimestamp() });
    console.log(`[onOrderComplete] Set completedAt for order ${event.params.orderId}`);
  }
});

// ── Scheduled Function: reorderReminder ───────────────────────────────────────
// Runs daily at 9:00am Jamaica time (America/Jamaica = UTC-5, no DST)

exports.reorderReminder = onSchedule(
  { schedule: '0 9 * * *', timeZone: 'America/Jamaica' },
  async () => {
    const db = getFirestore();

    const now        = Date.now();
    const DAY_MS     = 24 * 60 * 60 * 1000;
    const windowStart = new Date(now - 26 * DAY_MS); // 26 days ago — start of 24h window
    const windowEnd   = new Date(now - 24 * DAY_MS); // 24 days ago — end of 24h window
    const cutoff25    = new Date(now - 25 * DAY_MS); // 25 days ago — "no new order" boundary

    console.log('[reorderReminder] Running. Window:', windowStart.toISOString(), '→', windowEnd.toISOString());

    // Load all orders once — dataset is small for this business
    const allOrdersSnap = await db.collection('orders').get();
    const allOrders = allOrdersSnap.docs.map(d => ({ _docId: d.id, ...d.data() }));

    // Identify candidates: Complete orders with completedAt in the 24–26 day window
    const candidates = allOrders.filter(order => {
      if (order.status !== 'Complete') return false;

      const completedAt = toDate(order.completedAt);
      if (!completedAt) return false; // needs completedAt set by onOrderComplete trigger
      if (completedAt < windowStart || completedAt > windowEnd) return false;

      if (Number(order.total || 0) < 3550) return false;
      if (!hasFormulaProduct(order)) return false;

      return true;
    });

    console.log(`[reorderReminder] Candidates: ${candidates.length}`);

    for (const order of candidates) {
      try {
        const phone = getPhone(order);
        if (!phone) {
          console.warn(`[reorderReminder] No phone on order ${order._docId} — skipping`);
          continue;
        }

        // Check: client has not placed any new order in the last 25 days
        const hasRecentOrder = allOrders.some(o => {
          if (o._docId === order._docId) return false; // ignore this order
          if (getPhone(o) !== phone) return false;
          const createdAt = toDate(o.createdAt);
          return createdAt && createdAt > cutoff25;
        });
        if (hasRecentOrder) {
          console.log(`[reorderReminder] Skipping ${phone} — has a recent order`);
          continue;
        }

        // Check: client has received fewer than 3 reminders
        const reminderRef = db.collection('reorder_reminders').doc(phone);
        const reminderSnap = await reminderRef.get();
        const reminderCount = reminderSnap.exists ? (reminderSnap.data().reminder_count || 0) : 0;
        if (reminderCount >= 3) {
          console.log(`[reorderReminder] Skipping ${phone} — reminder limit reached (${reminderCount})`);
          continue;
        }

        const clientName = getClientName(order);
        const orderId    = order.id || order.orderId || order._docId;
        const email      = order.email || order.customerEmail || '';
        const items      = buildItemsList(order);

        // Action 1: Send WhatsApp message
        await sendWhatsApp(phone, clientName);

        // Action 2: Send email via Resend (silently skip if no email)
        if (email) {
          await sendEmail(email, clientName, items);
        }

        // Update reorder_reminders tracker
        await reminderRef.set({
          reminder_count:  FieldValue.increment(1),
          last_reminded:   FieldValue.serverTimestamp(),
          client_name:     clientName
        }, { merge: true });

        console.log(`[reorderReminder] Sent — ${clientName} | ${phone} | ${orderId}`);

      } catch (err) {
        // Log and continue — one failure must not stop the batch
        console.error(`[reorderReminder] Error for order ${order._docId}:`, err.message);
      }
    }

    console.log('[reorderReminder] Done.');
  }
);

// ── WhatsApp via Meta Business Cloud API ──────────────────────────────────────

async function sendWhatsApp(phone, clientName) {
  const token   = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;

  if (!token || !phoneId) {
    console.warn('[reorderReminder] WHATSAPP_TOKEN or WHATSAPP_PHONE_ID not configured — skipping WhatsApp');
    return;
  }

  const message =
    `Hi ${clientName} 👋 It's been 25 days since your Najah Chemist order — ` +
    `your products might be running low soon! Ready to reorder before you sell out? ` +
    `Place your next order here: https://najahchemistja.com/start — Najah Chemist 🌿`;

  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body: message }
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WhatsApp API ${res.status}: ${err}`);
  }
}

// ── Email via Resend ──────────────────────────────────────────────────────────

async function sendEmail(email, clientName, items) {
  const resendKey = process.env.RESEND_API_KEY;

  if (!resendKey) {
    console.warn('[reorderReminder] RESEND_API_KEY not configured — skipping email');
    return;
  }

  const itemRows = items.map(i => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f0ece8;">${i.name}${i.size && i.size !== '—' ? ' — ' + i.size : ''}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0ece8;text-align:center;">${i.qty}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0ece8;text-align:right;">J$${Number(i.price).toLocaleString()}</td>
      </tr>`).join('');

  const productsSection = items.length > 0 ? `
          <p style="margin:0 0 12px;font-weight:600;font-size:0.9rem;color:#1a1a1a;">Your last order included:</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <thead>
              <tr style="background:#f5f1ec;">
                <th style="padding:8px 12px;text-align:left;font-size:0.78rem;color:#777;font-weight:600;">Item</th>
                <th style="padding:8px 12px;text-align:center;font-size:0.78rem;color:#777;font-weight:600;">Qty</th>
                <th style="padding:8px 12px;text-align:right;font-size:0.78rem;color:#777;font-weight:600;">Price</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>` : '';

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
          <div style="color:#b8a99a;font-size:0.82rem;margin-top:4px;">Reorder Reminder</div>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:32px;">
          <h2 style="margin:0 0 16px;font-size:1.3rem;font-weight:700;color:#1a1a1a;">Running low? 🌿</h2>
          <p style="margin:0 0 8px;font-size:1rem;">Hi <strong>${clientName}</strong>,</p>
          <p style="margin:0 0 24px;color:#555;font-size:0.9rem;line-height:1.6;">It's been 25 days since your last Najah Chemist order. If your products are selling well, now is the time to reorder before you run out of stock.</p>

          ${productsSection}

          <!-- CTA Button -->
          <div style="text-align:center;margin:28px 0 24px;">
            <a href="https://najahchemistja.com/start"
               style="display:inline-block;background:#1a1a1a;color:white;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:0.95rem;letter-spacing:0.02em;">
              Reorder Now →
            </a>
          </div>

          <p style="margin:0;color:#777;font-size:0.82rem;line-height:1.6;">Questions? Reply to this email or reach us on WhatsApp at +1 (876) 885-1099.</p>
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

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Najah Chemist <orders@najahchemistja.com>',
      to: [email],
      subject: `Time to reorder — ${clientName}`,
      html
    })
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(`Resend error ${res.status}: ${errData.message || JSON.stringify(errData)}`);
  }
}

// ── Email Follow-up Sequences ─────────────────────────────────────────────────
// Sequence 1: Subscribers (popup sign-ups)  — 3 emails over 7 days
// Sequence 2: Leads      (start funnel)     — 3 emails over 7 days
//
// Architecture:
//   onDocumentCreated triggers send Email 1 immediately and write scheduledEmails
//   docs for day 3 and day 7. sendScheduledEmails cron (hourly) queries
//   sent==false, filters scheduledAt<=now in JS, marks sent:true BEFORE sending
//   to prevent duplicates on retry, rolls back on failure.

const PDF_URL    = 'https://najahchemistja.com/guide/24-hour-brand-launch-blueprint.pdf';
const FROM_SEQ   = 'Najah Chemist <start@najahchemistja.com>';

// Generic Resend sender for sequences
async function sendResendEmail(to, subject, html) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.warn('[email-seq] RESEND_API_KEY not configured — skipping');
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: FROM_SEQ, to: [to], subject, html })
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(`Resend ${res.status}: ${errData.message || JSON.stringify(errData)}`);
  }
}

// Shared HTML wrapper for all sequence emails
function wrapEmail(subtitle, bodyHtml) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#faf8f5;font-family:Outfit,Arial,sans-serif;color:#1a1a1a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#faf8f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.07);">
        <tr><td style="background:#1a1a1a;padding:28px 32px;text-align:center;">
          <div style="font-size:1.5rem;font-weight:700;color:#fff;letter-spacing:0.04em;">Najah Chemist</div>
          <div style="color:#b8a99a;font-size:0.82rem;margin-top:4px;">${subtitle}</div>
        </td></tr>
        <tr><td style="padding:32px;">
          ${bodyHtml}
          <p style="margin:24px 0 0;color:#777;font-size:0.82rem;line-height:1.6;">Questions? Reply to this email or WhatsApp us at +1 (876) 885-1099.</p>
        </td></tr>
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
}

// ── Subscriber email bodies ───────────────────────────────────────────────────

function subEmail1Html() {
  return wrapEmail('Your Free Brand Guide', `
    <h2 style="margin:0 0 16px;font-size:1.3rem;font-weight:700;color:#1a1a1a;">Welcome to Najah Chemist 🌿</h2>
    <p style="margin:0 0 16px;color:#555;font-size:0.9rem;line-height:1.6;">
      Thanks for joining — here's something to get you started.
    </p>
    <p style="margin:0 0 16px;color:#555;font-size:0.9rem;line-height:1.6;">
      We put together a free guide: <strong>The 24-Hour Brand Launch Blueprint</strong> — a step-by-step breakdown of how to launch your own skincare brand in Jamaica in under 24 hours, using our formulas.
    </p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${PDF_URL}" style="display:inline-block;background:#1a1a1a;color:white;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:0.95rem;letter-spacing:0.02em;">
        Download the Free Guide →
      </a>
    </div>
    <p style="margin:0 0 16px;color:#555;font-size:0.9rem;line-height:1.6;">
      Inside you'll find the exact products, pricing, and process our brand owners use to go from idea to their first sale.
    </p>
    <p style="margin:0;color:#555;font-size:0.9rem;line-height:1.6;">— Najah Chemist Team</p>`);
}

function subEmail2Html() {
  return wrapEmail('A Few Things Worth Knowing', `
    <h2 style="margin:0 0 16px;font-size:1.3rem;font-weight:700;color:#1a1a1a;">Did you get a chance to read it? 👀</h2>
    <p style="margin:0 0 16px;color:#555;font-size:0.9rem;line-height:1.6;">
      A few days ago we sent you the 24-Hour Brand Launch Blueprint. Here's what most people are surprised to learn when they open it:
    </p>
    <ul style="margin:0 0 20px;padding-left:20px;color:#555;font-size:0.9rem;line-height:1.8;">
      <li>You don't need a big budget — our MOQ starts at just 1 litre.</li>
      <li>Your products are ready in 2–3 business days after payment.</li>
      <li>We handle the formula. You handle the brand and the sales.</li>
    </ul>
    <p style="margin:0 0 20px;color:#555;font-size:0.9rem;line-height:1.6;">
      Whether you want to sell from home, on Instagram, or in a store — this is the fastest way to have a real skincare product in hand.
    </p>
    <div style="text-align:center;margin:28px 0;">
      <a href="https://najahchemistja.com/start" style="display:inline-block;background:#1a1a1a;color:white;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:0.95rem;letter-spacing:0.02em;">
        Start Your Brand →
      </a>
    </div>
    <p style="margin:0;color:#555;font-size:0.9rem;line-height:1.6;">— Najah Chemist Team</p>`);
}

function subEmail3Html() {
  return wrapEmail('Last Nudge', `
    <h2 style="margin:0 0 16px;font-size:1.3rem;font-weight:700;color:#1a1a1a;">Ready when you are 🌿</h2>
    <p style="margin:0 0 16px;color:#555;font-size:0.9rem;line-height:1.6;">
      We know starting something new takes courage. We've worked with dozens of brand owners across Jamaica who felt the same way before they placed their first order.
    </p>
    <p style="margin:0 0 16px;color:#555;font-size:0.9rem;line-height:1.6;">
      Most of them told us the hardest part was just getting started. The rest — the formula, the packaging guidance, the reorder cycle — fell into place quickly.
    </p>
    <p style="margin:0 0 20px;color:#555;font-size:0.9rem;line-height:1.6;">
      If you have any questions before you take the step, reply to this email. We read every message.
    </p>
    <div style="text-align:center;margin:28px 0;">
      <a href="https://najahchemistja.com/start" style="display:inline-block;background:#1a1a1a;color:white;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:0.95rem;letter-spacing:0.02em;">
        Get Started Today →
      </a>
    </div>
    <p style="margin:0;color:#555;font-size:0.9rem;line-height:1.6;">— Najah Chemist Team</p>`);
}

// ── Lead email bodies ─────────────────────────────────────────────────────────

function leadEmail1Html(name) {
  const first = (name || 'there').split(' ')[0];
  return wrapEmail('Next Steps', `
    <h2 style="margin:0 0 16px;font-size:1.3rem;font-weight:700;color:#1a1a1a;">You're one step closer, ${first} 🌿</h2>
    <p style="margin:0 0 16px;color:#555;font-size:0.9rem;line-height:1.6;">
      We received your brand launch request. Your free copy of the <strong>24-Hour Brand Launch Blueprint</strong> was just sent to this inbox — check spam if you don't see it within a few minutes.
    </p>
    <p style="margin:0 0 8px;font-weight:600;font-size:0.9rem;color:#1a1a1a;">Here's what happens next:</p>
    <ol style="margin:0 0 20px;padding-left:20px;color:#555;font-size:0.9rem;line-height:1.8;">
      <li>Read through the guide — it answers most first-time questions.</li>
      <li>Pick your starting products and sizes from our catalogue.</li>
      <li>Place your order and make payment (bank transfer, Lynk, or card).</li>
      <li>We produce and ship within 2–3 business days.</li>
    </ol>
    <div style="text-align:center;margin:28px 0;">
      <a href="https://najahchemistja.com" style="display:inline-block;background:#1a1a1a;color:white;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:0.95rem;letter-spacing:0.02em;">
        Browse Products →
      </a>
    </div>
    <p style="margin:0;color:#555;font-size:0.9rem;line-height:1.6;">— Najah Chemist Team</p>`);
}

function leadEmail2Html(name) {
  const first = (name || 'there').split(' ')[0];
  return wrapEmail('Quick Check-In', `
    <h2 style="margin:0 0 16px;font-size:1.3rem;font-weight:700;color:#1a1a1a;">How's the guide, ${first}?</h2>
    <p style="margin:0 0 16px;color:#555;font-size:0.9rem;line-height:1.6;">
      It's been a few days since you downloaded the Brand Launch Blueprint. We wanted to check in — have you had a chance to look through it?
    </p>
    <p style="margin:0 0 16px;color:#555;font-size:0.9rem;line-height:1.6;">
      A common question we get at this stage: <strong>"Where do I even start if I don't know what products to pick?"</strong>
    </p>
    <p style="margin:0 0 20px;color:#555;font-size:0.9rem;line-height:1.6;">
      Our most popular starting bundle is the <strong>Yoni Care Set</strong> (Foaming Wash + Scrub + Body Butter) — high demand, high repeat buyers, and a strong margin from day one. But every brand is different. Reply to this email and tell us who your customer is — we'll suggest the right products for your niche.
    </p>
    <div style="text-align:center;margin:28px 0;">
      <a href="https://najahchemistja.com" style="display:inline-block;background:#1a1a1a;color:white;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:0.95rem;letter-spacing:0.02em;">
        View the Full Catalogue →
      </a>
    </div>
    <p style="margin:0;color:#555;font-size:0.9rem;line-height:1.6;">— Najah Chemist Team</p>`);
}

function leadEmail3Html(name) {
  const first = (name || 'there').split(' ')[0];
  return wrapEmail('Your Brand Is Waiting', `
    <h2 style="margin:0 0 16px;font-size:1.3rem;font-weight:700;color:#1a1a1a;">Don't let it sit, ${first} 🌿</h2>
    <p style="margin:0 0 16px;color:#555;font-size:0.9rem;line-height:1.6;">
      A week ago you requested information about launching your skincare brand with Najah Chemist. We don't want to pressure you — but we do want to make sure you have everything you need to take that next step.
    </p>
    <p style="margin:0 0 16px;color:#555;font-size:0.9rem;line-height:1.6;">
      Here's the truth: the brands that succeed are the ones that start. Not the ones that wait for the perfect moment.
    </p>
    <p style="margin:0 0 20px;color:#555;font-size:0.9rem;line-height:1.6;">
      You can start with as little as 1 litre. That's a real product, in your hands, with your label, in under a week.
    </p>
    <div style="background:#f5f1ec;border-radius:10px;padding:20px 24px;margin:0 0 24px;">
      <p style="margin:0 0 8px;font-weight:700;font-size:0.9rem;color:#1a1a1a;">What's holding you back?</p>
      <p style="margin:0;color:#555;font-size:0.85rem;line-height:1.6;">Reply to this email with your biggest question or concern — our team responds to every message personally.</p>
    </div>
    <div style="text-align:center;margin:28px 0;">
      <a href="https://najahchemistja.com/start" style="display:inline-block;background:#1a1a1a;color:white;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:0.95rem;letter-spacing:0.02em;">
        Place Your First Order →
      </a>
    </div>
    <p style="margin:0;color:#555;font-size:0.9rem;line-height:1.6;">— Najah Chemist Team</p>`);
}

// Build the HTML for a scheduled email based on its sequence/emailNumber
function buildScheduledEmailHtml(d) {
  if (d.sequence === 'subscriber') {
    return d.emailNumber === 2 ? subEmail2Html() : subEmail3Html();
  }
  if (d.sequence === 'lead') {
    return d.emailNumber === 2 ? leadEmail2Html(d.recipientName) : leadEmail3Html(d.recipientName);
  }
  throw new Error(`Unknown sequence: ${d.sequence}`);
}

// ── Trigger: onSubscriberCreated ──────────────────────────────────────────────

exports.onSubscriberCreated = onDocumentCreated('subscribers/{id}', async (event) => {
  const data  = event.data.data();
  const email = data.email;
  if (!email) {
    console.warn('[onSubscriberCreated] No email field — skipping');
    return;
  }

  const db     = getFirestore();
  const now    = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  // Email 1: send immediately
  try {
    await sendResendEmail(email, 'Your free skincare brand guide is here 🌿', subEmail1Html());
    console.log(`[onSubscriberCreated] Email 1 sent to ${email}`);
  } catch (err) {
    console.error(`[onSubscriberCreated] Email 1 failed for ${email}:`, err.message);
  }

  // Schedule Emails 2 (day 3) and 3 (day 7)
  const toSchedule = [
    { emailNumber: 2, delayMs: 3 * DAY_MS, subject: 'Did you read the guide? 👀' },
    { emailNumber: 3, delayMs: 7 * DAY_MS, subject: 'Ready to launch your brand? 🌿' },
  ];
  for (const s of toSchedule) {
    await db.collection('scheduledEmails').add({
      sequence:       'subscriber',
      recipientEmail: email,
      recipientName:  '',
      emailNumber:    s.emailNumber,
      subject:        s.subject,
      scheduledAt:    Timestamp.fromMillis(now + s.delayMs),
      sent:           false,
      createdAt:      FieldValue.serverTimestamp()
    });
  }
  console.log(`[onSubscriberCreated] Scheduled emails 2 & 3 for ${email}`);
});

// ── Trigger: onLeadCreated ────────────────────────────────────────────────────

exports.onLeadCreated = onDocumentCreated('leads/{id}', async (event) => {
  const data  = event.data.data();
  const email = data.email;
  const name  = data.name || '';
  if (!email) {
    console.warn('[onLeadCreated] No email field — skipping');
    return;
  }

  const db     = getFirestore();
  const now    = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const first  = (name || 'friend').split(' ')[0];

  // Email 1: send immediately (separate from send-guide.js PDF email)
  try {
    await sendResendEmail(email, `You're one step closer, ${first} 🌿`, leadEmail1Html(name));
    console.log(`[onLeadCreated] Email 1 sent to ${email}`);
  } catch (err) {
    console.error(`[onLeadCreated] Email 1 failed for ${email}:`, err.message);
  }

  // Schedule Emails 2 (day 3) and 3 (day 7)
  const toSchedule = [
    { emailNumber: 2, delayMs: 3 * DAY_MS, subject: 'Quick check-in from Najah Chemist' },
    { emailNumber: 3, delayMs: 7 * DAY_MS, subject: "Your brand is waiting — don't let it sit 🌿" },
  ];
  for (const s of toSchedule) {
    await db.collection('scheduledEmails').add({
      sequence:       'lead',
      recipientEmail: email,
      recipientName:  name,
      emailNumber:    s.emailNumber,
      subject:        s.subject,
      scheduledAt:    Timestamp.fromMillis(now + s.delayMs),
      sent:           false,
      createdAt:      FieldValue.serverTimestamp()
    });
  }
  console.log(`[onLeadCreated] Scheduled emails 2 & 3 for ${email}`);
});

// ── Scheduled: sendScheduledEmails (hourly) ───────────────────────────────────

exports.sendScheduledEmails = onSchedule(
  { schedule: '0 * * * *', timeZone: 'America/Jamaica' },
  async () => {
    const db  = getFirestore();
    const now = new Date();

    // Load all unsent docs and filter in JS — avoids Firestore inequality index requirement
    const snap = await db.collection('scheduledEmails').where('sent', '==', false).get();
    const due  = snap.docs.filter(doc => {
      const scheduledAt = toDate(doc.data().scheduledAt);
      return scheduledAt && scheduledAt <= now;
    });

    console.log(`[sendScheduledEmails] ${due.length} due of ${snap.size} unsent`);

    for (const doc of due) {
      const d = doc.data();
      try {
        // Mark sent FIRST — prevents duplicate send if function retries after partial failure
        await doc.ref.update({ sent: true, sentAt: FieldValue.serverTimestamp() });

        const html = buildScheduledEmailHtml(d);
        await sendResendEmail(d.recipientEmail, d.subject, html);

        console.log(`[sendScheduledEmails] Sent ${d.sequence} #${d.emailNumber} → ${d.recipientEmail}`);
      } catch (err) {
        // Roll back so it retries next hour
        await doc.ref.update({ sent: false }).catch(() => {});
        console.error(`[sendScheduledEmails] Failed doc ${doc.id}:`, err.message);
      }
    }

    console.log('[sendScheduledEmails] Done.');
  }
);
