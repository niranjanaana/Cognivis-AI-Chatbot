require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Groq = require("groq-sdk");

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.GROQ_API_KEY) {
  console.error("\n❌ ERROR: GROQ_API_KEY is missing from .env\n");
  process.exit(1);
}

console.log("✓ Groq API key loaded");

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM_PROMPT = `You are Cognivis. You explain concepts as structured diagram data.

ALWAYS respond with valid JSON — nothing else:
{
  "explanation": "2-4 sentence plain-language explanation.",
  "visual_title": "Title (5 words max)",
  "layout": "horizontal or vertical",
  "nodes": [
    { "id": "1", "label": "Short Label", "sublabel": "clear description max 8 words", "color": "#7c6dfa" },
    { "id": "2", "label": "Short Label", "sublabel": "clear description max 8 words", "color": "#fa6d9f" }
  ],
  "edges": [
    { "from": "1", "to": "2" }
  ]
}

Rules:
- layout: use "vertical" for stacks/hierarchies (OSI, layers, top-to-bottom steps). Use "horizontal" for left-to-right flows.
- nodes: 2 to 7 nodes. label is 1-3 words. sublabel is specific to this node, max 8 words.
- colors: rotate through #7c6dfa, #fa6d9f, #6dfac8, #f0c060, #e87c6d, #6db8fa
- edges: connect nodes with arrows in logical order
- Return ONLY raw JSON. No markdown. No backticks. No extra text.`;


function buildSVG(nodes, edges, layout) {
  const isVertical = layout === "vertical";

  const BOX_W  = 220;
  const BOX_H  = 80;
  const GAP    = 80;  // large enough so arrows are fully visible between boxes
  const PAD    = 60;  // padding around the whole diagram
  const count  = nodes.length;

  // ── Canvas ───────────────────────────────────────────────
  const W = isVertical
    ? BOX_W + PAD * 2
    : count * BOX_W + (count - 1) * GAP + PAD * 2;
  const H = isVertical
    ? count * BOX_H + (count - 1) * GAP + PAD * 2
    : BOX_H + PAD * 2;

  // ── Box positions (top-left corner) ─────────────────────
  const pos = {};
  nodes.forEach((node, i) => {
    if (isVertical) {
      pos[node.id] = {
        x: PAD,
        y: PAD + i * (BOX_H + GAP),
      };
    } else {
      pos[node.id] = {
        x: PAD + i * (BOX_W + GAP),
        y: PAD,
      };
    }
  });

  // ── Arrow endpoints ──────────────────────────────────────
  // Arrows start 1px outside box edge, end 1px before target box edge.
  // The marker refX=10 means the tip of the arrow lands exactly at x2,y2.
  // So we set x2,y2 to be flush with the target box edge — the marker
  // draws the arrowhead BEFORE that point, not past it.
  const arrowLines = edges.map(edge => {
    const a = pos[edge.from];
    const b = pos[edge.to];
    if (!a || !b) return "";

    let x1, y1, x2, y2;

    if (isVertical) {
      // Exit bottom of source box, enter top of target box
      x1 = a.x + BOX_W / 2;
      y1 = a.y + BOX_H;        // exactly at bottom edge
      x2 = b.x + BOX_W / 2;
      y2 = b.y;                 // exactly at top edge
    } else {
      // Exit right of source box, enter left of target box
      x1 = a.x + BOX_W;        // exactly at right edge
      y1 = a.y + BOX_H / 2;
      x2 = b.x;                 // exactly at left edge
      y2 = b.y + BOX_H / 2;
    }

    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#f0c060" stroke-width="2.5" marker-end="url(#arr)" marker-start="url(#startcap)"/>`;
  }).join("\n    ");

  // ── Box elements ─────────────────────────────────────────
  // Boxes drawn AFTER arrows so they paint over arrow endpoints cleanly
  const boxEls = nodes.map(node => {
    const p   = pos[node.id];
    const cx  = p.x + BOX_W / 2;
    const cy  = p.y + BOX_H / 2;

    // If sublabel exists, shift label up and show sublabel below
    const labelY   = node.sublabel ? cy - 14 : cy;
    const subY     = cy + 14;

    return `
    <rect x="${p.x}" y="${p.y}" width="${BOX_W}" height="${BOX_H}" rx="12" fill="${node.color}"/>
    <text x="${cx}" y="${labelY}" text-anchor="middle" dominant-baseline="central"
      font-family="monospace" font-size="15" font-weight="bold" fill="#ffffff">${escXML(node.label)}</text>
    ${node.sublabel ? `<text x="${cx}" y="${subY}" text-anchor="middle" dominant-baseline="central"
      font-family="monospace" font-size="11" fill="rgba(255,255,255,0.78)">${escXML(node.sublabel)}</text>` : ""}`;
  }).join("\n");

  // ── Assemble SVG ─────────────────────────────────────────
  // Draw order: background → arrows → boxes
  // Boxes render ON TOP of arrow lines, so endpoints are hidden under boxes.
  // Only the gap segment of the arrow is visible — exactly as intended.
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="#0d0d15"/>
  <defs>
    <!-- Arrowhead at the END of line (points toward target) -->
    <marker id="arr" viewBox="0 0 12 12" refX="6" refY="6"
      markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M1,1 L11,6 L1,11 Z" fill="#f0c060"/>
    </marker>
    <!-- Small circle cap at START of line (where it leaves source box) -->
    <marker id="startcap" viewBox="0 0 10 10" refX="5" refY="5"
      markerWidth="3" markerHeight="3">
      <circle cx="5" cy="5" r="4" fill="#f0c060"/>
    </marker>
  </defs>
  ${arrowLines}
  ${boxEls}
</svg>`;
}

function escXML(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

app.post("/api/chat", async (req, res) => {
  const { message, history = [] } = req.body;
  if (!message) return res.status(400).json({ error: "message is required" });

  try {
    const messages = [
      ...history,
      { role: "user", content: `Explain this visually: ${message}` },
    ];

    console.log("🤖 Calling Groq for:", message);

    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_tokens: 1500,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages,
      ],
    });

    const rawText = response.choices[0].message.content;
    console.log("✓ Groq responded");
    console.log("Raw (first 300):", rawText.slice(0, 300));

    const cleaned = rawText.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error("❌ JSON parse failed:", rawText);
      return res.status(500).json({ error: "Invalid JSON from model. Try again." });
    }

    const svg = buildSVG(
      parsed.nodes || [],
      parsed.edges || [],
      parsed.layout || "horizontal"
    );

    res.json({
      explanation:      parsed.explanation,
      visual_title:     parsed.visual_title || "Diagram",
      svg,
      assistantMessage: rawText,
    });

  } catch (err) {
    console.error("❌ Groq API error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => {
  console.log(`\n🧠 Cognivis running at http://localhost:${PORT}\n`);
});