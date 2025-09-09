// server.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  // IMPORTANT: Use SERVICE ROLE key on server only; never expose to frontend
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const app = express();
app.use(cors());
app.use(express.json());

// --- serve your static frontend (adjust path if needed) ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname))); // so ingres.html can be opened via http://localhost:3000/ingres.html

// --- OpenAI client ---
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Simple system prompt tailored to INGRES
const SYSTEM_PROMPT = `You are the INGRES groundwater assistant. Be concise, accurate, and helpful.
If asked for trends or a table, explain briefly in plain English.`;

app.post("/api/chat", async (req, res) => {
  try {
    const { text, lang } = req.body ?? {};
    if (!text || typeof text !== "string") {
      return res.status(400).send("Missing 'text' in request body");
    }

    // === Fetch relevant context from Supabase (adjust table/columns to your schema) ===
    let kb = "";
    try {
      const { data: rows, error: sbErr } = await supabase
        .from("ingres_data") // TODO: change to your actual table name
        .select("block, state, year, metric, value") // TODO: change columns as needed
        .or(
          [
            `block.ilike.%${text}%`,
            `state.ilike.%${text}%`,
            `metric.ilike.%${text}%`
          ].join(",")
        )
        .limit(5);

      if (sbErr) {
        console.error("Supabase error:", sbErr.message || sbErr);
      }

      if (rows && rows.length) {
        kb = rows
          .map(r => `${r.block}, ${r.state}, ${r.year}: ${r.metric} = ${r.value}`)
          .join("\n");
      }
    } catch (e) {
      console.error("Supabase fetch exception:", e);
    }

    // You can switch models if you prefer
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            (kb ? `Relevant data from Supabase (top matches):\n${kb}\n\n` : "") +
            (lang && lang !== "en"
              ? `Language: ${lang}\nQuery: ${text}`
              : text)
        }
      ],
      temperature: 0.2
    });

    const content = completion.choices?.[0]?.message?.content?.trim() || "Sorry, I couldn’t generate a response.";

    // Your frontend expects one of: {type:'text'| 'table'| 'chart', ...}
    // Start simple with text; you can add formatting logic later.
    res.json({ type: "text", text: content });
  } catch (err) {
    console.error(err);
    res.status(500).send(typeof err?.message === "string" ? err.message : "Server error");
  }
});

const PORT = process.env.PORT || 3000;
app.get("/api/health", (req, res) => res.type("text").send("OK"));

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
  console.log(`Open http://localhost:${PORT}/ingres.html`);
});