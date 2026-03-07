const { google } = require("googleapis");

exports.handler = async (event) => {
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

    console.log("Received order:", JSON.stringify(body));

    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
    console.log("Service account email:", credentials.client_email);

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });

    const sheets = google.sheets({ version: "v4", auth });

    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    console.log("Sheet ID:", spreadsheetId);

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Sheet1!A1",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          orderId,
          date,
          customerName,
          phone,
          products,
          deliveryLocation,
          deliveryFee,
          total,
          status
        ]]
      }
    });

    console.log("Sheets API response:", JSON.stringify(response.data));

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Order saved successfully" })
    };

  } catch (error) {
    console.error("ERROR:", error.message);
    console.error("Full error:", JSON.stringify(error, Object.getOwnPropertyNames(error)));
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
