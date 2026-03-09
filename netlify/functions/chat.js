// netlify/functions/chat.js
// Najah Chemist AI chatbot via Anthropic Claude
// Required env var: ANTHROPIC_API_KEY

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { messages, system } = JSON.parse(event.body);

    const defaultSystem = `You are the Najah Chemist wholesale assistant. Najah Chemist is a Jamaican wholesale skincare brand based in Kingston, Jamaica.

PRODUCTS & PRICING (wholesale):
- Yoni Foaming Wash: J$3,550/litre, J$12,500/gallon, J$56,250/5gal — 6 scents
- Yoni Foaming Scrub: J$4,000/2lbs, J$14,500/8lbs
- Yoni Moisture Cream: J$3,750/litre, J$13,250/gallon
- Yoni Oil: J$3,750/litre
- Brightening Bar Soap: J$2,500/10 bars, J$22,500/100 bars
- Brightening Body Cream: J$3,550/litre, J$12,500/gallon
- Brightening Body Serum: J$4,500/litre
- Men's Bar Soap: J$2,500/10 bars, J$22,500/100 bars
- Hair Growth Serum: J$4,500/litre
- Private Label: MOQ 1 litre or 2 lbs — custom label design included

SHIPPING:
- Knutsford Express: J$500 bearer fee
- Zipmail: ~J$1,000 under 10lbs
- Kingston/St. Andrew delivery: from J$1,000

PAYMENT: Bank transfer (NCB JMD: 354-747-294, USD: 354-747-308), Fygaro, or Lynk (@najahchemist). Payment required upfront, no COD.

WhatsApp: +1 876-885-1099
Instagram: @najahchemist

Keep answers concise, helpful, and warm. If unsure, direct them to WhatsApp.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        system: system || defaultSystem,
        messages: messages || []
      })
    });

    const data = await response.json();

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    };

  } catch (error) {
    console.error("chat error:", error.message);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: [{ type: "text", text: "Sorry, I'm having trouble right now. Please WhatsApp us at +1 876-885-1099." }]
      })
    };
  }
};
