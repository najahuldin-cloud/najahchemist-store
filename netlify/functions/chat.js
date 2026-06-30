// netlify/functions/chat.js
// Najah Chemist AI chatbot — handles both chat widgets
// Required env var: ANTHROPIC_API_KEY

// NOTE: This is a lean FALLBACK prompt only. The live product/pricing catalogue is built
// client-side from the same Firestore-loaded window.PRODUCTS array that renders the storefront
// catalogue (see admin-module.js → getSYS / window.buildChatbotSystem) and passed in as
// `body.system`. To keep a single source of truth, NO product list or prices are duplicated
// here. If no live catalogue is supplied, the assistant must not invent products or prices —
// it directs product/pricing questions to WhatsApp instead.
const SYSTEM_PROMPT = `You are the friendly, knowledgeable customer service assistant for Najah Chemist — a Jamaican professional-grade skincare manufacturer. Be warm, helpful and concise. All prices are in Jamaican Dollars (J$). Capture name and WhatsApp number when a customer wants to place an order. For urgent issues direct them to WhatsApp (876) 885-1099 or @najahchemist.

BRAND: Najah Chemist uses professional-grade actives — kojic acid, AHAs, salicylic acid, hyaluronic acid, etc. NOT a natural or organic brand. Focus is on results.

⚠️ PRODUCT ACCURACY: You have not been given the live product catalogue for this request. Do NOT quote specific products, sizes, or prices from memory and do NOT invent any. For any product, availability, or pricing question, give general guidance and direct the customer to browse najahchemistja.com or WhatsApp (876) 885-1099 for exact current items and prices.

══════════════════════════════════════
PAYMENT & SHIPPING
══════════════════════════════════════
⚠️ NO COD — WE DO NOT OFFER CASH ON DELIVERY. Payment must be made IN FULL before any order is processed. Always state this clearly when payment is mentioned.

Payment methods accepted:
  • Online card: Fygaro via najahchemistja.com
  • Bank Transfer: NCB — JMD account 354-747-294 | USD account 354-747-308 | Business name: Najah Chemist
  • Lynk: @najahchemist
Payment required BEFORE processing. 2–3 business day turnaround. NO exceptions to upfront payment requirement.

Shipping (Jamaica island-wide):
  • Knutsford Express — island-wide, next-day. Bearer fee ~J$500.
  • Zipmail — ~J$1,000 total.
  • Kingston/St. Andrew direct delivery — from J$1,000.

CONTACT: WhatsApp (876) 885-1099 · @najahchemist on Instagram & TikTok · najahchemistja.com`;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body);

    // Handle two payload formats:
    // Format 1 (admin chat): { messages: [...], system: "..." }
    // Format 2 (storefront chat): { message: "...", history: [...] }
    let messages, systemPrompt;

    if (body.messages) {
      // Admin chat format
      messages = body.messages;
      systemPrompt = body.system || SYSTEM_PROMPT;
    } else if (body.message) {
      // Storefront chat format — convert to messages array
      const history = (body.history || []).map(h => ({
        role: h.role,
        content: h.content
      }));
      messages = [...history, { role: "user", content: body.message }];
      // Callers (e.g. /start funnel, copy generator) may pass their own full system
      // prompt as `context`. Honor it; otherwise use the lean fallback prompt.
      systemPrompt = body.context || body.system || SYSTEM_PROMPT;
    } else {
      return { statusCode: 400, body: JSON.stringify({ error: "No message provided" }) };
    }

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
        system: systemPrompt,
        messages: messages
      })
    });

    const data = await response.json();
    const replyText = data.content?.[0]?.text;

    // Upstream failure (e.g. billing/auth outage): Anthropic returns 200 with an error
    // body and no content, OR a non-2xx. Signal this to the client with a non-2xx status
    // so the storefront shows its visible recovery UI instead of a dead-end message.
    if (!response.ok || !replyText) {
      console.error("chat upstream error:", response.status, JSON.stringify(data).slice(0, 300));
      const fallback = "Sorry, I'm having trouble right now. Please WhatsApp us at +1 876-885-1099.";
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: true, reply: fallback })
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      // Return BOTH formats so both chat widgets work
      body: JSON.stringify({
        ...data,
        reply: replyText
      })
    };

  } catch (error) {
    console.error("chat error:", error.message);
    const fallback = "Sorry, I'm having trouble right now. Please WhatsApp us at +1 876-885-1099.";
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: [{ type: "text", text: fallback }],
        reply: fallback
      })
    };
  }
};
