// Decides whether a video is worth the time of an AI product builder.
//
// With ANTHROPIC_API_KEY set, Claude judges each new video once (title + description) and the
// verdict is cached in data/judgments.json, so later runs only pay for videos they haven't seen.
// Without a key (or if the API call fails), a stricter keyword rule is used instead.

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-5-5";
const BATCH = 25;

const SYSTEM = `You curate a YouTube feed for an AI product builder: someone who designs, builds and ships products on top of LLMs and AI models, and wants to get better at it.

Mark a video useful only if watching it would help them grow in that work, for example:
- courses, tutorials and hands-on build walkthroughs (agents, RAG, evals, prompting, tool use, MCP, coding with AI, automation)
- engineering and product talks with concrete lessons (conference talks, AI Engineer, Startup School, builder case studies)
- AI product strategy, design, pricing, go-to-market, or founder lessons with specific takeaways
- model or developer-tool launches that change what builders can make, explained in enough depth to act on

Mark it not useful if it is mainly:
- news roundups, hype, reaction or clickbait ("they did it...", "X crushed everyone") with little to learn
- speculation, drama, AI doom, politics, stock/IPO/investing talk
- consumer feature announcements, short ads or customer testimonials without technical or product depth
- general business, lifestyle or money-making content not specific to building AI products
- interviews or podcasts with no clear builder takeaways

When unsure, lean towards not useful: the feed should be short and high-signal. Give a short reason (max 15 words) written for the viewer, e.g. "Hands-on walkthrough of building an eval pipeline".`;

const SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          useful: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["id", "useful", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

async function askClaude(batch, apiKey) {
  const list = batch
    .map((v) => `id: ${v.id}\nchannel: ${v.channel}\ntitle: ${v.title}\ndescription: ${v.description.slice(0, 500).replace(/\s+/g, " ")}`)
    .join("\n\n---\n\n");
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2026-10-21",
      "anthropic-beta": "server-side-fallback-2026-07-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: `Judge each of these ${batch.length} videos. Return one result per id.\n\n${list}` }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const msg = await res.json();
  if (msg.stop_reason !== "end_turn") throw new Error(`Claude stopped with ${msg.stop_reason}`);
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text).results;
}

// Fallback when Claude isn't available: needs a "how to learn/build" signal and no hype/news signal.
const HELPFUL = /\b(how (to|i|we)|tutorial|course|guide|walkthrough|build(ing)?|step[- ]by[- ]step|lessons?|workshop|talk|explained|deep dive|from scratch|beginner|masterclass|eval|agents?|rag|mcp|prompt|workflow|automat|ship|product|startup school)\b/i;
const NOISE = /\b(news|stocks?|ipo|going public|billionaires?|drama|reacts?|reaction|crushed|they (actually )?did it|concerning|death of|warn(s|ing)|ranked|honest take|is dead|shocking|insane|scary|vs\.?)\b|\.\.\.$/i;
export const ruleBasedUseful = (v) => HELPFUL.test(v.title) && !NOISE.test(v.title);

// Returns a Map id -> { useful, reason, source }. `cache` is mutated with new Claude verdicts.
export async function judge(videos, cache, apiKey, log = console.log) {
  const verdicts = new Map();
  const todo = [];
  for (const v of videos) {
    if (cache[v.id]) verdicts.set(v.id, { ...cache[v.id], source: "claude" });
    else todo.push(v);
  }
  if (apiKey) {
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      try {
        for (const r of await askClaude(batch, apiKey)) {
          if (!batch.some((v) => v.id === r.id)) continue;
          cache[r.id] = { useful: r.useful, reason: r.reason, judged: new Date().toISOString() };
          verdicts.set(r.id, { ...cache[r.id], source: "claude" });
        }
      } catch (err) {
        log(`relevance: ${err.message}; using keyword rule for ${batch.length} videos`);
      }
    }
  }
  for (const v of videos) {
    if (!verdicts.has(v.id)) verdicts.set(v.id, { useful: ruleBasedUseful(v), reason: "", source: "rule" });
  }
  return verdicts;
}
