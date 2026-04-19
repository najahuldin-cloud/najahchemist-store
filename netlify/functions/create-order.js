// netlify/functions/create-order.js
// Saves order to Google Sheets
// Required env vars: GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEET_ID

exports.handler = async (event) => {
  if (event.httpMethod === "HEAD") {
    return { statusCode: 200, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body);
    const { orderId, date, customerName, phone, products, deliveryLocation, deliveryFee, total, status } = body;

    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const credentials = {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
    };

    const token = await getAccessToken(credentials);

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        values: [[
          orderId || "",
          date || new Date().toLocaleString("en-JM"),
          customerName || "",
          phone || "",
          products || "",
          deliveryLocation || "",
          deliveryFee || 0,
          total || 0,
          status || "NEW"
        ]]
      })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Sheets API error ${res.status}: ${err}`);
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, orderId })
    };

  } catch (error) {
    console.error("create-order error:", error.message);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: error.message })
    };
  }
};

async function getAccessToken(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };

  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${b64(header)}.${b64(claim)}`;

  const { createSign } = require("crypto");
  const sign = createSign("RSA-SHA256");
  sign.update(unsigned);
  // private_key newlines already fixed above
  const signature = sign.sign(credentials.private_key, "base64url");
  const jwt = `${unsigned}.${signature}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error("Failed to get access token: " + JSON.stringify(tokenData));
  }
  return tokenData.access_token;
}
