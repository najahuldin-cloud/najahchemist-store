// netlify/functions/jarvis.js
// Najah Jarvis command center — AI operating system for Najah Chemist.
// Uses Claude Sonnet 4.6. Required env var: ANTHROPIC_API_KEY
//
// Payload: { messages: [{role, content}, ...], system: "<full system prompt>" }
// The system prompt is built client-side in jarvis.html with live business context.

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const messages = body.messages;
    const systemPrompt = body.system;

    if (!Array.isArray(messages) || !messages.length) {
      return { statusCode: 400, body: JSON.stringify({ error: "No messages provided" }) };
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: systemPrompt || "You are Jarvis, the AI operating system for Najah Chemist.",
        messages: messages
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("jarvis upstream error:", JSON.stringify(data));
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply: "Jarvis hit a snag reaching the AI. Try again in a moment." })
      };
    }

    const replyText = data.content?.[0]?.text || "I couldn't generate a response. Try rephrasing.";

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: replyText, raw: data })
    };
  } catch (error) {
    console.error("jarvis error:", error.message);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: "Sorry, Jarvis is temporarily unavailable. Please try again." })
    };
  }
};
