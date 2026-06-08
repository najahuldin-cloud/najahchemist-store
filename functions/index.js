// v2 functions/index.js
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
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const functionsV1 = require('firebase-functions/v1');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const Anthropic = require('@anthropic-ai/sdk');
const { google } = require('googleapis');

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

// Convert a phone number to international format for the WhatsApp Cloud API.
// Jamaican numbers entered as 876XXXXXXX need the country code "1" prepended.
function toIntlPhone(p) {
  const digits = normalizePhone(p);
  if (digits.startsWith('876')) return '1' + digits;
  return digits;
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

// ── Firestore Trigger: notify owner when new order created ────────────────────

exports.onOrderCreated = onDocumentCreated(
  { document: 'orders/{orderId}', secrets: ['RESEND_API_KEY', 'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID'] },
  async (event) => {
    const data    = event.data.data();
    const orderId = event.params.orderId;

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      console.warn('[onOrderCreated] RESEND_API_KEY not configured — skipping');
      return;
    }

    const displayId  = data.id || data.orderId || orderId;
    const clientName = getClientName(data);
    const phone      = getPhone(data);
    const payMethod  = data.payMethod || data.payment || '—';
    const total      = data.total ? `J$${Number(data.total).toLocaleString()}` : '—';
    const shipDetail = data.shippingDetail || data.deliveryLocation || '—';
    const items      = buildItemsList(data);

    const itemRowsHtml = items.length > 0
      ? items.map(i =>
          `<tr>
            <td style="padding:8px 12px;border-bottom:1px solid #f0ece8;color:#1a1a1a;">${i.name}${i.size && i.size !== '—' ? ' — ' + i.size : ''}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #f0ece8;text-align:center;color:#555;">×${i.qty || 1}</td>
          </tr>`).join('')
      : `<tr><td colspan="2" style="padding:8px 12px;color:#777;">${data.product || 'See order'}</td></tr>`;

    const waLink = phone
      ? `<a href="https://wa.me/${phone.replace(/\D/g,'')}" style="color:#B45309;font-weight:600;text-decoration:none;">WhatsApp ${phone}</a>`
      : '—';

    const html = wrapEmail('New Order 🛒', `
      <h2 style="margin:0 0 16px;font-size:1.3rem;font-weight:700;color:#1a1a1a;">New order received 🛒</h2>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
        <tr><td style="padding:4px 0;color:#777;font-size:0.85rem;width:120px;">Order ID</td><td style="padding:4px 0;font-weight:600;color:#1a1a1a;">NC-${displayId}</td></tr>
        <tr><td style="padding:4px 0;color:#777;font-size:0.85rem;">Customer</td><td style="padding:4px 0;color:#1a1a1a;">${clientName}</td></tr>
        <tr><td style="padding:4px 0;color:#777;font-size:0.85rem;">Phone</td><td style="padding:4px 0;color:#1a1a1a;">${waLink}</td></tr>
        <tr><td style="padding:4px 0;color:#777;font-size:0.85rem;">Payment</td><td style="padding:4px 0;color:#1a1a1a;">${payMethod}</td></tr>
        <tr><td style="padding:4px 0;color:#777;font-size:0.85rem;">Shipping</td><td style="padding:4px 0;color:#1a1a1a;">${shipDetail}</td></tr>
        <tr><td style="padding:4px 0;color:#777;font-size:0.85rem;">Total</td><td style="padding:4px 0;font-weight:700;color:#1a1a1a;">${total}</td></tr>
      </table>

      <p style="margin:0 0 8px;font-weight:600;font-size:0.9rem;color:#1a1a1a;">Items ordered:</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;border:1px solid #f0ece8;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#f5f1ec;">
            <th style="padding:8px 12px;text-align:left;font-size:0.78rem;color:#777;font-weight:600;">Product</th>
            <th style="padding:8px 12px;text-align:center;font-size:0.78rem;color:#777;font-weight:600;">Qty</th>
          </tr>
        </thead>
        <tbody>${itemRowsHtml}</tbody>
      </table>
    `, null);

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from:    'Najah Chemist Orders <orders@najahchemistja.com>',
          to:      ['start@najahchemistja.com'],
          subject: `New order — NC-${displayId} | ${clientName} | ${total}`,
          html
        })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(`Resend error ${res.status}: ${errData.message || JSON.stringify(errData)}`);
      }
      console.log(`[onOrderCreated] Owner notified for order ${displayId}`);
    } catch (err) {
      console.error(`[onOrderCreated] Notification failed for ${displayId}:`, err.message);
    }

    // Send WhatsApp confirmation to the client via approved Meta template
    const clientPhone = toIntlPhone(phone);
    if (clientPhone) {
      try {
        await sendWhatsApp(clientPhone, null, {
          name: 'order_confirmation',
          language: 'en',
          params: [clientName, `NC-${displayId}`, total]
        });
        console.log(`[onOrderCreated] Client WhatsApp sent to ${clientPhone} for ${displayId}`);
      } catch (err) {
        console.error(`[onOrderCreated] Client WhatsApp failed for ${displayId}:`, err.message);
      }
    } else {
      console.log(`[onOrderCreated] No phone on order ${displayId} — skipping client WhatsApp`);
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
  { schedule: '0 9 * * *', timeZone: 'America/Jamaica', secrets: ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID'] },
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
        const reorderMsg =
          `Hi ${clientName} 👋 It's been 25 days since your Najah Chemist order — ` +
          `your products might be running low soon! Ready to reorder before you sell out? ` +
          `Place your next order here: https://najahchemistja.com/start — Najah Chemist 🌿`;
        await sendWhatsApp(toIntlPhone(phone), reorderMsg);

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

async function sendWhatsApp(phone, message, templateOpts) {
  const token   = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;

  if (!token || !phoneId) {
    console.warn('[whatsapp] WHATSAPP_TOKEN or WHATSAPP_PHONE_ID not configured — skipping WhatsApp');
    return;
  }

  const body = templateOpts
    ? {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
          name: templateOpts.name,
          language: { code: templateOpts.language },
          components: [{
            type: 'body',
            parameters: templateOpts.params.map(p => ({ type: 'text', text: String(p) }))
          }]
        }
      }
    : {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { body: message }
      };

  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WhatsApp API ${res.status}: ${err}`);
  }
}

// ── Morning digest: daily 8am Jamaica lead/order summary to the owner ──────────

// TODO: Switch back to sendWhatsApp once +18763499729 is activated on WABA 505936159266553
exports.morningDigest = onSchedule(
  { schedule: '0 8 * * *', timeZone: 'America/Jamaica', secrets: ['RESEND_API_KEY'] },
  async () => {
    const db = getFirestore();

    // Today's date in Jamaica (YYYY-MM-DD) — followUpDate is stored as that string
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Jamaica' }).format(new Date());

    const [leadsSnap, ordersSnap] = await Promise.all([
      db.collection('leads').get(),
      db.collection('orders').get()
    ]);

    let newLeads = 0;
    let followUpsDue = 0;
    leadsSnap.forEach(doc => {
      const l = doc.data();
      const status = l.status || 'New';
      if (status === 'New') newLeads++;
      if (l.followUpDate && l.followUpDate <= todayStr && status !== 'Ordered' && status !== 'Cold') {
        followUpsDue++;
      }
    });

    let ordersPending = 0;
    ordersSnap.forEach(doc => {
      const status = doc.data().status;
      if (status === 'Pending' || status === 'Processing') ordersPending++;
    });

    const message =
      `Good morning Najah 👋🏾\n\n` +
      `Here's your lead summary for today:\n\n` +
      `🆕 New leads: ${newLeads}\n` +
      `📅 Follow-ups due today: ${followUpsDue}\n` +
      `📦 Orders pending: ${ordersPending}\n\n` +
      `Open Lead Manager: https://najahchemistja.com/admin\n\n` +
      `— Najah Chemist System 🌿`;

    console.log(`[morningDigest] ${todayStr} — new:${newLeads} followups:${followUpsDue} pending:${ordersPending}`);

    const html = `<div style="font-family:Outfit,Arial,sans-serif;font-size:15px;color:#1a1a1a;line-height:1.6;white-space:pre-wrap;">${message}</div>`;
    await sendResendEmail('start@najahchemistja.com', `☀️ Morning Lead Digest — ${todayStr}`, html);

    console.log('[morningDigest] Sent.');
  }
);

// ── Evening digest: daily 6pm Jamaica lead/order summary to the owner ──────────

// TODO: Switch back to sendWhatsApp once +18763499729 is activated on WABA 505936159266553
exports.eveningDigest = onSchedule(
  { schedule: '0 18 * * *', timeZone: 'America/Jamaica', secrets: ['RESEND_API_KEY'] },
  async () => {
    const db = getFirestore();

    // Today's date in Jamaica (YYYY-MM-DD) — followUpDate is stored as that string
    const fmtJa = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Jamaica' });
    const todayStr = fmtJa.format(new Date());

    const [leadsSnap, ordersSnap] = await Promise.all([
      db.collection('leads').get(),
      db.collection('orders').get()
    ]);

    let newLeads = 0;
    let followUpsDue = 0;
    leadsSnap.forEach(doc => {
      const l = doc.data();
      const status = l.status || 'New';
      // New leads created today (Jamaica date)
      const created = toDate(l.createdAt);
      const createdStr = created ? fmtJa.format(created) : null;
      if (status === 'New' && createdStr === todayStr) newLeads++;
      if (l.followUpDate && l.followUpDate <= todayStr && status !== 'Ordered' && status !== 'Cold') {
        followUpsDue++;
      }
    });

    let ordersPending = 0;
    ordersSnap.forEach(doc => {
      const status = doc.data().status;
      if (status === 'Pending' || status === 'Processing') ordersPending++;
    });

    const message =
      `Good evening Najah 👋🏾\n\n` +
      `Afternoon lead summary:\n\n` +
      `🆕 New leads since this morning: ${newLeads}\n` +
      `📅 Follow-ups due today: ${followUpsDue}\n` +
      `📦 Orders pending: ${ordersPending}\n\n` +
      `Don't let leads go cold overnight — reply before 8pm for best conversion.\n\n` +
      `Open Lead Manager: https://najahchemistja.com/admin\n\n` +
      `— Najah Chemist System 🌿`;

    console.log(`[eveningDigest] ${todayStr} — new:${newLeads} followups:${followUpsDue} pending:${ordersPending}`);

    const html = `<div style="font-family:Outfit,Arial,sans-serif;font-size:15px;color:#1a1a1a;line-height:1.6;white-space:pre-wrap;">${message}</div>`;
    await sendResendEmail('start@najahchemistja.com', `🌙 Evening Lead Digest — ${todayStr}`, html);

    console.log('[eveningDigest] Sent.');
  }
);

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

  let bundleHtml = '';
  if (bt === 'Skincare') {
    bundleHtml = `<div style="background:#fdf8ef;border:1px solid #c9a96e;border-radius:10px;padding:16px 20px;margin:20px 0;">
      <p style="margin:0 0 8px;font-size:0.88rem;font-weight:700;color:#1a1a1a;">⭐ Or skip the guesswork entirely</p>
      <p style="margin:0 0 10px;color:#555;font-size:0.9rem;line-height:1.6;">Our <strong>HydraGlow Skincare Bundle</strong> gives you 6 of each product, ready to label and sell, for <strong>J$25,200</strong>. Retail value J$60,000+. That's a <strong>J$34,800 profit</strong> from your first order.</p>
      <p style="margin:0 0 8px;color:#555;font-size:0.9rem;line-height:1.6;">👉 Reply YES and I'll send you the bundle details.</p>
      <p style="margin:0;font-size:0.8rem;color:#888;font-style:italic;">Note: Bundles are pre-set and cannot be customised. For a custom product mix, visit <a href="https://najahchemistja.com/customise" style="color:#888;">najahchemistja.com/customise</a></p>
    </div>`;
  } else if (bt === 'Feminine Care') {
    bundleHtml = `<div style="background:#fdf8ef;border:1px solid #c9a96e;border-radius:10px;padding:16px 20px;margin:20px 0;">
      <p style="margin:0 0 8px;font-size:0.88rem;font-weight:700;color:#1a1a1a;">⭐ Or start with our Feminine Care Starter Kit</p>
      <p style="margin:0 0 10px;color:#555;font-size:0.9rem;line-height:1.6;">6 Yoni Washes, 6 VagiMists, 6 Steam Herbs, and 6 packs of Yoni Pops, all ready to label and sell, for <strong>J$12,500</strong>. Retail value J$30,000+. That's <strong>J$17,500 profit</strong> from your first order.</p>
      <p style="margin:0 0 8px;color:#555;font-size:0.9rem;line-height:1.6;">👉 Reply YES and I'll send you the bundle details.</p>
      <p style="margin:0;font-size:0.8rem;color:#888;font-style:italic;">Note: Bundles are pre-set and cannot be customised. For a custom product mix, visit <a href="https://najahchemistja.com/customise" style="color:#888;">najahchemistja.com/customise</a></p>
    </div>`;
  } else if (bt === "Men's Grooming") {
    bundleHtml = `<div style="background:#fdf8ef;border:1px solid #c9a96e;border-radius:10px;padding:16px 20px;margin:20px 0;">
      <p style="margin:0 0 8px;font-size:0.88rem;font-weight:700;color:#1a1a1a;">⭐ Or start with our Mencare Bundle</p>
      <p style="margin:0 0 10px;color:#555;font-size:0.9rem;line-height:1.6;">6 Intimate Washes, 6 Beard Balms, and 6 Beard Shampoos, all ready to label and sell, for <strong>J$11,000</strong>. Retail value J$28,000+. That's <strong>J$17,000 profit</strong> from your first order.</p>
      <p style="margin:0 0 8px;color:#555;font-size:0.9rem;line-height:1.6;">👉 Reply YES and I'll send you the bundle details.</p>
      <p style="margin:0;font-size:0.8rem;color:#888;font-style:italic;">Note: Bundles are pre-set and cannot be customised. For a custom product mix, visit <a href="https://najahchemistja.com/customise" style="color:#888;">najahchemistja.com/customise</a></p>
    </div>`;
  } else if (bt === 'Hair Care' || bt === 'Hair care') {
    bundleHtml = `<div style="background:#fdf8ef;border:1px solid #c9a96e;border-radius:10px;padding:16px 20px;margin:20px 0;">
      <p style="margin:0 0 8px;font-size:0.88rem;font-weight:700;color:#1a1a1a;">⭐ Start with 1 litre of Ayurvedic Hair Growth Oil</p>
      <p style="margin:0 0 10px;color:#555;font-size:0.9rem;line-height:1.6;">Fills 16 × 2oz bottles. At J$2,000 retail that's <strong>J$32,000 revenue</strong> from one <strong>J$7,500 order</strong>.</p>
      <p style="margin:0 0 8px;color:#555;font-size:0.9rem;line-height:1.6;">👉 Reply YES and I'll send you the details.</p>
      <p style="margin:0;font-size:0.8rem;color:#888;font-style:italic;">Note: Bundles are pre-set and cannot be customised. For a custom product mix, visit <a href="https://najahchemistja.com/customise" style="color:#888;">najahchemistja.com/customise</a></p>
    </div>`;
  }

  return wrapEmail(subtitle, `
    <h2 style="margin:0 0 16px;font-size:1.3rem;font-weight:700;color:#1a1a1a;">Hey ${first},</h2>
    <p style="margin:0 0 16px;color:#555;font-size:0.9rem;line-height:1.6;">${intro}</p>
    ${productsHeaderHtml}
    <div style="margin:0 0 20px;">${productsHtml}</div>
    ${bundleHtml}
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

  let day7BundlePara = '';
  if (bt === 'Skincare') {
    day7BundlePara = `<p style="margin:0 0 8px;font-size:0.9rem;font-weight:600;color:#1a1a1a;">The HydraGlow Bundle is J$25,200 — complete skincare line, ready to sell, profit of J$34,800.</p><p style="margin:0 0 16px;font-size:0.8rem;color:#888;font-style:italic;">Note: Bundles are pre-set and cannot be customised. For a custom product mix, visit <a href="https://najahchemistja.com/customise" style="color:#888;">najahchemistja.com/customise</a></p>`;
  } else if (bt === 'Feminine Care') {
    day7BundlePara = `<p style="margin:0 0 8px;font-size:0.9rem;font-weight:600;color:#1a1a1a;">The Feminine Care Starter Kit is J$12,500 — complete feminine care line, profit of J$17,500.</p><p style="margin:0 0 16px;font-size:0.8rem;color:#888;font-style:italic;">Note: Bundles are pre-set and cannot be customised. For a custom product mix, visit <a href="https://najahchemistja.com/customise" style="color:#888;">najahchemistja.com/customise</a></p>`;
  } else if (bt === "Men's Grooming") {
    day7BundlePara = `<p style="margin:0 0 8px;font-size:0.9rem;font-weight:600;color:#1a1a1a;">The Mencare Bundle is J$11,000 — complete men's grooming line, profit of J$17,000.</p><p style="margin:0 0 16px;font-size:0.8rem;color:#888;font-style:italic;">Note: Bundles are pre-set and cannot be customised. For a custom product mix, visit <a href="https://najahchemistja.com/customise" style="color:#888;">najahchemistja.com/customise</a></p>`;
  } else if (bt === 'Hair Care' || bt === 'Hair care') {
    day7BundlePara = `<p style="margin:0 0 8px;font-size:0.9rem;font-weight:600;color:#1a1a1a;">1 litre of Hair Growth Oil is J$7,500 — fills 16 bottles, retail value J$32,000.</p><p style="margin:0 0 16px;font-size:0.8rem;color:#888;font-style:italic;">Note: Bundles are pre-set and cannot be customised. For a custom product mix, visit <a href="https://najahchemistja.com/customise" style="color:#888;">najahchemistja.com/customise</a></p>`;
  }

  return wrapEmail('Your First Order', `
    <h2 style="margin:0 0 16px;font-size:1.3rem;font-weight:700;color:#1a1a1a;">Hey ${first},</h2>
    <p style="margin:0 0 16px;color:#555;font-size:0.9rem;line-height:1.6;">You've had the Brand Launch Guide for a week. I want to make this as easy as possible for you.</p>
    <p style="margin:0 0 16px;color:#555;font-size:0.9rem;line-height:1.6;">Your first order is just 1 litre. No large investment, no bulk inventory, no risk.</p>
    ${productRecPara}
    ${ctaPara}
    ${day7BundlePara}
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

// Two-way AI email auto-responder (leads only). Sends a segment-personalised
// first email via Resend, opens the conversation thread, and marks the lead
// "Contacted". Replies are handled by handleEmailReply (Gmail Pub/Sub → Claude).
// NOTE: this replaces the old lead drip (emails 2/3/8). The subscriber sequence
// (onSubscriberCreated) is intentionally left untouched.
exports.onLeadCreated = onDocumentCreated({ document: 'leads/{id}', secrets: ['RESEND_API_KEY'] }, async (event) => {
  const data  = event.data.data();
  const email = (data.email || '').trim();
  const name  = data.name || '';
  const docId = event.params.id;
  const brandType = data.brandType || '';

  // (D) Skip if no email address
  if (!email) {
    console.warn('[onLeadCreated] No email field — skipping');
    return;
  }

  const db = getFirestore();

  // (E) Deduplication — skip if another lead doc already exists with this email
  const dupSnap = await db.collection('leads').where('email', '==', email).get();
  if (dupSnap.docs.some(d => d.id !== docId)) {
    console.log(`[onLeadCreated] Duplicate email ${email} — skipping AI outreach`);
    return;
  }

  const first   = (name || 'there').split(' ')[0];
  const seg      = leadSegment(brandType);
  const subject  = seg.key === 'general'
    ? 'Your wholesale brand starts here 🌿 — Najah Chemist'
    : `Your ${seg.word} brand starts here 🌿 — Najah Chemist`;
  const bodyText = leadFirstEmailBody(seg.key, first);

  // (A) Send the instant first email via Resend (X-Lead-ID header = doc ID)
  try {
    await sendLeadEmail({ to: email, subject, text: bodyText, leadId: docId });
    console.log(`[onLeadCreated] First AI email sent to ${email} (segment: ${seg.key})`);
  } catch (err) {
    console.error(`[onLeadCreated] First email failed for ${email}:`, err.message);
    return; // don't mark Contacted if the send failed
  }

  // (B/C) Store conversation history + (C) update status to Contacted
  await event.data.ref.set({
    status:            'Contacted',
    emailCount:        1,
    emailSubject:      subject,
    segment:           seg.key,
    followUpSent:      false,
    emailConversation: [{ role: 'assistant', text: bodyText, subject, at: new Date().toISOString() }]
  }, { merge: true });

  console.log(`[onLeadCreated] Lead ${docId} marked Contacted (segment: ${seg.key})`);
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
// Args: { subject, body, sendToSubscribers, sendToLeads, sendToClients }
// Returns: { sent, failed }

exports.sendBroadcastEmail = onCall({ cors: true, enforceAppCheck: false, timeoutSeconds: 540, secrets: ['RESEND_API_KEY'] }, async (request) => {
  const { subject, body, sendToSubscribers, sendToLeads, sendToClients, segments } = request.data || {};

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
  if (!sendToSubscribers && !sendToLeads && !sendToClients) {
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

  if (sendToClients) {
    // Pull unique paying customers from the orders collection.
    // Skip Cancelled/Refunded orders; deduplicate by email across all selected audiences.
    const snap = await db.collection('orders').get();
    snap.forEach(d => {
      const data = d.data();
      const status = (data.status || '').toLowerCase();
      if (status === 'cancelled' || status === 'refunded') return;
      const email = (data.email || data.customerEmail || '').trim();
      if (!email) return;
      if (!recipients.some(r => r.email === email)) {
        recipients.push({ id: d.id, col: 'orders', name: data.client || data.customerName || data.clientName || '', email, brandType: data.brandType || '' });
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

  const testMode = recipients.length === 1;
  if (testMode) {
    console.log(`[sendBroadcastEmail] TEST MODE — single recipient: ${recipients[0].email}, isSegmented: ${isSegmented}`);
  }

  // Create a broadcast run doc now so failures can reference a runId
  // NOTE: subject is undefined for segmented broadcasts — use a safe fallback to avoid
  // Firestore throwing "Cannot use undefined as a Firestore value"
  let runRef, runId;
  try {
    runRef = await db.collection('broadcastLogs').add({
      subject:           isSegmented ? '(segmented)' : subject,
      isSegmented:       isSegmented || false,
      sendToSubscribers: sendToSubscribers || false,
      sendToLeads:       sendToLeads || false,
      sendToClients:     sendToClients || false,
      totalRecipients:   recipients.length,
      startedAt:         FieldValue.serverTimestamp(),
      status:            'running',
    });
    runId = runRef.id;
    console.log(`[sendBroadcastEmail] broadcastLogs doc created: ${runId}`);
  } catch (err) {
    console.error(`[sendBroadcastEmail] FATAL: broadcastLogs.add() failed:`, err.message, err.stack);
    throw new HttpsError('internal', `Failed to create broadcast log: ${err.message}`);
  }

  // Email format check (local@domain.tld) — invalid addresses are skipped, not sent
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Send a single recipient — validation, logging, and error handling unchanged
  async function processRecipient(r) {
    // Validate email format — skip invalid addresses silently, count them as failed
    if (!EMAIL_RE.test((r.email || '').trim())) {
      console.warn(`[sendBroadcastEmail] Skipping invalid email: ${r.email}`);
      failures.push({ email: r.email, name: r.name, col: r.col, reason: 'Invalid email format' });
      failed++;
      return;
    }
    try {
      const unsubscribeUrl = `${UNSUBSCRIBE_BASE}?col=${r.col}&id=${r.id}`;
      const greeting = r.name ? `Hi ${r.name},` : 'Hi there,';

      // Segmented: pick per-recipient subject + body; unsegmented: use global values
      const seg          = isSegmented ? pickSegment(r.brandType) : null;
      const recipSubject = isSegmented ? seg.subject : subject;
      const recipBody    = isSegmented ? seg.body    : body;

      if (testMode) {
        console.log(`[sendBroadcastEmail] TEST recipient:`, JSON.stringify({ email: r.email, brandType: r.brandType || '(none)', recipSubject, bodySnippet: (recipBody || '').slice(0, 80) }));
      }

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

      const payload = {
        from: 'Najah Chemist <orders@najahchemistja.com>',
        to: [r.email],
        subject: recipSubject,
        html
      };

      if (testMode) {
        console.log(`[sendBroadcastEmail] TEST Resend payload (no html):`, JSON.stringify({ from: payload.from, to: payload.to, subject: payload.subject }));
      }

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const reason  = `Resend ${res.status}: ${errData.message || errData.name || JSON.stringify(errData)}`;
        console.error(`[sendBroadcastEmail] Failed ${r.email}: ${reason}`);
        failures.push({ email: r.email, name: r.name, col: r.col, reason });
        failed++;
      } else {
        if (testMode) {
          const resData = await res.json().catch(() => ({}));
          console.log(`[sendBroadcastEmail] TEST Resend success:`, JSON.stringify(resData));
        }
        sent++;
      }
    } catch (err) {
      const reason = err.message || String(err);
      console.error(`[sendBroadcastEmail] Error ${r.email}:`, reason, err.stack);
      failures.push({ email: r.email, name: r.name, col: r.col, reason });
      failed++;
    }
  }

  // Process recipients in batches of 50 with a 1s pause between batches so large
  // broadcasts (445+) complete well under the timeout instead of deadline-exceeding
  const BATCH_SIZE = 50;
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(r => processRecipient(r)));
    if (i + BATCH_SIZE < recipients.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
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

// ── HTTPS Callable: notifyRestock ─────────────────────────────────────────────
// Called from admin panel when a product is toggled hidden→visible.
// Uses Admin SDK to bypass Firestore security rules.
exports.notifyRestock = onCall({ cors: true, secrets: ['RESEND_API_KEY'] }, async (request) => {
  const { productId, productName } = request.data || {};
  if (!productId || !productName) {
    throw new HttpsError('invalid-argument', 'Missing productId or productName');
  }

  const db = getFirestore();
  const emails = new Set();

  try {
    const snap = await db.collection('leads').get();
    snap.docs.forEach(d => { const e = d.data().email || ''; if (e.includes('@')) emails.add(e.toLowerCase()); });
  } catch(e) { console.warn('[notifyRestock] leads failed:', e.message); }

  try {
    const snap = await db.collection('clients').get();
    snap.docs.forEach(d => { const e = d.data().email || ''; if (e.includes('@')) emails.add(e.toLowerCase()); });
  } catch(e) { console.warn('[notifyRestock] clients failed:', e.message); }

  try {
    const snap = await db.collection('orders').get();
    snap.docs.forEach(d => {
      const data = d.data();
      const prod  = data.product || '';
      const email = data.email || data.clientEmail || '';
      if (email.includes('@') && (prod === productId || prod === productName)) {
        emails.add(email.toLowerCase());
      }
    });
  } catch(e) { console.warn('[notifyRestock] orders failed:', e.message); }

  try {
    const snap = await db.collection('waitlist').where('productId', '==', productId).get();
    snap.docs.forEach(d => { const e = d.data().email || ''; if (e.includes('@')) emails.add(e.toLowerCase()); });
  } catch(e) { console.warn('[notifyRestock] waitlist failed:', e.message); }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) throw new HttpsError('internal', 'RESEND_API_KEY not configured');

  const productUrl = `https://najahchemistja.com/?openProduct=${productId}`;
  let sent = 0;

  for (const email of [...emails]) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendKey}` },
        body: JSON.stringify({
          from: 'Najah Chemist <orders@najahchemistja.com>',
          to: email,
          subject: `${productName} is back in stock at Najah Chemist`,
          html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
            <h2 style="color:#b8860b;margin:0 0 12px;">Great news — it's back!</h2>
            <p style="color:#333;font-size:15px;line-height:1.6;">
              <strong>${productName}</strong> is back in stock and ready to order.
              Don't wait — stock is limited and others are watching too.
            </p>
            <a href="${productUrl}"
               style="display:inline-block;margin:20px 0;padding:14px 28px;background:#b8860b;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:15px;">
              Order Now →
            </a>
            <p style="color:#666;font-size:13px;line-height:1.6;">
              Questions? WhatsApp us at <a href="https://wa.me/18768851099" style="color:#b8860b;">+1 876-885-1099</a>
            </p>
            <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
            <p style="color:#999;font-size:12px;">Najah Chemist · Kingston, Jamaica · najahchemistja.com</p>
          </div>`
        })
      });
      if (res.ok) { sent++; }
      else {
        const err = await res.json().catch(() => ({}));
        console.warn(`[notifyRestock] Resend failed ${email}:`, err.message || JSON.stringify(err));
      }
    } catch(e) { console.warn('[notifyRestock] email error for', email, e.message); }
  }

  try {
    const msg = encodeURIComponent(`✅ Restock alert: *${productName}* is back in stock. ${sent} people notified.`);
    await fetch(`https://api.callmebot.com/whatsapp.php?phone=18768851099&text=${msg}&apikey=9757849`);
  } catch(e) { console.warn('[notifyRestock] WhatsApp failed:', e.message); }

  console.log(`[notifyRestock] Done — productId: ${productId}, sent: ${sent}`);
  return { count: sent };
});

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

// ══════════════════════════════════════════════════════════════════════════════
// TWO-WAY AI EMAIL AUTO-RESPONDER FOR LEADS
// ──────────────────────────────────────────────────────────────────────────────
//   onLeadCreated (above)  → sends segment-personalised first email
//   handleEmailReply       → Gmail Pub/Sub push → Claude reads reply → AI responds
//   checkLeadFollowUps     → daily 9am: 3-day no-reply nudge for emailCount==1 leads
//
// Lead doc fields used: email, name, brandType, status, emailCount, emailSubject,
//   segment, followUpSent, unsubscribed, emailConversation [{role,text,subject,at}]
// Email cap: we send at most 7 emails per lead; the 7th (if not a hot lead) is the
//   closing "staying in touch" email and the lead is marked Cold.
// ══════════════════════════════════════════════════════════════════════════════

const LEAD_FROM = 'Najah <start@najahchemistja.com>';
const ADMIN_EMAIL = 'start@najahchemistja.com';

// Map a lead.brandType to a segment for first-email personalisation.
function leadSegment(brandType) {
  const bt = (brandType || '').trim().toLowerCase();
  if (bt.includes('hair'))                          return { key: 'haircare', word: 'hair care' };
  if (bt.includes('feminine') || bt.includes('yoni')) return { key: 'feminine', word: 'feminine care' };
  if (bt.includes('men'))                           return { key: 'mens',     word: "men's grooming" };
  if (bt.includes('body'))                          return { key: 'bodycare', word: 'body care' };
  if (bt.includes('skin'))                          return { key: 'skincare', word: 'skincare' };
  return { key: 'general', word: 'wholesale' };
}

const LEAD_SIGNATURE =
  `Najah\n` +
  `Brand Consultant | Najah Chemist 🌿\n` +
  `najahchemistja.com | start@najahchemistja.com\n` +
  `WhatsApp: +1 876-885-1099`;

// Segment-personalised first-email body (plain text). [Name] → first name.
function leadFirstEmailBody(key, first) {
  const name = first || 'there';
  const browse =
    `👉 Browse products and pricing:\n` +
    `- Full product range: https://najahchemistja.com\n` +
    `- Wholesale price list: https://najahchemistja.com/guide/wholesale-price-list`;

  if (key === 'skincare') {
    return `Hi ${name},

I saw you're interested in starting your skincare brand — great timing, skincare is one of the fastest moving categories in Jamaica right now.

The smartest way to start is with 1–2 proven products so you can begin making sales quickly.

I'd recommend starting with:
- Turmeric & Kojic Soap — high demand, easy to sell
- Dark Spot Corrector Cream — consistent best-seller

You package and brand them under your own business name. We manufacture, you sell.

500+ clients island-wide have built their brands with us — most make their first sales within the week.

Prices start from J$3,550 per litre (under US$22) so you can start small.

${browse}
- Starter Kit (save 5%): https://najahchemistja.com

Our HydraGlow Skincare Bundle is J$25,200 — 24 products (4 types × 6 pieces each) ready to label and sell. Retail value J$60,000+.

Are you looking to test with 1–2 products first or build out a fuller line from the start?

${LEAD_SIGNATURE}`;
  }

  if (key === 'haircare') {
    return `Hi ${name},

I saw you're interested in starting a hair care brand — strong and growing market in Jamaica right now.

To start smart, I'd recommend focusing on 1–2 products with high repeat purchase.

Best starting products:
- Hair Growth Oil — J$7,500 per litre, high demand, customers reorder monthly
- Hair Butter — J$4,600 per 2 lbs, pairs naturally, builds a complete hair care routine

You brand them under your own business. We manufacture everything here in Jamaica.

500+ clients island-wide have built their brands with us.

Prices start from J$4,600 per 2 lbs so you can start small and scale up.

${browse}

Are you looking to start with 1–2 products first or build a complete hair care line?

${LEAD_SIGNATURE}`;
  }

  if (key === 'feminine') {
    return `Hi ${name},

I saw you're interested in starting a feminine care brand — one of the highest-demand niches in Jamaica right now and it builds strong customer loyalty.

To start smart, I'd recommend focusing on 1–2 core products that sell consistently.

Best starting products:
- Yoni Foaming Wash — J$3,550 per litre, daily use, high repeat purchase
- Boric Acid Capsules — 100 caps J$3,750, very high demand, customers come back monthly

You brand them under your own business. We manufacture everything here in Jamaica.

500+ clients island-wide have built their brands with us.

Prices start from J$3,550 per litre so you can start small.

${browse}

Are you looking to start with 1–2 products first or build a complete feminine care line?

${LEAD_SIGNATURE}`;
  }

  if (key === 'bodycare') {
    return `Hi ${name},

I saw you're interested in starting your body care brand — strong market right now especially for glow and brightening products.

The best move is starting with 1–2 fast-moving products so you can test and make sales quickly.

I'd recommend:
- Body Butter — J$4,000 per 2 lbs, sells consistently year round
- Brightening Body Scrub — J$5,500 per 2 lbs, very popular, high repeat purchase

You brand and package them under your own label. We handle the manufacturing.

500+ clients island-wide have built their brands with us — most make their first sales within the week.

Prices start from J$4,000 per 2 lbs.

${browse}

Are you going for a small test start or building a fuller line right away?

${LEAD_SIGNATURE}`;
  }

  if (key === 'mens') {
    return `Hi ${name},

I saw you're interested in starting a men's grooming brand — solid niche, strong demand and low competition locally.

With your budget, the best move is starting with 1–2 products you can sell quickly.

I'd recommend:
- Beard Oil — J$6,750 per litre, consistent top seller
- Beard Shampoo — J$4,700 per litre, pairs naturally, customers buy both together

You brand and package under your own name. We supply everything manufactured in Jamaica.

500+ clients island-wide have built their brands with us.

Prices start from J$3,750 per litre.

${browse}

Are you starting small to test first or going in with a fuller line?

${LEAD_SIGNATURE}`;
  }

  // general / unknown
  return `Hi ${name},

Thanks for reaching out to Najah Chemist! Our best sellers right now are:
- Yoni Foaming Wash — J$3,550 per litre
- Body Butter — J$4,000 per 2 lbs
- Hair Growth Oil — J$7,500 per litre
- Beard Oil — J$6,750 per litre

All wholesale, ready for you to brand and sell.

500+ clients island-wide have built their brands with us.

MOQ is 1 litre or 2 lbs so you can start small.

${browse}

Reply here to chat about what suits your brand best.

${LEAD_SIGNATURE}`;
}

// 3-day no-reply follow-up body (plain text).
function leadFollowUpBody(first, word) {
  const seg = (word && word !== 'wholesale') ? word + ' ' : '';
  return `Hi ${first || 'there'},

Just checking in — are you still interested in starting your ${seg}brand?

MOQ is 1 litre or 2 lbs so you can start small and test the market before going big.

👉 Browse our full range: najahchemistja.com
📋 Wholesale price list: najahchemistja.com/guide/wholesale-price-list

Reply here anytime — I'm happy to help.

Najah
Brand Consultant | Najah Chemist 🌿`;
}

// Final "staying in touch" email after 7 emails with no order (plain text).
function leadGoodbyeBody(first) {
  return `Hi ${first || 'there'},

I've enjoyed our conversation and wanted to check in one last time.

Whenever you're ready to start your brand — whether that's today or in 6 months — we're here. Browse our full range anytime at najahchemistja.com.

Wishing you all the best,

${LEAD_SIGNATURE}`;
}

// Render a plain-text email body as simple, personal-looking HTML (links clickable).
function plainTextToHtml(text) {
  const esc = (text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const linked = esc.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#1a1a1a;">$1</a>');
  const body = linked.replace(/\n/g, '<br>');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
    `<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">` +
    `<div style="max-width:600px;margin:0 auto;padding:20px;font-size:15px;line-height:1.6;">${body}</div>` +
    `</body></html>`;
}

// Send a lead email via Resend. Sets reply-to + X-Lead-ID and (for replies) the
// In-Reply-To / References headers so the message stays in the same email thread.
async function sendLeadEmail({ to, subject, text, leadId, inReplyTo, references }) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.warn('[lead-email] RESEND_API_KEY not configured — skipping');
    return null;
  }
  const headers = {};
  if (leadId)     headers['X-Lead-ID']    = leadId;
  if (inReplyTo)  headers['In-Reply-To']  = inReplyTo;
  if (references) headers['References']    = references;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from:     LEAD_FROM,
      reply_to: ADMIN_EMAIL,
      to:       [to],
      subject,
      text,
      html:     plainTextToHtml(text),
      headers:  Object.keys(headers).length ? headers : undefined
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Resend error ${res.status}: ${err.message || JSON.stringify(err)}`);
  }
  return res.json().catch(() => ({}));
}

// Render the full conversation as HTML for admin alert emails.
function conversationToHtml(conversation) {
  return (conversation || []).map(t => {
    const who = t.role === 'user' ? 'Lead' : 'Najah (AI)';
    const colour = t.role === 'user' ? '#1a5e1a' : '#8a5a00';
    const safe = (t.text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    return `<p style="margin:0 0 14px;"><strong style="color:${colour};">${who}:</strong><br>${safe}</p>`;
  }).join('');
}

// Send an internal admin alert email via the existing Resend sequence sender.
async function sendAdminAlert(subject, html) {
  try {
    await sendResendEmail(ADMIN_EMAIL, subject, html);
  } catch (err) {
    console.error('[admin-alert] failed:', err.message);
  }
}

// ── Gmail helpers ─────────────────────────────────────────────────────────────

function gmailClient() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  );
  oauth2.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth: oauth2 });
}

function extractEmailAddress(fromHeader) {
  const m = (fromHeader || '').match(/<([^>]+)>/);
  return (m ? m[1] : (fromHeader || '')).trim().toLowerCase();
}

function decodeB64Url(data) {
  return Buffer.from((data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

// Pull the best plain-text body out of a Gmail message payload (falls back to HTML).
function extractPlainText(payload) {
  function walk(part, want) {
    if (!part) return '';
    if (part.mimeType === want && part.body && part.body.data) return decodeB64Url(part.body.data);
    if (Array.isArray(part.parts)) {
      for (const p of part.parts) {
        const found = walk(p, want);
        if (found) return found;
      }
    }
    return '';
  }
  let text = walk(payload, 'text/plain');
  if (!text) {
    const html = walk(payload, 'text/html');
    if (html) text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ');
  }
  return text || '';
}

// Strip the quoted prior email from a reply so Claude only sees the new text.
function stripQuoted(text) {
  if (!text) return '';
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (/^>/.test(t)) break;
    if (/^On .+wrote:$/i.test(t)) break;
    if (/^-{3,}\s*Original Message\s*-{3,}/i.test(t)) break;
    if (/^From:\s/i.test(t) && out.length) break;
    out.push(line);
  }
  return out.join('\n').trim();
}

// ── System prompt for Claude (Najah, Brand Consultant) ────────────────────────

const NAJAH_SYSTEM_PROMPT = `You are Najah, Brand Consultant at Najah Chemist — a professional skincare contract manufacturer in Kingston, Jamaica. You help entrepreneurs start their own skincare, hair care, feminine care, body care, and men's grooming brands using wholesale private label products.

ABOUT NAJAH CHEMIST:
- B2B wholesale only — finished products clients apply their own labels to
- 500+ clients island-wide
- Ships Jamaica-wide via Knutsford Express and Zipmail (no collection, courier only)
- All products at najahchemistja.com
- Contact: start@najahchemistja.com | WhatsApp +18768851099

PRODUCTS & PRICING (all prices JMD):
YONI CARE:
- Yoni Foaming Wash: J$3,550/litre, J$12,500/gallon, J$56,250/5 gallon
- Yoni Oil (without petals): J$5,500/litre, J$19,500/gallon
- Yoni Oil (with petals): J$6,300/litre, J$24,200/gallon
- VagiMist: J$4,600/litre, J$14,500/gallon
- Boric Acid & Probiotics Gel Wash: J$4,200/litre, J$15,000/gallon
- Yoni Brightening Scrub: J$5,500/2lbs, J$20,500/8lbs
- Yoni Foaming Scrub: J$4,000/2lbs, J$14,500/8lbs
- Inner Thigh Cream: J$16,650/2lbs, J$60,000/8lbs
- Yoni Anti-Itch Cream: J$9,000/2lbs, J$32,800/8lbs
- Yoni Bar Soap: J$6,500/10 bars, J$63,000/100 bars
- Yoni Pops Capsules: J$8,000/100 caps, J$70,000/1000 caps
- Boric Acid Capsules: J$3,750/100 caps, J$26,500/1000 caps
- Yoni Steam Herbs: J$5,600/half lb, J$9,800/1lb

SKINCARE:
- Turmeric Facial Cleanser: J$4,200/litre
- Soothing Rose Toner: J$6,000/litre
- Glycolic Acid AHA Toner: J$7,000/litre
- Lightening Serum: J$17,000/litre
- Hyaluronic Acid Serum: J$13,000/litre
- Rose Oil Serum: J$12,500/litre
- Papaya Serum: J$17,000/litre
- Papaya Oil: J$12,500/litre
- Peeling Oil: J$24,500/litre
- Hydrating Moisturiser: J$8,300/2lbs
- Spot Remover: J$16,650/2lbs
- Strong Lightening Cream: J$16,650/2lbs
- Turmeric Facial Scrub: J$4,400/2lbs
- Turmeric Facial Mask: J$4,300/2lbs
- Body Scrub: J$4,000/2lbs
- Brightening Body Scrub: J$5,500/2lbs
- Body Butter: J$4,000/2lbs
- Brightening Body Butter: J$6,500/2lbs

MEN'S CARE:
- Beard Oil: J$6,750/litre
- Beard Shampoo: J$4,700/litre
- Beard Balm: J$5,500/2lbs
- Ryfle Wash: J$3,750/litre
- Jock Lube: J$6,550/litre
- Jock Mist: J$4,850/litre
- Jock-Itch Cream: J$9,500/2lbs

HAIR CARE:
- Hair Mist: J$5,500/litre
- Hair Growth Oil: J$7,500/litre
- Hair Butter: J$4,600/2lbs

BAR SOAPS (per 10 bars):
- Garlic & Lavender: J$6,500
- Kojic & Turmeric: J$6,500
- Turmeric Only: J$6,500
- Kojic Only: J$6,500
- Kojic & Charcoal: J$7,500
- Salicylic Acid: J$7,500
- Glycolic Acid: J$7,500
- Vitamin C: J$7,500
- Papaya: J$7,500
- Skin Lightening Bar: J$8,000

CONTAINERS (per unit):
- Small Pouch: J$65 | Large Pouch: J$85
- 2oz Spray Bottle: J$170 | 2oz Dropper: J$270
- 2oz Foam Bottle: J$222 | 2oz Double Wall Jar: J$250
- 4oz Flip Top Bottle: J$250 | 4oz Double Wall Jar: J$300
- 4oz Foam Bottle: J$300 | White Pill Bottle: J$120

MOQ & TURNAROUND:
- Existing private label products: 1 litre or 2 lbs minimum
- New custom products (first bulk order): 5 gallons minimum
- Existing products turnaround: 7-10 business days after payment
- New custom products: 14-21 business days after R&D fee received

PAYMENT:
- Bank transfer (NCB), Lynk, or Fygaro (card) only
- 100% upfront before production begins
- No COD under any circumstances
- All prices in JMD

FILLING SERVICE:
- 15% of product subtotal if client purchases containers too

SHIPPING:
- Jamaica only via Knutsford Express or Zipmail
- No collection — courier only
- Tracking receipt provided once shipped

R&D / CUSTOM PRODUCTS:
- To MODIFY an existing product (texture, actives, fragrance, color): najahchemistja.com/customise
- Acid addition fee: J$1,000 per 2 lbs
- To create a BRAND NEW formula from scratch: najahchemistja.com/custom-products
- First new product R&D: J$120,000 | Each additional: J$90,000
- NEVER quote R&D pricing in email — direct to najahchemistja.com/custom-products only

REFUNDS & CANCELLATIONS:
- Orders non-refundable once production commenced
- Can cancel within 24 hours of placement
- Returns only for damaged, defective, or materially incorrect products

REGULATORY:
- Client is solely responsible for regulatory compliance in their territory
- Najah Chemist retains ownership of all base formulations
- Clients receive a licence to sell under their own brand name

RULES — NEVER:
- Quote R&D pricing
- Promise specific delivery dates
- Say products are in or out of stock
- Make health claims about products
- Discuss complaints (direct to WhatsApp +18768851099)
- Reveal you are an AI unless directly asked
- Discuss shipping outside Jamaica (we ship Jamaica only)

IF ASKED IF YOU ARE AI:
Say: 'I am Najah's assistant handling initial enquiries on her behalf.'

IF QUESTION IS OUTSIDE YOUR KNOWLEDGE:
Say: 'A Najah Chemist admin will personally get back to you on that within 24 hours.' Then include [FLAG_ADMIN] at the end of your response.

IF LEAD WANTS TO UNSUBSCRIBE (says stop, unsubscribe, remove me):
Say a polite goodbye and include [UNSUBSCRIBE] at the end of your response.

IF LEAD SHOWS BUYING INTENT (asks how to pay, asks for bank details, says ready to order, asks for invoice, asks about delivery address):
Direct them to najahchemistja.com to place their order. Include [HOT_LEAD] at the end of your response.

TONE: Professional, warm, helpful. Always English. Never use slang. Sign every email as:
Najah
Brand Consultant | Najah Chemist 🌿
najahchemistja.com | start@najahchemistja.com
WhatsApp: +1 876-885-1099`;

// ── HTTP: handleEmailReply (Gmail Pub/Sub push endpoint) ──────────────────────

exports.handleEmailReply = onRequest(
  { secrets: ['RESEND_API_KEY', 'GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'ANTHROPIC_API_KEY'] },
  async (req, res) => {
    // Always ACK quickly (204) so Pub/Sub doesn't redeliver in a retry storm.
    try {
      const message = req.body && req.body.message;        // (B) Pub/Sub envelope
      if (!message || !message.data) { res.status(204).send(); return; }

      const decoded = JSON.parse(decodeB64Url(message.data)); // { emailAddress, historyId }
      await processGmailHistory(decoded.historyId);
    } catch (err) {
      console.error('[handleEmailReply] Error:', err.message);
    }
    res.status(204).send();
  }
);

// Resolve which Gmail messages are new since our last seen historyId and process each.
async function processGmailHistory(newHistoryId) {
  const db    = getFirestore();
  const gmail = gmailClient();
  const watchRef  = db.collection('system').doc('gmailWatch');
  const watchSnap = await watchRef.get();
  const startHistoryId = watchSnap.exists ? watchSnap.data().historyId : null;

  let messageIds = [];
  if (startHistoryId) {
    try {
      let pageToken;
      do {
        const hist = await gmail.users.history.list({
          userId: 'me', startHistoryId, historyTypes: ['messageAdded'], pageToken
        });
        (hist.data.history || []).forEach(h =>
          (h.messagesAdded || []).forEach(m => messageIds.push(m.message.id)));
        pageToken = hist.data.nextPageToken;
      } while (pageToken);
    } catch (e) {
      console.warn('[gmail] history.list failed, falling back to recent inbox:', e.message);
    }
  }
  // Fallback (first run, or expired history): scan recent unread inbox messages.
  if (!startHistoryId || messageIds.length === 0) {
    const list = await gmail.users.messages.list({
      userId: 'me', q: 'in:inbox is:unread newer_than:2d', maxResults: 15
    });
    messageIds = (list.data.messages || []).map(m => m.id);
  }

  // Persist the new historyId for next time.
  if (newHistoryId) {
    await watchRef.set({ historyId: String(newHistoryId), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }

  for (const id of [...new Set(messageIds)]) {
    try {
      await processOneMessage(gmail, db, id);
    } catch (e) {
      console.error(`[gmail] processing message ${id} failed:`, e.message);
    }
  }
}

// (C–K) Read one Gmail message, map to a lead, generate + send the AI reply.
async function processOneMessage(gmail, db, messageId) {
  // Idempotency guard — never process (or reply to) the same message twice.
  const procRef = db.collection('processedEmails').doc(messageId);
  if ((await procRef.get()).exists) return;

  const full    = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
  const payload = full.data.payload || {};
  const headers = {};
  (payload.headers || []).forEach(h => { headers[h.name.toLowerCase()] = h.value; });

  const senderEmail = extractEmailAddress(headers['from']);     // (D)
  const inMsgId     = headers['message-id'] || '';
  const refs        = headers['references'] || '';
  const xLeadId     = headers['x-lead-id'] || '';

  // Ignore our own outbound copies / system mail.
  if (!senderEmail || senderEmail === ADMIN_EMAIL) {
    await procRef.set({ skipped: 'self', at: FieldValue.serverTimestamp() });
    return;
  }

  const replyText = stripQuoted(extractPlainText(payload));
  if (!replyText) {
    await procRef.set({ skipped: 'empty', sender: senderEmail, at: FieldValue.serverTimestamp() });
    return;
  }

  // (E) Look up lead by X-Lead-ID header, then by sender email.
  let leadRef = null, leadData = null;
  if (xLeadId) {
    const s = await db.collection('leads').doc(xLeadId).get();
    if (s.exists) { leadRef = s.ref; leadData = s.data(); }
  }
  if (!leadRef) {
    const q = await db.collection('leads').where('email', '==', senderEmail).limit(1).get();
    if (!q.empty) { leadRef = q.docs[0].ref; leadData = q.docs[0].data(); }
  }
  if (!leadRef) {
    console.log(`[gmail] No lead for ${senderEmail} — skipping`);
    await procRef.set({ skipped: 'no_lead', sender: senderEmail, at: FieldValue.serverTimestamp() });
    return;
  }

  // Mark processed now (before sending) to prevent duplicate replies on redelivery.
  await procRef.set({ leadId: leadRef.id, sender: senderEmail, at: FieldValue.serverTimestamp() });

  // Stop conditions.
  if (leadData.unsubscribed === true || leadData.status === 'Cold') {
    console.log(`[gmail] Lead ${leadRef.id} closed/unsubscribed — ignoring reply`);
    return;
  }
  const currentCount = leadData.emailCount || 1;
  if (currentCount >= 7) {
    console.log(`[gmail] Lead ${leadRef.id} already at 7-email cap — ignoring`);
    return;
  }

  // (F) Build conversation (append this inbound reply first).
  const conversation = Array.isArray(leadData.emailConversation) ? leadData.emailConversation.slice() : [];
  conversation.push({ role: 'user', text: replyText, at: new Date().toISOString() });

  const first = (leadData.name || 'there').split(' ')[0];
  const seg   = leadSegment(leadData.brandType);

  // (G) Send conversation to Claude.
  const messages = [{
    role: 'user',
    content: `I'm interested in starting a ${seg.word} brand. (Enquiry submitted via najahchemistja.com)`
  }];
  for (const turn of conversation) {
    messages.push({ role: turn.role === 'user' ? 'user' : 'assistant', content: turn.text });
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let claudeText = '';
  try {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: NAJAH_SYSTEM_PROMPT,
      messages
    });
    claudeText = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  } catch (e) {
    console.error('[gmail] Claude error:', e.message);
    // Record the inbound message and flag a human so the reply isn't lost.
    await leadRef.set({ emailConversation: conversation, lastReplyAt: FieldValue.serverTimestamp() }, { merge: true });
    await sendAdminAlert(
      `⚠️ Lead needs your attention — ${leadData.name || senderEmail}`,
      `<p>The AI failed to generate a reply (${e.message}). Please respond manually.</p>` +
      `<p><strong>Lead:</strong> ${leadData.name || ''} &lt;${senderEmail}&gt; — segment: ${seg.key}</p>` +
      `<h3>Conversation</h3>${conversationToHtml(conversation)}`
    );
    return;
  }
  if (!claudeText) { console.warn(`[gmail] Empty Claude reply for ${leadRef.id}`); return; }

  // (H) Parse special tags.
  const hot   = /\[HOT_LEAD\]/i.test(claudeText);
  const flag  = /\[FLAG_ADMIN\]/i.test(claudeText);
  const unsub = /\[UNSUBSCRIBE\]/i.test(claudeText);
  const cleanText = claudeText.replace(/\[(HOT_LEAD|FLAG_ADMIN|UNSUBSCRIBE)\]/gi, '').trim();

  const willBeCount = currentCount + 1;
  const isFinal     = (willBeCount >= 7) && !hot && !unsub;   // 7th non-hot email = goodbye

  // Decide outgoing body + resulting status.
  let outgoingText = cleanText;
  let newStatus    = leadData.status || 'Contacted';
  let markUnsub    = false;

  if (unsub) {
    newStatus = 'Cold';
    markUnsub = true;
  } else if (isFinal) {
    outgoingText = leadGoodbyeBody(first);
    newStatus    = 'Cold';
  } else if (hot) {
    newStatus = 'Interested';
  }

  // (I) Send the reply via Resend, keeping the same thread.
  const threadSubject = leadData.emailSubject || headers['subject'] || 'Najah Chemist';
  const newReferences = (refs ? refs + ' ' : '') + inMsgId;
  try {
    await sendLeadEmail({
      to: senderEmail, subject: threadSubject, text: outgoingText,
      leadId: leadRef.id, inReplyTo: inMsgId, references: newReferences.trim()
    });
  } catch (e) {
    console.error('[gmail] reply send failed:', e.message);
  }

  // (J/K) Save the assistant turn, increment emailCount, update status.
  conversation.push({ role: 'assistant', text: outgoingText, at: new Date().toISOString() });
  const update = {
    emailConversation: conversation,
    emailCount:        willBeCount,
    status:            newStatus,
    lastReplyAt:       FieldValue.serverTimestamp()
  };
  if (markUnsub) { update.unsubscribed = true; update.unsubscribedAt = FieldValue.serverTimestamp(); }
  await leadRef.set(update, { merge: true });

  // Admin alerts.
  const leadLabel = leadData.name || senderEmail;
  if (hot) {
    await sendAdminAlert(
      `🔥 Hot Lead — ${leadLabel} is ready to order`,
      `<p><strong>${leadLabel}</strong> &lt;${senderEmail}&gt; (segment: ${seg.key}) is showing buying intent.</p>` +
      `<h3>Conversation</h3>${conversationToHtml(conversation)}`
    );
  }
  if (flag) {
    await sendAdminAlert(
      `⚠️ Lead needs your attention — ${leadLabel}`,
      `<p><strong>${leadLabel}</strong> &lt;${senderEmail}&gt; asked something outside the AI's knowledge.</p>` +
      `<p><strong>Their message:</strong><br>${replyText.replace(/</g, '&lt;')}</p>` +
      `<h3>Conversation</h3>${conversationToHtml(conversation)}`
    );
  }
  if (isFinal) {
    await sendAdminAlert(
      `📋 Lead closed after 7 emails — ${leadLabel}`,
      `<p><strong>Name:</strong> ${leadData.name || ''}<br>` +
      `<strong>Email:</strong> ${senderEmail}<br>` +
      `<strong>Segment:</strong> ${seg.key}<br>` +
      `<strong>Date:</strong> ${new Date().toISOString().slice(0, 10)}</p>` +
      `<h3>Conversation summary</h3>${conversationToHtml(conversation)}`
    );
  }

  console.log(`[gmail] Replied to lead ${leadRef.id} (count ${willBeCount}, status ${newStatus}` +
    `${hot ? ', HOT' : ''}${flag ? ', FLAG' : ''}${unsub ? ', UNSUB' : ''}${isFinal ? ', FINAL' : ''})`);
}

// ── Scheduled: checkLeadFollowUps (daily 9am Jamaica) ─────────────────────────
// 3-day no-reply nudge for leads still at emailCount==1.

exports.checkLeadFollowUps = onSchedule(
  { schedule: '0 9 * * *', timeZone: 'America/Jamaica', secrets: ['RESEND_API_KEY'] },
  async () => {
    const db     = getFirestore();
    const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
    const snap   = await db.collection('leads').where('emailCount', '==', 1).get();

    let sent = 0;
    for (const doc of snap.docs) {
      const d = doc.data();
      if (d.unsubscribed || d.followUpSent || d.status === 'Cold') continue;

      const created = toDate(d.createdAt);
      if (!created || created.getTime() > cutoff) continue;       // not yet 3 days old

      const conv = Array.isArray(d.emailConversation) ? d.emailConversation : [];
      if (conv.some(t => t.role === 'user')) continue;            // lead already replied

      const email = (d.email || '').trim();
      if (!email) continue;

      const first = (d.name || 'there').split(' ')[0];
      const seg   = leadSegment(d.brandType);
      const text  = leadFollowUpBody(first, seg.word);

      try {
        await sendLeadEmail({ to: email, subject: 'Still thinking about starting your brand? 🌿', text, leadId: doc.id });
        const conv2 = conv.slice();
        conv2.push({ role: 'assistant', text, at: new Date().toISOString() });
        await doc.ref.set({
          followUpSent:      true,
          emailCount:        2,
          emailConversation: conv2,
          followUpAt:        FieldValue.serverTimestamp()
        }, { merge: true });
        sent++;
      } catch (e) {
        console.error(`[checkLeadFollowUps] failed ${email}:`, e.message);
      }
    }
    console.log(`[checkLeadFollowUps] Sent ${sent} follow-up email(s)`);
  }
);
