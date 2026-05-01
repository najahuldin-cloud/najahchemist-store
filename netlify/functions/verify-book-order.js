// netlify/functions/verify-book-order.js
// Validates a Fygaro order number + email to gate the book download

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { email, orderNumber } = JSON.parse(event.body);

    if (!email || !orderNumber) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ valid: false, error: 'Missing email or order number' })
      };
    }

    const order = orderNumber.trim().toUpperCase();
    const emailClean = email.trim().toLowerCase();

    // Fygaro order numbers: start with "O-" and have at least 8 chars total
    const validFormat = /^O-[A-Z0-9]{6,}$/.test(order);

    if (!validFormat || !emailClean.includes('@')) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ valid: false })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valid: true })
    };

  } catch (error) {
    console.error('verify-book-order error:', error.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valid: false, error: error.message })
    };
  }
};
