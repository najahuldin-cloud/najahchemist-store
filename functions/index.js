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
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const functionsV1 = require('firebase-functions/v1');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');

initializeApp();

// Predictable v1 URL — available immediately after deploy
const UNSUBSCRIBE_BASE =
  `https://us-central1-${process.env.GCLOUD_PROJECT || 'najah-chemist'}.cloudfunctions.net/unsubscribe`;

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

exports.onOrderComplete = onDocumentUpdated(
  { document: 'orders/{orderId}', secrets: ['RESEND_API_KEY'] },
  async (event) => {
    const before  = event.data.before.data();
    const after   = event.data.after.data();
    const orderId = event.params.orderId;

    if (before.status !== 'Complete' && after.status === 'Complete') {
      await event.data.after.ref.update({ completedAt: FieldValue.serverTimestamp() });
      console.log(`[onOrderComplete] Set completedAt for order ${orderId}`);

      // Send order-complete email if we have an address
      const email = after.email || after.customerEmail || '';
      if (email) {
        try {
          await sendOrderCompleteEmail(email, after, orderId);
          console.log(`[onOrderComplete] Sent completion email to ${email}`);
        } catch (err) {
          console.error(`[onOrderComplete] Email failed for ${orderId}:`, err.message);
        }
      } else {
        console.log(`[onOrderComplete] No email on order ${orderId} — skipping email`);
      }
    }
  }
);

// ── Helper: send order-complete email ────────────────────────────────────────

async function sendOrderCompleteEmail(email, order, docId) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.warn('[onOrderComplete] RESEND_API_KEY not configured — skipping email');
    return;
  }

  const clientName    = getClientName(order);
  const first         = clientName.split(' ')[0];
  const displayId     = order.id || order.orderId || docId;
  const items         = buildItemsList(order);
  const total         = order.total ? `J$${Number(order.total).toLocaleString()}` : '—';

  const itemRowsHtml = items.length > 0
    ? items.map(i =>
        `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #f0ece8;color:#1a1a1a;">` +
            `${i.name}${i.size && i.size !== '—' ? ' — ' + i.size : ''}` +
          `</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0ece8;text-align:center;color:#555;">×${i.qty || 1}</td>
        </tr>`).join('')
    : `<tr><td colspan="2" style="padding:8px 12px;color:#777;">See order details</td></tr>`;

  const html = wrapEmail('Order Complete ✅', `
    <h2 style="margin:0 0 16px;font-size:1.3rem;font-weight:700;color:#1a1a1a;">Your order is ready, ${first}! ✅</h2>
    <p style="margin:0 0 16px;color:#555;font-size:0.9rem;line-height:1.6;">
      Great news — your order <strong>NC-${displayId}</strong> has been completed and is ready.
    </p>

    <p style="margin:0 0 8px;font-weight:600;font-size:0.9rem;color:#1a1a1a;">What you ordered:</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;border:1px solid #f0ece8;border-radius:8px;overflow:hidden;">
      <thead>
        <tr style="background:#f5f1ec;">
          <th style="padding:8px 12px;text-align:left;font-size:0.78rem;color:#777;font-weight:600;">Product</th>
          <th style="padding:8px 12px;text-align:center;font-size:0.78rem;color:#777;font-weight:600;">Qty</th>
        </tr>
      </thead>
      <tbody>${itemRowsHtml}</tbody>
    </table>

    <p style="margin:0 0 20px;font-size:0.9rem;color:#1a1a1a;"><strong>Total: ${total}</strong></p>

    <div style="background:#f5f1ec;border-radius:10px;padding:16px 20px;margin:0 0 24px;">
      <p style="margin:0 0 6px;font-weight:600;font-size:0.88rem;color:#1a1a1a;">Your next step</p>
      <p style="margin:0;color:#555;font-size:0.85rem;line-height:1.6;">Arrange collection or delivery using the shipping method you selected.</p>
    </div>

    <p style="margin:0 0 16px;color:#555;font-size:0.9rem;line-height:1.6;">
      Need to reorder? Reply to this email or WhatsApp us:<br>
      <a href="https://wa.me/18768851099" style="color:#B45309;font-weight:600;text-decoration:none;">wa.me/18768851099</a>
    </p>

    <p style="margin:0;color:#555;font-size:0.9rem;line-height:1.6;">
      Thank you for ordering with Najah Chemist. We look forward to your next order.<br><br>
      — Najah<br>
      <span style="font-size:0.82rem;color:#777;">Najah Chemist | Jamaica's Private Label Skincare Manufacturer</span>
    </p>
  `, null);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from:    'Najah Chemist <orders@najahchemistja.com>',
      to:      [email],
      subject: `Your order is ready ✅ — NC-${displayId}`,
      html
    })
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(`Resend error ${res.status}: ${errData.message || JSON.stringify(errData)}`);
  }
}

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
// Sequence 1: Subscribers (popup sign-ups)  — 3 emails: day 0, 3, 7
// Sequence 2: Leads      (start funnel)     — 4 emails: day 0, 3, 7, 14
//   Email 8 (day 14) is a re-engagement offering a free 15-min brand consultation (
//   first wholesale order). It is skipped if the lead has converted: true or
//   has placed any order in the orders collection.
//
// Architecture:
//   onDocumentCreated triggers send Email 1 immediately and writes scheduledEmails
//   docs for day 3, 7 (and day 14 for leads). sendScheduledEmails cron (hourly)
//   queries sent==false, filters scheduledAt<=now in JS, marks sent:true BEFORE
//   sending to prevent duplicates on retry, rolls back on failure.

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
function wrapEmail(subtitle, bodyHtml, unsubscribeUrl) {
  const unsubLine = unsubscribeUrl
    ? `<br><a href="${unsubscribeUrl}" style="color:#bbb;font-size:0.72rem;text-decoration:underline;">Unsubscribe from these emails</a>`
    : '';
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
            WhatsApp: +1 (876) 885-1099${unsubLine}
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Subscriber email bodies ───────────────────────────────────────────────────

function subEmail1Html(unsubscribeUrl) {
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
    <p style="margin:0;color:#555;font-size:0.9rem;line-height:1.6;">— Najah Chemist Team</p>`, unsubscribeUrl);
}

function subEmail2Html(unsubscribeUrl) {
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
    <p style="margin:0;color:#555;font-size:0.9rem;line-height:1.6;">— Najah Chemist Team</p>`, unsubscribeUrl);
}

function subEmail3Html(unsubscribeUrl) {
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
    <p style="margin:0;color:#555;font-size:0.9rem;line-height:1.6;">— Najah Chemist Team</p>`, unsubscribeUrl);
}

// ── Lead email bodies ─────────────────────────────────────────────────────────

function leadEmail1Html(name, unsubscribeUrl) {
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
    <p style="margin:0;color:#555;font-size:0.9rem;line-height:1.6;">— Najah Chemist Team</p>`, unsubscribeUrl);
}

function leadEmail2Html(name, brandType, unsubscribeUrl) {
  const first = (name || 'there').split(' ')[0];
  const bt = (brandType || '').trim();

  let subtitle, intro, productsHeader, products, closing, ctaText;

  if (bt === 'Skincare') {
    subtitle    = 'What\'s Selling';
    intro       = `If you're building a skincare brand, here's what's actually selling:`;
    productsHeader = null;
    products    = [
      '🥇 <strong>Turmeric Kojic Soap</strong> — dark spots, acne, uneven tone. Our most reordered product.',
      '🥈 <strong>Papaya Serum</strong> — brightening serum your customers will repurchase every 4–6 weeks.',
      '🥉 <strong>Spot Remover</strong> — targeted treatment. Easy add-on sale to any skincare bundle.',
    ];
    closing     = 'You don\'t need all three. Start with one litre of one product, put your label on it, and test your market.';
    ctaText     = 'WhatsApp me — I\'ll have a quote to you same day.';
  } else if (bt === 'Hair Care' || bt === 'Hair care') {
    subtitle    = 'What\'s Selling';
    intro       = 'If you\'re building a hair care brand, here\'s what\'s actually selling:';
    productsHeader = null;
    products    = [
      '🥇 <strong>Ayurvedic Hair Growth Oil</strong> — high demand, easy repeat sales. Clients reorder within weeks.',
      '🥈 <strong>Hair Butter</strong> — consistent best-seller for natural hair clients. Strong retail margins.',
      '🥉 <strong>Hair Mist</strong> — lightweight daily product, pairs well with the oil and butter as a full hair care set.',
    ];
    closing     = 'You don\'t need all three. Start with one product, put your label on it, and test your market.';
    ctaText     = 'WhatsApp me — I\'ll have a quote to you same day.';
  } else if (bt === 'Feminine Care') {
    subtitle    = 'What\'s Selling';
    intro       = 'Women who find a feminine care brand they trust don\'t switch. That\'s the business you\'re building.';
    productsHeader = 'Here\'s what\'s moving:';
    products    = [
      '🥇 <strong>Yoni Foaming Wash</strong> — our fastest moving feminine care product. Clients reorder within weeks.',
      '🥈 <strong>Yoni Oil</strong> — premium margins, strong repeat purchase, customers stay loyal.',
      '🥉 <strong>Boric Acid &amp; Probiotics Gel Wash</strong> — educated buyers actively search for this. Low competition.',
    ];
    closing     = 'Start with one litre. That\'s your entire investment to launch.';
    ctaText     = 'Message me and let\'s get your first order sorted.';
  } else if (bt === "Men's Grooming") {
    subtitle    = 'What\'s Selling';
    intro       = 'Most brand owners ignore the men\'s market. Which means less competition for you.';
    productsHeader = 'What men are already spending money on:';
    products    = [
      '🥇 <strong>Beard Oil</strong> — every man with a beard needs it. Simple sell, strong repeat purchase.',
      '🥈 <strong>Ryfle Wash</strong> — masculine intimate wash, a unique product with almost no local competition.',
      '🥉 <strong>Beard Balm</strong> — pairs with the oil. Sell as a set and increase your average order value.',
    ];
    closing     = 'The window to be first in this space won\'t stay open forever.';
    ctaText     = 'WhatsApp me — let\'s talk about your first product.';
  } else {
    subtitle    = 'What\'s Selling';
    intro       = 'Here\'s what\'s actually moving for private label brands in Jamaica right now:';
    productsHeader = null;
    products    = [
      '🥇 <strong>Turmeric Kojic Soap</strong> — our most reordered product across all categories.',
      '🥈 <strong>Yoni Foaming Wash</strong> — fastest moving feminine care product.',
      '🥉 <strong>Beard Oil</strong> — strong repeat purchase, almost no local competition.',
    ];
    closing     = 'Start with one litre of whichever fits your brand vision.';
    ctaText     = 'WhatsApp me — I\'ll have a quote to you same day.';
  }

  const productsHeaderHtml = productsHeader
    ? `<p style="margin:0 0 12px;color:#555;font-size:0.9rem;line-height:1.6;">${productsHeader}</p>`
    : '';
  const productsHtml = products
    .map(p => `<p style="margin:0 0 10px;color:#555;font-size:0.9rem;line-height:1.6;">${p}</p>`)
    .join('');

  return wrapEmail(subtitle, `
    <h2 style="margin:0 0 16px;font-size:1.3rem;font-weight:700;color:#1a1a1a;">Hey ${first},</h2>
    <p style="margin:0 0 16px;color:#555;font-size:0.9rem;line-height:1.6;">${intro}</p>
    ${productsHeaderHtml}
    <div style="margin:0 0 20px;">${productsHtml}</div>
    <p style="margin:0 0 16px;color:#555;font-size:0.9rem;line-height:1.6;">${closing}</p>
    <p style="margin:0 0 20px;color:#555;font-size:0.9rem;line-height:1.6;">${ctaText}</p>
    <div style="text-align:center;margin:28px 0;">
      <a href="https://wa.me/18768851099" style="display:inline-block;background:#1a1a1a;color:white;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:0.95rem;letter-spacing:0.02em;">
        WhatsApp Najahuldin →
      </a>
    </div>
    <p style="margin:0;color:#555;font-size:0.9rem;line-height:1.6;">— Najahuldin, Najah Chemist</p>`, unsubscribeUrl);
}

function leadEmail3Html(name, brandType, unsubscribeUrl) {
  const first = (name || 'there').split(' ')[0];
  const bt = (brandType || '').trim();

  let productRec;
  if (bt === 'Skincare') {
    productRec = 'For a skincare brand, start with the <strong>Turmeric Kojic Soap</strong> or <strong>Papaya Serum</strong> — both proven sellers with strong reorder rates.';
  } else if (bt === 'Feminine Care') {
    productRec = 'For a feminine care brand, start with the <strong>Yoni Foaming Wash</strong> — our fastest moving product and the easiest first sell.';
  } else if (bt === "Men's Grooming") {
    productRec = 'For a men\'s grooming brand, start with the <strong>Beard Oil</strong> — lowest barrier to entry, highest repeat purchase rate.';
  } else if (bt === 'Hair Care' || bt === 'Hair care') {
    productRec = 'For a hair care brand, start with the <strong>Ayurvedic Hair Growth Oil</strong> — high demand, strong repeat purchase, and almost no local private label competition in Jamaica.';
  } else {
    productRec = 'Message me right now and tell me what type of brand you\'re building. I\'ll recommend the right first product, give you the price, and your order can be ready in days.';
  }

  const isKnownSegment = bt === 'Skincare' || bt === 'Feminine Care' || bt === "Men's Grooming" || bt === 'Hair Care' || bt === 'Hair care';

  // For all known segments the CTA para is the same; fallback folds it into productRec above.
  const ctaPara = isKnownSegment
    ? `<p style="margin:0 0 20px;color:#555;font-size:0.9rem;line-height:1.6;">Message me right now. I'll confirm your product, give you the price, and your order can be ready in days.</p>`
    : `<p style="margin:0 0 20px;color:#555;font-size:0.9rem;line-height:1.6;">${productRec}</p>`;

  const productRecPara = isKnownSegment
    ? `<p style="margin:0 0 20px;color:#555;font-size:0.9rem;line-height:1.6;">${productRec}</p>`
    : '';

  return wrapEmail('Your First Order', `
    <h2 style="margin:0 0 16px;font-size:1.3rem;font-weight:700;color:#1a1a1a;">Hey ${first},</h2>
    <p style="margin:0 0 16px;color:#555;font-size:0.9rem;line-height:1.6;">You've had the Brand Launch Guide for a week. I want to make this as easy as possible for you.</p>
    <p style="margin:0 0 16px;color:#555;font-size:0.9rem;line-height:1.6;">Your first order is just 1 litre. No large investment, no bulk inventory, no risk.</p>
    ${productRecPara}
    ${ctaPara}
    <div style="text-align:center;margin:28px 0;">
      <a href="https://wa.me/18768851099" style="display:inline-block;background:#1a1a1a;color:white;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:0.95rem;letter-spacing:0.02em;">
        WhatsApp Najahuldin →
      </a>
    </div>
    <p style="margin:0 0 16px;color:#555;font-size:0.9rem;line-height:1.6;">This is the last email in this sequence. The next move is yours.</p>
    <p style="margin:0;color:#555;font-size:0.9rem;line-height:1.6;">— Najahuldin, Najah Chemist</p>`, unsubscribeUrl);
}

// Lead email 8 — day-14 re-engagement with free consultation offer
function leadEmail8Html(name, unsubscribeUrl) {
  const first = (name || 'there').split(' ')[0];
  return wrapEmail('Let\'s Talk', `
    <h2 style="margin:0 0 16px;font-size:1.3rem;font-weight:700;color:#1a1a1a;">Still thinking it over? Let's talk, ${first} 👋</h2>
    <p style="margin:0 0 16px;color:#555;font-size:0.9rem;line-height:1.6;">
      You downloaded our Brand Launch Guide a couple of weeks ago — and we haven't heard from you since.
    </p>
    <p style="margin:0 0 16px;color:#555;font-size:0.9rem;line-height:1.6;">
      Starting a brand is a big decision. If you're not sure where to begin, what products to choose, or how much to budget — that's exactly what we're here for.
    </p>
    <p style="margin:0 0 12px;color:#555;font-size:0.9rem;line-height:1.6;">
      We're offering a <strong>free 15-minute brand consultation</strong> where we'll help you:
    </p>
    <ul style="margin:0 0 20px;padding-left:1.3rem;color:#555;font-size:0.9rem;line-height:2;">
      <li>Figure out which products fit your brand</li>
      <li>Understand minimum order quantities and pricing</li>
      <li>Map out a realistic launch plan</li>
    </ul>
    <p style="margin:0 0 20px;color:#555;font-size:0.9rem;line-height:1.6;">
      No pressure. No commitment. Just clarity.
    </p>
    <div style="text-align:center;margin:28px 0;">
      <a href="https://wa.me/18768851099"
         style="display:inline-block;background:#1a1a1a;color:white;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:0.95rem;letter-spacing:0.02em;">
        👉 Book My Free Consultation
      </a>
    </div>
    <p style="margin:0;color:#555;font-size:0.9rem;line-height:1.6;">— Najah<br>
    <span style="font-size:0.82rem;color:#777;">Najah Chemist | Jamaica's Private Label Skincare Manufacturer</span></p>`, unsubscribeUrl);
}

// Build the HTML for a scheduled email based on its sequence/emailNumber
function buildScheduledEmailHtml(d) {
  const unsubUrl = (d.sourceCollection && d.sourceDocId)
    ? `${UNSUBSCRIBE_BASE}?col=${encodeURIComponent(d.sourceCollection)}&id=${encodeURIComponent(d.sourceDocId)}`
    : null;
  if (d.sequence === 'subscriber') {
    return d.emailNumber === 2 ? subEmail2Html(unsubUrl) : subEmail3Html(unsubUrl);
  }
  if (d.sequence === 'lead') {
    if (d.emailNumber === 2) return leadEmail2Html(d.recipientName, d.brandType || '', unsubUrl);
    if (d.emailNumber === 8) return leadEmail8Html(d.recipientName, unsubUrl);
    return leadEmail3Html(d.recipientName, d.brandType || '', unsubUrl);
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

  const db      = getFirestore();
  const now     = Date.now();
  const DAY_MS  = 24 * 60 * 60 * 1000;
  const docId   = event.params.id;
  const unsubUrl = `${UNSUBSCRIBE_BASE}?col=subscribers&id=${encodeURIComponent(docId)}`;

  // Email 1: send immediately
  try {
    await sendResendEmail(email, 'Your free skincare brand guide is here 🌿', subEmail1Html(unsubUrl));
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
      sequence:         'subscriber',
      recipientEmail:   email,
      recipientName:    '',
      emailNumber:      s.emailNumber,
      subject:          s.subject,
      scheduledAt:      Timestamp.fromMillis(now + s.delayMs),
      sent:             false,
      createdAt:        FieldValue.serverTimestamp(),
      sourceCollection: 'subscribers',
      sourceDocId:      docId
    });
  }
  console.log(`[onSubscriberCreated] Scheduled emails 2 & 3 for ${email}`);
});

// ── Trigger: onLeadCreated ────────────────────────────────────────────────────

exports.onLeadCreated = onDocumentCreated({ document: 'leads/{id}', secrets: ['RESEND_API_KEY'] }, async (event) => {
  const data  = event.data.data();
  const email = data.email;
  const name  = data.name || '';
  if (!email) {
    console.warn('[onLeadCreated] No email field — skipping');
    return;
  }

  const db        = getFirestore();
  const now       = Date.now();
  const DAY_MS    = 24 * 60 * 60 * 1000;
  const first     = (name || 'friend').split(' ')[0];
  const docId     = event.params.id;
  const brandType = data.brandType || '';
  const unsubUrl  = `${UNSUBSCRIBE_BASE}?col=leads&id=${encodeURIComponent(docId)}`;

  // Email 1: send immediately (separate from send-guide.js PDF email)
  try {
    await sendResendEmail(email, `You're one step closer, ${first} 🌿`, leadEmail1Html(name, unsubUrl));
    console.log(`[onLeadCreated] Email 1 sent to ${email}`);
  } catch (err) {
    console.error(`[onLeadCreated] Email 1 failed for ${email}:`, err.message);
  }

  // Email 2 subject — segmented by brandType
  const email2SubjectMap = {
    'Skincare':       'The skincare products Jamaican brands are reordering every month',
    'Feminine Care':  'Feminine care is the most loyal niche in Jamaica right now',
    "Men's Grooming": "Men's grooming in Jamaica — almost no local brands. That's your opportunity.",
    'Hair Care':      'The hair care products Jamaican brands are selling right now',
    'Hair care':      'The hair care products Jamaican brands are selling right now',
  };
  const email2Subject = email2SubjectMap[brandType] || 'The products Jamaican brands are reordering every month';

  // Schedule Emails 2 (day 3), 3 (day 7), and 8 (day 14 re-engagement)
  // Email 8 is only sent if the lead has not converted — checked at send time.
  const toSchedule = [
    { emailNumber: 2, delayMs:  3 * DAY_MS, subject: email2Subject },
    { emailNumber: 3, delayMs:  7 * DAY_MS, subject: `${first}, I'll help you place your first order today` },
    { emailNumber: 8, delayMs: 14 * DAY_MS, subject: "Still thinking it over? Let's talk 👋" },
  ];
  for (const s of toSchedule) {
    await db.collection('scheduledEmails').add({
      sequence:         'lead',
      recipientEmail:   email,
      recipientName:    name,
      brandType:        brandType,
      emailNumber:      s.emailNumber,
      subject:          s.subject,
      scheduledAt:      Timestamp.fromMillis(now + s.delayMs),
      sent:             false,
      createdAt:        FieldValue.serverTimestamp(),
      sourceCollection: 'leads',
      sourceDocId:      docId
    });
  }
  console.log(`[onLeadCreated] Scheduled emails 2, 3 & 8 for ${email} (brandType: ${brandType||'fallback'})`);
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
        // Skip if recipient has unsubscribed
        if (d.sourceCollection && d.sourceDocId) {
          const sourceSnap = await getFirestore()
            .collection(d.sourceCollection).doc(d.sourceDocId).get();
          if (sourceSnap.exists && sourceSnap.data().unsubscribed === true) {
            await doc.ref.update({ sent: true, skippedReason: 'unsubscribed', sentAt: FieldValue.serverTimestamp() });
            console.log(`[sendScheduledEmails] Skipped (unsubscribed) ${d.sequence} #${d.emailNumber} → ${d.recipientEmail}`);
            continue;
          }

          // Day-14 lead re-engagement: skip if the lead has already converted or placed an order
          if (d.sequence === 'lead' && d.emailNumber === 8 && sourceSnap.exists) {
            if (sourceSnap.data().converted === true) {
              await doc.ref.update({ sent: true, skippedReason: 'converted', sentAt: FieldValue.serverTimestamp() });
              console.log(`[sendScheduledEmails] Skipped (converted) lead #8 → ${d.recipientEmail}`);
              continue;
            }
            // Check both email field variants used in the orders collection
            const [byEmail, byCustomerEmail] = await Promise.all([
              getFirestore().collection('orders').where('email',         '==', d.recipientEmail).limit(1).get(),
              getFirestore().collection('orders').where('customerEmail', '==', d.recipientEmail).limit(1).get(),
            ]);
            if (!byEmail.empty || !byCustomerEmail.empty) {
              await doc.ref.update({ sent: true, skippedReason: 'placed_order', sentAt: FieldValue.serverTimestamp() });
              console.log(`[sendScheduledEmails] Skipped (placed_order) lead #8 → ${d.recipientEmail}`);
              continue;
            }
          }
        }

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

// ── HTTP: unsubscribe ─────────────────────────────────────────────────────────
// URL: https://us-central1-{PROJECT_ID}.cloudfunctions.net/unsubscribe
// Query params: col (subscribers|leads), id (Firestore doc ID)

// ── HTTPS Callable: sendBroadcastEmail ───────────────────────────────────────
// Called from the Admin Panel Broadcast Email tool.
// Args: { subject, body, sendToSubscribers, sendToLeads }
// Returns: { sent, failed }

exports.sendBroadcastEmail = onCall({ cors: true, secrets: ['RESEND_API_KEY'] }, async (request) => {
  const { subject, body, sendToSubscribers, sendToLeads, segments } = request.data || {};

  const isSegmented = !!segments;

  if (isSegmented) {
    const required = ['skincare', 'femininecare', 'mensgrooming', 'haircare'];
    for (const key of required) {
      if (!segments[key] || !segments[key].subject || !segments[key].body) {
        throw new HttpsError('invalid-argument', `Missing subject or body for segment: ${key}`);
      }
    }
  } else {
    if (!subject || !body) {
      throw new HttpsError('invalid-argument', 'subject and body are required');
    }
  }
  if (!sendToSubscribers && !sendToLeads) {
    throw new HttpsError('invalid-argument', 'select at least one audience');
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    throw new HttpsError('internal', 'RESEND_API_KEY not configured');
  }

  const db = getFirestore();

  // Collect recipients from selected collections (skip unsubscribed)
  const recipients = []; // { id, col, name, email }

  if (sendToSubscribers) {
    const snap = await db.collection('subscribers').get();
    snap.forEach(d => {
      const data = d.data();
      if (data.unsubscribed) return;
      if (!data.email) return;
      recipients.push({ id: d.id, col: 'subscribers', name: data.name || '', email: data.email });
    });
  }

  if (sendToLeads) {
    const snap = await db.collection('leads').get();
    snap.forEach(d => {
      const data = d.data();
      if (data.unsubscribed) return;
      if (!data.email) return;
      // Avoid duplicates if same email is in both collections
      if (!recipients.some(r => r.email === data.email)) {
        recipients.push({ id: d.id, col: 'leads', name: data.name || '', email: data.email, brandType: data.brandType || '' });
      }
    });
  }

  // Pick the right segment for a recipient based on their brandType
  function pickSegment(brandType) {
    const bt = (brandType || '').trim();
    if (bt === 'Feminine Care' || bt === 'Feminine care') return segments.femininecare;
    if (bt === "Men's Grooming" || bt === "Men's grooming" || bt === 'Mencare') return segments.mensgrooming;
    if (bt === 'Hair Care' || bt === 'Hair care') return segments.haircare;
    return segments.skincare; // default: Skincare + any unknown/missing brandType
  }

  let sent = 0;
  let failed = 0;
  const failures = []; // { email, name, col, reason }

  // Create a broadcast run doc now so failures can reference a runId
  const runRef = await db.collection('broadcastLogs').add({
    subject,
    sendToSubscribers: sendToSubscribers || false,
    sendToLeads:       sendToLeads || false,
    totalRecipients:   recipients.length,
    startedAt:         FieldValue.serverTimestamp(),
    status:            'running',
  });
  const runId = runRef.id;

  for (const r of recipients) {
    try {
      const unsubscribeUrl = `${UNSUBSCRIBE_BASE}?col=${r.col}&id=${r.id}`;
      const greeting = r.name ? `Hi ${r.name},` : 'Hi there,';

      // Segmented: pick per-recipient subject + body; unsegmented: use global values
      const recipSubject = isSegmented ? pickSegment(r.brandType).subject : subject;
      const recipBody    = isSegmented ? pickSegment(r.brandType).body    : body;

      // Preserve line breaks from plain-text body
      const bodyHtml = recipBody
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .split('\n')
        .map(line => line.trim() === '' ? '<br>' : `<p style="margin:0 0 14px;color:#555;font-size:0.9rem;line-height:1.6;">${line}</p>`)
        .join('\n');

      const html = wrapEmail('Message from Najah Chemist', `
        <h2 style="margin:0 0 16px;font-size:1.3rem;font-weight:700;color:#1a1a1a;">${recipSubject}</h2>
        <p style="margin:0 0 20px;font-size:1rem;">${greeting}</p>
        ${bodyHtml}
      `, unsubscribeUrl);

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'Najah Chemist <orders@najahchemistja.com>',
          to: [r.email],
          subject: recipSubject,
          html
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const reason  = `Resend ${res.status}: ${errData.message || errData.name || JSON.stringify(errData)}`;
        console.error(`[sendBroadcastEmail] Failed ${r.email}: ${reason}`);
        failures.push({ email: r.email, name: r.name, col: r.col, reason });
        failed++;
      } else {
        sent++;
      }
    } catch (err) {
      const reason = err.message || String(err);
      console.error(`[sendBroadcastEmail] Error ${r.email}:`, reason);
      failures.push({ email: r.email, name: r.name, col: r.col, reason });
      failed++;
    }
  }

  // Write each failure as a sub-document under the run
  for (const f of failures) {
    await db.collection('broadcastLogs').doc(runId)
      .collection('failures').add({
        email:     f.email,
        name:      f.name  || '',
        col:       f.col,
        reason:    f.reason,
        loggedAt:  FieldValue.serverTimestamp(),
      });
  }

  // Update the run doc with final counts
  await runRef.update({
    sent,
    failed,
    status:      failed === 0 ? 'complete' : 'complete_with_failures',
    completedAt: FieldValue.serverTimestamp(),
  });

  console.log(`[sendBroadcastEmail] Done — sent: ${sent}, failed: ${failed}, runId: ${runId}`);
  return { sent, failed, runId };
});

// ── Scheduled: checkReviewRequests (daily at 11am Jamaica time) ───────────────
// Fires 7 days after an order is marked Complete and sends a Google review request.
// Guards: requires email on order, sends once per order (reviewEmailSent: true).

const GOOGLE_REVIEW_URL = 'https://g.page/r/CSroEUHbcOi3EBM/review';

exports.checkReviewRequests = onSchedule(
  { schedule: '0 11 * * *', timeZone: 'America/Jamaica', secrets: ['RESEND_API_KEY'] },
  async () => {
    const db          = getFirestore();
    const now         = Date.now();
    const SEVEN_DAYS  = 7 * 24 * 60 * 60 * 1000;
    const cutoff      = new Date(now - SEVEN_DAYS);

    const snap = await db.collection('orders').where('status', '==', 'Complete').get();

    const candidates = snap.docs.filter(d => {
      const data = d.data();
      if (data.reviewEmailSent === true) return false;
      const email = data.email || data.customerEmail || '';
      if (!email) return false;
      // Use completedAt preferably, fall back to updatedAt
      const ts = toDate(data.completedAt || data.updatedAt);
      return ts && ts <= cutoff;
    });

    console.log(`[checkReviewRequests] ${candidates.length} eligible of ${snap.size} complete orders`);

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      console.warn('[checkReviewRequests] RESEND_API_KEY not configured — skipping');
      return;
    }

    for (const doc of candidates) {
      const order = doc.data();
      try {
        const email      = order.email || order.customerEmail;
        const clientName = getClientName(order);
        const first      = clientName.split(' ')[0];

        const html = wrapEmail('How Was Your Order?', `
          <h2 style="margin:0 0 16px;font-size:1.3rem;font-weight:700;color:#1a1a1a;">How was your Najah Chemist order, ${first}? ⭐</h2>
          <p style="margin:0 0 16px;color:#555;font-size:0.9rem;line-height:1.6;">
            It's been a week since your order was completed — we hope you're happy with your products!
          </p>
          <p style="margin:0 0 16px;color:#555;font-size:0.9rem;line-height:1.6;">
            If you have a moment, we'd love a Google review. It helps other Jamaican entrepreneurs find us and helps us grow.
          </p>

          <div style="text-align:center;margin:28px 0;">
            <a href="${GOOGLE_REVIEW_URL}"
               style="display:inline-block;background:#1a1a1a;color:white;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:0.95rem;letter-spacing:0.02em;">
              👉 Leave a Review (30 seconds)
            </a>
          </div>

          <p style="margin:0 0 16px;color:#555;font-size:0.9rem;line-height:1.6;">
            Thank you for supporting a Jamaican business. 🇯🇲
          </p>

          <p style="margin:0;color:#555;font-size:0.9rem;line-height:1.6;">
            — Najah<br>
            <span style="font-size:0.82rem;color:#777;">Najah Chemist | Jamaica's Private Label Skincare Manufacturer</span>
          </p>
        `, null);

        // Mark sent FIRST to prevent duplicate sends on retry
        await doc.ref.update({
          reviewEmailSent:   true,
          reviewEmailSentAt: FieldValue.serverTimestamp()
        });

        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from:    'Najah Chemist <orders@najahchemistja.com>',
            to:      [email],
            subject: 'How was your Najah Chemist order? ⭐',
            html
          })
        });

        if (res.ok) {
          console.log(`[checkReviewRequests] Sent review request to ${email}`);
        } else {
          // Roll back the flag so it retries tomorrow
          await doc.ref.update({ reviewEmailSent: false }).catch(() => {});
          const err = await res.json().catch(() => ({}));
          console.error(`[checkReviewRequests] Resend failed ${email}: ${err.message || JSON.stringify(err)}`);
        }
      } catch (err) {
        await doc.ref.update({ reviewEmailSent: false }).catch(() => {});
        console.error(`[checkReviewRequests] Error for order ${doc.id}:`, err.message);
      }
    }

    console.log('[checkReviewRequests] Done.');
  }
);

// ── Scheduled: sendReorderEmails (daily at 10am Jamaica time) ────────────────
// 30 days after an order's status → Complete, send a personalised reorder email.
// Guards: requires email on order, sends once per order (reorderEmailSent: true).

exports.sendReorderEmails = onSchedule(
  { schedule: '0 10 * * *', timeZone: 'America/Jamaica', secrets: ['RESEND_API_KEY'] },
  async () => {
    const db          = getFirestore();
    const now         = Date.now();
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    const cutoff      = new Date(now - THIRTY_DAYS);

    const snap = await db.collection('orders').where('status', '==', 'Complete').get();

    const candidates = snap.docs.filter(d => {
      const data = d.data();
      if (data.reorderEmailSent === true) return false;
      if (data.unsubscribed === true) return false;
      const email = data.email || data.customerEmail || '';
      if (!email) return false;
      // completedAt set by onOrderComplete trigger; fall back to createdAt or date
      const ts = toDate(data.completedAt || data.createdAt || data.date);
      return ts && ts <= cutoff;
    });

    console.log(`[sendReorderEmails] ${candidates.length} eligible of ${snap.size} complete orders`);

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      console.warn('[sendReorderEmails] RESEND_API_KEY not configured — skipping');
      return;
    }

    for (const doc of candidates) {
      const order = doc.data();
      try {
        const email      = order.email || order.customerEmail;
        const clientName = getClientName(order);
        const first      = clientName.split(' ')[0];
        const orderId    = order.id || order.orderId || doc.id;
        // Show product name if available, otherwise fall back to order ID
        const lastOrder  = (order.product || '').trim() || orderId;
        const unsubUrl   = `${UNSUBSCRIBE_BASE}?col=orders&id=${encodeURIComponent(doc.id)}`;

        const html = wrapEmail('Time to Reorder?', `
          <h2 style="margin:0 0 16px;font-size:1.3rem;font-weight:700;color:#1a1a1a;">Hey ${first},</h2>
          <p style="margin:0 0 16px;color:#555;font-size:0.9rem;line-height:1.6;">
            It's been about a month since your last order with Najah Chemist — which means if you've been selling, you're probably running low.
          </p>
          <p style="margin:0 0 16px;color:#555;font-size:0.9rem;line-height:1.6;">
            <strong>Your last order:</strong> ${lastOrder}
          </p>
          <p style="margin:0 0 20px;color:#555;font-size:0.9rem;line-height:1.6;">
            Ready to restock? Reply to this email or message us on WhatsApp and we'll get your next batch ready within days.
          </p>
          <div style="text-align:center;margin:28px 0;">
            <a href="https://wa.me/18768851099" style="display:inline-block;background:#1a1a1a;color:white;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:0.95rem;letter-spacing:0.02em;">
              WhatsApp Najahuldin →
            </a>
          </div>
          <p style="margin:0 0 16px;color:#555;font-size:0.9rem;line-height:1.6;">
            And if you want to add a new product to your line this time, we can talk about that too.
          </p>
          <p style="margin:0;color:#555;font-size:0.9rem;line-height:1.6;">
            — Najahuldin, Najah Chemist<br>
            <span style="font-size:0.82rem;color:#777;">najahchemistja.com</span>
          </p>
        `, unsubUrl);

        // Mark sent FIRST — prevents duplicate send if function retries
        await doc.ref.update({
          reorderEmailSent:   true,
          reorderEmailSentAt: FieldValue.serverTimestamp()
        });

        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from:    'Najah Chemist <orders@najahchemistja.com>',
            to:      [email],
            subject: `Ready for your next batch, ${first}?`,
            html
          })
        });

        if (res.ok) {
          console.log(`[sendReorderEmails] Sent to ${email} for order ${orderId}`);
        } else {
          // Roll back so it retries tomorrow
          await doc.ref.update({ reorderEmailSent: false }).catch(() => {});
          const err = await res.json().catch(() => ({}));
          console.error(`[sendReorderEmails] Resend failed ${email}: ${err.message || JSON.stringify(err)}`);
        }
      } catch (err) {
        await doc.ref.update({ reorderEmailSent: false }).catch(() => {});
        console.error(`[sendReorderEmails] Error for order ${doc.id}:`, err.message);
      }
    }

    console.log('[sendReorderEmails] Done.');
  }
);

// ── Abandoned Cart Recovery ───────────────────────────────────────────────────

exports.checkAbandonedCarts = onSchedule(
  { schedule: 'every 30 minutes', timeZone: 'America/Jamaica', secrets: ['RESEND_API_KEY'] },
  async () => {
    const db  = getFirestore();
    const now = new Date();
    const cutoff = new Date(now.getTime() - 60 * 60 * 1000); // 60 minutes ago

    // Query carts not yet recovered; filter emailSent in JS to handle missing field
    const snap = await db.collection('abandonedCarts')
      .where('recovered', '==', false)
      .get();

    const due = snap.docs.filter(d => {
      const data = d.data();
      if (data.emailSent) return false;
      const ca = data.createdAt;
      if (!ca) return false;
      const createdAt = ca.toDate ? ca.toDate() : new Date(ca);
      return createdAt <= cutoff;
    });

    console.log(`[checkAbandonedCarts] ${due.length} eligible of ${snap.size} unrecovered`);

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      console.warn('[checkAbandonedCarts] RESEND_API_KEY not configured — skipping');
      return;
    }

    for (const cartDoc of due) {
      const d = cartDoc.data();
      try {
        const name  = d.name || 'there';
        const first = name.split(' ')[0];
        const items = Array.isArray(d.cartItems) ? d.cartItems : [];
        const itemsList = items.length
          ? items.map(i => `<li style="margin-bottom:0.3rem;">${i.name} — ${i.size} × ${i.qty}</li>`).join('')
          : '<li>Your selected items</li>';

        const html = `
<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #E5E7EB;">
  <div style="background:#0F0E0D;padding:1.4rem 2rem;text-align:center;">
    <span style="font-family:Georgia,serif;font-size:1.2rem;font-weight:700;color:white;">Najah Chemist</span>
    <div style="font-size:0.72rem;color:#9CA3AF;margin-top:0.2rem;letter-spacing:0.05em;text-transform:uppercase;">Jamaica's Private Label Skincare Manufacturer</div>
  </div>
  <div style="padding:2rem 2rem 1.5rem;">
    <p style="font-size:1rem;font-weight:700;color:#0F0E0D;margin:0 0 0.6rem;">Hi ${first},</p>
    <p style="color:#374151;line-height:1.7;margin:0 0 1.2rem;">You were checking out some of our products and left before completing your order.</p>
    <p style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.09em;color:#B45309;margin:0 0 0.5rem;">Here's what you had in your cart</p>
    <ul style="margin:0 0 1.5rem;padding-left:1.3rem;color:#374151;line-height:2;">
      ${itemsList}
    </ul>
    <p style="color:#374151;line-height:1.7;margin:0 0 1.5rem;">Your formula is ready — just waiting on you.</p>
    <div style="text-align:center;margin:1.5rem 0;">
      <a href="https://najahchemistja.com" style="display:inline-block;background:#B45309;color:white;text-decoration:none;padding:0.8rem 2rem;border-radius:8px;font-weight:700;font-size:0.9rem;letter-spacing:0.02em;">Complete My Order →</a>
    </div>
    <p style="color:#374151;line-height:1.7;margin:1.5rem 0 0;">— Najah<br>
    <span style="font-size:0.82rem;color:#6B7280;">Najah Chemist | Jamaica's Private Label Skincare Manufacturer</span></p>
  </div>
  <div style="background:#F9FAFB;border-top:1px solid #E5E7EB;padding:1rem 2rem;text-align:center;">
    <p style="font-size:0.7rem;color:#9CA3AF;margin:0;line-height:1.6;">
      You received this because you added items to your cart on najahchemistja.com.<br>
      Reply to this email to unsubscribe from cart reminders.
    </p>
  </div>
</div>`;

        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from:    'Najah Chemist <orders@najahchemistja.com>',
            to:      [d.email],
            subject: "You left something behind 👀",
            html
          })
        });

        if (res.ok) {
          await cartDoc.ref.update({
            emailSent:   true,
            emailSentAt: FieldValue.serverTimestamp()
          });
          console.log(`[checkAbandonedCarts] Sent to ${d.email}`);
        } else {
          const err = await res.json().catch(() => ({}));
          console.error(`[checkAbandonedCarts] Resend failed ${d.email}: ${err.message || JSON.stringify(err)}`);
        }
      } catch(e) {
        console.error(`[checkAbandonedCarts] Error for ${d.email}:`, e.message);
      }
    }
  }
);

exports.unsubscribe = functionsV1.https.onRequest(async (req, res) => {
  const col = req.query.col;
  const id  = req.query.id;

  if (!['subscribers', 'leads', 'orders'].includes(col) || !id) {
    res.status(400).send('Invalid unsubscribe link.');
    return;
  }

  try {
    const db = getFirestore();
    await db.collection(col).doc(id).update({
      unsubscribed:    true,
      unsubscribedAt:  FieldValue.serverTimestamp()
    });
    console.log(`[unsubscribe] ${col}/${id} marked unsubscribed`);
  } catch (err) {
    console.error('[unsubscribe] Error:', err.message);
    res.status(500).send('Something went wrong. Please try again or reply to the email to unsubscribe.');
    return;
  }

  res.set('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Unsubscribed — Najah Chemist</title>
  <style>
    body { margin: 0; padding: 0; background: #faf8f5; font-family: Arial, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .box { text-align: center; padding: 2.5rem 2rem; max-width: 420px; }
    .check { font-size: 2.5rem; margin-bottom: 1rem; }
    h2 { margin: 0 0 0.6rem; font-size: 1.3rem; color: #1a1a1a; }
    p { color: #666; font-size: 0.88rem; line-height: 1.6; margin: 0 0 1.5rem; }
    a { color: #1a1a1a; font-size: 0.82rem; }
  </style>
</head>
<body>
  <div class="box">
    <div class="check">✓</div>
    <h2>You've been unsubscribed</h2>
    <p>You won't receive any more emails from Najah Chemist.<br>If this was a mistake, reply to any of our emails and we'll re-add you.</p>
    <a href="https://najahchemistja.com">← Back to Najah Chemist</a>
  </div>
</body>
</html>`);
});
