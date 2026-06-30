// netlify/functions/lookup-order.js
// Secure returning-customer order lookup (Section 5.1).
//
// The orders collection is NOT publicly readable (firestore.rules require auth),
// so the browser must never read it. This function reads orders server-side as the
// Najah Chemist service account (OAuth token minted from a signed JWT — bypasses
// security rules) and verifies ownership before returning anything.
//
// Ownership rule: EVERY supplied identifier (phone / email / orderNumber) must match
// the SAME order. If any supplied identifier does not match, no data is returned.
//
// Response is a customer-friendly status contract (never raw backend errors):
//   FOUND | NO_MATCH | AMBIGUOUS | INVALID_REQUEST | UNAVAILABLE
//
// Required env vars (Najah Chemist / najah-chemist service account):
//   FIREBASE_CLIENT_EMAIL  — service account client_email
//   FIREBASE_PRIVATE_KEY   — service account private_key (\n may be escaped)

const { createSign } = require("crypto");

const PROJECT_ID = "najah-chemist";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/datastore";

function resp(statusCode, obj) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}

function b64url(str) {
  return Buffer.from(str).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getAccessToken() {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey) throw new Error("missing-credentials");

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: clientEmail, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(header + "." + claim);
  const signature = signer.sign(privateKey, "base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const jwt = header + "." + claim + "." + signature;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + jwt,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("token-failed");
  return data.access_token;
}

// Minimal decoder for the Firestore REST value shapes we use.
function decodeFields(fields) {
  const out = {};
  for (const k in fields) out[k] = decodeVal(fields[k]);
  return out;
}
function decodeVal(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("mapValue" in v) return decodeFields(v.mapValue.fields || {});
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeVal);
  return null;
}

async function fetchRecentOrders(token) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: "orders" }],
      orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
      limit: 500,
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("query-failed:" + res.status);
  const rows = await res.json();
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r.document && r.document.fields)
    .map((r) => decodeFields(r.document.fields));
}

function digitsOf(s) {
  return String(s || "").replace(/\D/g, "");
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return resp(405, { status: "INVALID_REQUEST" });

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (_) {
    return resp(400, { status: "INVALID_REQUEST" });
  }

  // ── Input validation (never trust the browser) ──
  const phoneDigits = digitsOf(body.phone);
  const email = String(body.email || "").trim().toLowerCase();
  const orderNum = String(body.orderNumber || "").trim().toUpperCase();

  const hasPhone = phoneDigits.length > 0;
  const hasEmail = email.length > 0;
  const hasOrder = orderNum.length > 0;

  if (!hasPhone && !hasEmail && !hasOrder) return resp(400, { status: "INVALID_REQUEST" });
  if (hasPhone && phoneDigits.length < 7) return resp(400, { status: "INVALID_REQUEST" });
  if (hasEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return resp(400, { status: "INVALID_REQUEST" });
  if (hasOrder && !/^[A-Z0-9-]{3,20}$/.test(orderNum)) return resp(400, { status: "INVALID_REQUEST" });

  let orders;
  try {
    const token = await getAccessToken();
    orders = await fetchRecentOrders(token);
  } catch (err) {
    console.error("lookup-order unavailable:", err.message);
    return resp(503, { status: "UNAVAILABLE" });
  }

  // ── Ownership: every supplied identifier must match the SAME order ──
  const matches = (o) => {
    if (hasOrder && String(o.id || "").trim().toUpperCase() !== orderNum) return false;
    if (hasEmail && String(o.email || "").trim().toLowerCase() !== email) return false;
    if (hasPhone) {
      const cands = [o.phone, o.whatsapp, o.customerWhatsApp].map(digitsOf).filter(Boolean);
      const ok = cands.some(
        (s) => s.endsWith(phoneDigits) || phoneDigits.endsWith(s) || s.slice(-7) === phoneDigits.slice(-7)
      );
      if (!ok) return false;
    }
    return true;
  };

  const candidates = orders.filter(matches);
  if (candidates.length === 0) return resp(200, { status: "NO_MATCH" });

  // Ambiguous if the matches span more than one distinct customer identity
  // (e.g. a shared phone with no stronger identifier supplied).
  const identityOf = (o) => String(o.email || "").trim().toLowerCase() || String(o.client || "").trim().toLowerCase();
  const identities = new Set(candidates.map(identityOf).filter(Boolean));
  if (identities.size > 1) return resp(200, { status: "AMBIGUOUS" });

  // Orders are ordered most-recent first, so candidates[0] is the latest.
  const o = candidates[0];
  return resp(200, {
    status: "FOUND",
    order: { id: o.id || "", product: o.product || "" },
    details: {
      name: o.client || "",
      phone: o.phone || "",
      email: o.email || "",
      address: o.deliveryAddressDetails || o.deliveryAddress || "",
      shippingDetail: o.shippingDetail || "",
      deliveryLocation: o.deliveryLocation || "",
    },
  });
};
