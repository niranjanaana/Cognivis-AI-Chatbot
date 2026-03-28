require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// System prompt
const SYSTEM_PROMPT = `You are Cognivis, an AI that explains concepts visually using SVG flowcharts.

ALWAYS respond with valid JSON in this exact format:
{
  "explanation": "A clear, simple explanation (2-4 sentences)",
  "visual_title": "Short title (max 5 words)",
  "svg": "<svg viewBox='0 0 560 320' xmlns='http://www.w3.org/2000/svg'>...</svg>"
}

STRICT FLOWCHART RULES:
- viewBox MUST be "0 0 560 320"
- First element MUST be: <rect width="560" height="320" fill="#0d0d15"/>
- ALL elements must stay within x:0-560, y:0-320 — NEVER go outside bounds
- Always include arrowhead marker:
  <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#f0c060"/></marker></defs>

BOX RULES:
- Every box: width=120, height=54, rx="8"
- Text inside box: font-size="11", font-family="monospace", fill="#0d0d15", text-anchor="middle", dominant-baseline="middle"
- Place text x at box center, y at box center — text MUST be centered inside the box
- If label is long, split into 2 <tspan> lines using dy="-7" for first line and dy="14" for second
- Never let text overflow outside its box
- Cycle box colors: #7c6dfa, #fa6d9f, #6dfac8, #f0c060

LAYOUT RULES:
- Use a top-to-bottom OR left-to-right flowchart layout depending on number of steps
- For 4 or fewer steps: horizontal layout, evenly spaced across x=40 to x=480
- For 5 or more steps: vertical layout, evenly spaced across y=30 to y=290
- Max 4 boxes per row — wrap to next row if more
- Arrows: <line x1="..." y1="..." x2="..." y2="..." stroke="#f0c060" stroke-width="2" marker-end="url(#arrow)"/>
- Connect boxes edge to edge (not center to center)
- Decision diamonds: use <polygon> with points forming a diamond shape
BOX CONTENT RULES:
- Every box MUST have 2 lines of text:
  Line 1: the name, font-size="12", font-weight="bold", dy="-8"
  Line 2: a 2-3 word description of what it does, font-size="9", dy="13", fill="#0d0d15", opacity="0.8"
- Example: box for "Physical" should show:
    Line 1: "Physical"
    Line 2: "cables & signals"
- Example: box for "Network" should show:
    Line 1: "Network"  
    Line 2: "IP routing"
- Keep Line 2 under 3 words — must fit inside the box width of 120px
- Both lines centered horizontally and vertically inside the box

- Return ONLY valid JSON. No markdown, no backticks, nothing outside JSON.`;
// Chat endpoint
app.post("/api/chat", async (req, res) => {
  const { message, history = [] } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  if (message.length > 500) {
    return res.status(400).json({ error: "Message too long. Keep it under 500 characters." });
  }

  try {
    const messages = history.length > 0 ? history : [
      { role: "user", content: `Explain this visually: ${message}` },
    ];

    // Call Groq API directly via fetch (no SDK needed)
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile", // best free Groq model
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages,
        ],
        max_tokens: 4096,
        temperature: 0.7,
      }),
    });

    if (!groqRes.ok) {
      const errBody = await groqRes.json();
      console.error("Groq API Error:", errBody);
      return res.status(500).json({ error: errBody.error?.message || "Groq API error" });
    }

    const data = await groqRes.json();

    // Extract text from Groq response
    const rawText = data.choices?.[0]?.message?.content || "";

    if (!rawText) {
      return res.status(500).json({ error: "Empty response from Groq" });
    }

    // Clean JSON (strip any accidental backticks)
    const cleaned = rawText.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      console.error("JSON Parse Error:", cleaned);
      return res.status(500).json({ error: "AI returned invalid JSON. Try again." });
    }

    res.json({
      explanation: parsed.explanation,
      visual_title: parsed.visual_title || "Diagram",
      svg: parsed.svg,
      assistantMessage: rawText,
    });

  } catch (err) {
    console.error("Server Error:", err.message);
    res.status(500).json({ error: "Something went wrong. Try again." });
  }
});

// Fallback: serve index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Cognivis running at http://localhost:${PORT}`);
});
const fs = require("fs");
const dataset = fs.readFileSync("dataset.jsonl", "utf-8")
  .split("\n")
  .map(line => JSON.parse(line));