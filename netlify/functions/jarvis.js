// netlify/functions/jarvis.js
// Najah Jarvis command center — AI operating system for Najah Chemist.
// Claude Sonnet 4.6 for reasoning + Mem0 for persistent memory.
//
// Env vars (set in the Netlify dashboard):
//   ANTHROPIC_API_KEY  — Claude API key
//   MEM0_API_KEY       — Mem0 platform key (https://api.mem0.ai)
//
// Actions (POST body.action):
//   "ask"    (default) — search Mem0 for context, ask Claude, store the interaction
//   "enrich"           — { names:[...] } -> { memories:{ name: "snippet" } } for opportunity Why fields
//
// The mem0ai SDK is installed in the root package.json and available, but all
// calls here go through the documented REST API directly: zero bundling risk in
// the Lambda, exact control over the wire format, and every call is wrapped so a
// Mem0 outage can NEVER break Ask Jarvis (it just degrades to no-memory).

const MEM0_BASE = "https://api.mem0.ai";
const MEM0_KEY = process.env.MEM0_API_KEY;
const USER_INTERACTIONS = "najah-chemist";          // chat history / per-client facts
const USER_BUSINESS     = "najah-chemist-business"; // seeded business facts

function mem0Headers() {
  return { "Authorization": "Token " + MEM0_KEY, "Content-Type": "application/json" };
}

// Search Mem0; returns an array of memory strings (newest/most-relevant first).
// Never throws — returns [] on any failure so the caller can carry on.
async function mem0Search(query, userId, limit = 5) {
  if (!MEM0_KEY || !query) return [];
  try {
    const res = await fetch(MEM0_BASE + "/v2/memories/search/", {
      method: "POST",
      headers: mem0Headers(),
      body: JSON.stringify({ query: String(query).slice(0, 800), filters: { user_id: userId }, top_k: limit }),
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) { console.log("mem0 search non-200:", res.status); return []; }
    const data = await res.json();
    const arr = Array.isArray(data) ? data : (data.results || []);
    return arr.map(m => m && (m.memory || m.text || m.content)).filter(Boolean).slice(0, limit);
  } catch (e) {
    console.log("mem0 search error:", e.message);
    return [];
  }
}

// Store a conversation in Mem0 (it extracts the durable facts). Never throws.
async function mem0Add(messages, userId, metadata) {
  if (!MEM0_KEY || !Array.isArray(messages) || !messages.length) return;
  try {
    await fetch(MEM0_BASE + "/v1/memories/", {
      method: "POST",
      headers: mem0Headers(),
      body: JSON.stringify({ messages, user_id: userId, metadata: metadata || {} }),
      signal: AbortSignal.timeout(4000)
    });
  } catch (e) {
    console.log("mem0 add error:", e.message);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: "Bad JSON" }) }; }

  // ── ENRICH: look up per-person memory for opportunity Why fields ──
  if (body.action === "enrich") {
    const names = Array.isArray(body.names) ? body.names.slice(0, 12) : [];
    const memories = {};
    await Promise.all(names.map(async (n) => {
      const name = String(n || "").trim();
      if (!name) return;
      const mems = await mem0Search(name, USER_INTERACTIONS, 6);
      // Only surface memories that actually mention THIS client (by name token).
      // Mem0 semantic search returns top_k results regardless of relevance, so
      // generic business facts (AOV, shipping) seeded/stored in the interactions
      // store would otherwise leak into every client's Why field. Drop anything
      // that does not name the client.
      // Strict match: a multi-name client requires BOTH first AND last name in the
      // memory text (prevents "Sheleta Davis" leaking onto "Shanique Davis" via a
      // shared surname). A single-name client requires that exact name (>= 4 chars).
      const parts = name.toLowerCase().split(/\s+/).filter(Boolean);
      let clientMems = [];
      if (parts.length >= 2) {
        const first = parts[0], last = parts[parts.length - 1];
        clientMems = mems.filter(m => { const low = m.toLowerCase(); return low.includes(first) && low.includes(last); });
      } else if (parts.length === 1 && parts[0].length >= 4) {
        const only = parts[0];
        clientMems = mems.filter(m => m.toLowerCase().includes(only));
      }
      if (clientMems.length) memories[n] = clientMems.slice(0, 2).join(" · ");
    }));
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memories })
    };
  }

  // ── ASK: memory-augmented Q&A ──
  try {
    const messages = body.messages;
    let systemPrompt = body.system || "You are Jarvis, the AI operating system for Najah Chemist.";

    if (!Array.isArray(messages) || !messages.length) {
      return { statusCode: 400, body: JSON.stringify({ error: "No messages provided" }) };
    }

    // 1. Pull the latest user question and search Mem0 (business facts + past interactions)
    const lastUser = [...messages].reverse().find(m => m.role === "user");
    const question = lastUser && typeof lastUser.content === "string" ? lastUser.content : "";
    let memContext = [];
    if (question) {
      const [bizMem, intMem] = await Promise.all([
        mem0Search(question, USER_BUSINESS, 5),
        mem0Search(question, USER_INTERACTIONS, 5)
      ]);
      // de-dupe while preserving order (business facts first)
      memContext = [...new Set([...bizMem, ...intMem])];
    }
    if (memContext.length) {
      systemPrompt += "\n\nRelevant memory recalled from Mem0 (use only if it helps answer; ignore if irrelevant):\n"
        + memContext.map(m => "- " + m).join("\n");
    }

    // 2. Ask Claude
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
        system: systemPrompt,
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

    // 3. Store the interaction so Jarvis remembers it next time (non-fatal)
    if (question && replyText) {
      await mem0Add(
        [{ role: "user", content: question }, { role: "assistant", content: replyText }],
        USER_INTERACTIONS,
        { type: "jarvis_chat" }
      );
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: replyText, memoryUsed: memContext.length })
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
