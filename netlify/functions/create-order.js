// netlify/functions/create-order.js
// Saves order to Google Sheets
// Required env vars: GOOGLE_SERVICE_ACCOUNT, GOOGLE_SHEET_ID

const { google } = require("googleapis");

exports.handler = async (event) => {
  // Allow HEAD for connectivity checks
  if (event.httpMethod === "HEAD") {
    return { statusCode: 200, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body);
    const {
      orderId,
      date,
      customerName,
      phone,
      products,
      deliveryLocation,
      deliveryFee,
      total,
      status
    } = body;

    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });

    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Sheet1!A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          orderId,
          date,
          customerName,
          phone || "",
          products,
          deliveryLocation,
          deliveryFee,
          total,
          status || "NEW"
        ]]
      }
    });

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
