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

    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    });

    const sheets = google.sheets({ version: "v4", auth });

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: "Sheet1!A:I",
      valueInputOption: "USER_ENTERED",
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

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Order saved successfully" })
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
