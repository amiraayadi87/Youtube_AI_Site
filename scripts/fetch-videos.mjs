#!/usr/bin/env node
// Builds data/videos.json from the public YouTube RSS feeds of the channels in channels.json.
// No API key needed. Runs on a schedule in GitHub Actions (see .github/workflows/update.yml).
//
// Filters applied:
//   1. Recent:   uploaded within MAX_AGE_DAYS (default 14)
//   2. About AI: title/description matches the AI keyword list
//   3. No Shorts
//   4. Quality:  the video must be holding its own against the channel's other recent uploads
//                (views/day relative to the channel median, plus like rate). Favorite channels skip this.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_AGE_DAYS = Number(process.env.MAX_AGE_DAYS || 14);
const MIN_RELATIVE_PERF = Number(process.env.MIN_RELATIVE_PERF || 0.35); // fraction of channel median views/day
const TOO_NEW_TO_JUDGE_HOURS = 36;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

const AI_PATTERNS = [
  /\bA\.?I\.?\b/, /artificial intelligence/i, /machine learning/i, /deep learning/i, /neural/i,
  /\bLLMs?\b/i, /\bGPT/i, /chat ?gpt/i, /\bclaude\b/i, /\bgemini\b/i, /openai/i, /anthropic/i, /deepmind/i,
  /\bagents?\b/i, /agentic/i, /\bn8n\b/i, /automat(ion|e|ing)/i, /\bprompt/i, /\bRAG\b/, /\bMCP\b/,
  /copilot/i, /\bcursor\b/i, /vibe ?cod/i, /\bcodex\b/i, /midjourney/i, /\bsora\b/i, /\bveo\b/i,
  /diffusion/i, /transformer/i, /\bllama\b/i, /mistral/i, /deepseek/i, /\bgrok\b/i, /\bqwen\b/i,
  /\bAGI\b/, /superintelligen/i, /reasoning model/i, /fine.?tun/i, /\bmodels?\b/i, /chatbot/i,
];

const decode = (s = "") =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&amp;/g, "&");

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1].trim()) : "";
};
const attr = (xml, name, a) => {
  const m = xml.match(new RegExp(`<${name}[^>]*\\s${a}="([^"]*)"`));
  return m ? decode(m[1]) : "";
};

export function parseFeed(xml) {
  const entries = xml.split("<entry>").slice(1).map((e) => e.split("</entry>")[0]);
  return entries.map((e) => ({
    id: tag(e, "yt:videoId"),
    channelId: tag(e, "yt:channelId"),
    title: tag(e, "title"),
    link: attr(e, "link", "href"),
    author: tag(e.match(/<author>([\s\S]*?)<\/author>/)?.[1] || "", "name"),
    published: tag(e, "published"),
    description: tag(e, "media:description"),
    thumbnail: attr(e, "media:thumbnail", "url"),
    views: Number(attr(e, "media:statistics", "views") || 0),
    likes: Number(attr(e, "media:starRating", "count") || 0),
  }));
}

export const isAboutAI = (v) => AI_PATTERNS.some((re) => re.test(`${v.title}\n${v.description.slice(0, 600)}`));

async function get(url, opts = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" }, ...opts });
      if (res.status >= 500 && attempt < 3) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

async function resolveChannelId(handle) {
  const res = await get(`https://www.youtube.com/@${encodeURIComponent(handle)}`);
  if (!res.ok) throw new Error(`@${handle}: HTTP ${res.status}`);
  const html = await res.text();
  const m =
    html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/) ||
    html.match(/"externalId":"(UC[\w-]{22})"/) ||
    html.match(/"channelId":"(UC[\w-]{22})"/);
  if (!m) throw new Error(`@${handle}: channel id not found on page`);
  return m[1];
}

// A /shorts/ URL answers 200 for a Short and redirects for a normal video.
async function isShort(v) {
  if (/\/shorts\//.test(v.link) || /#shorts?\b/i.test(v.title + v.description)) return true;
  try {
    const res = await get(`https://www.youtube.com/shorts/${v.id}`, { method: "HEAD", redirect: "manual" });
    return res.status === 200;
  } catch {
    return false;
  }
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

async function main() {
  const { channels } = JSON.parse(await readFile(path.join(ROOT, "channels.json"), "utf8"));
  await mkdir(path.join(ROOT, "data"), { recursive: true });

  const cachePath = path.join(ROOT, "data", "channel-ids.json");
  let idCache = {};
  try { idCache = JSON.parse(await readFile(cachePath, "utf8")); } catch {}

  const now = Date.now();
  const cutoff = now - MAX_AGE_DAYS * 864e5;
  const videos = [];
  const report = [];

  for (const ch of channels) {
    try {
      const channelId = ch.channelId || idCache[ch.handle] || (await resolveChannelId(ch.handle));
      idCache[ch.handle] = channelId;

      const res = await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
      if (!res.ok) throw new Error(`feed HTTP ${res.status}`);
      // Drop Shorts before anything else: they get very different view counts and would
      // drag the channel baseline down, making every normal video look like a breakout.
      const all = parseFeed(await res.text());
      const shortFlags = await Promise.all(all.map(isShort));
      const feed = all.filter((_, i) => !shortFlags[i]);

      // Channel baseline: typical total views of its uploads that are at least a week old.
      // A younger video is compared with the share of that total it "should" have by now
      // (views pile up fast at first, then flatten, roughly like sqrt(age / 7 days)).
      const ageDays = (v) => (now - Date.parse(v.published)) / 864e5;
      const mature = feed.filter((v) => ageDays(v) >= 7);
      const typicalViews = median((mature.length >= 3 ? mature : feed).map((v) => v.views)) || 1;
      const expectedViews = (v) => typicalViews * Math.min(1, Math.sqrt(Math.max(ageDays(v), 0.1) / 7));
      const likeBaseline = median(feed.filter((v) => v.views > 0).map((v) => v.likes / v.views)) || 0.03;

      let kept = 0;
      for (const v of feed) {
        const t = Date.parse(v.published);
        if (!(t >= cutoff) || !isAboutAI(v)) continue;

        const ageHours = (now - t) / 36e5;
        const relPerf = v.views / expectedViews(v);
        const likeRate = v.views ? v.likes / v.views : 0;
        const relLikes = likeRate / likeBaseline;
        const judged = ageHours >= TOO_NEW_TO_JUDGE_HOURS;
        if (!ch.favorite && judged && relPerf < MIN_RELATIVE_PERF) continue;

        // Quality score 0-100: outperformance vs channel (60%), engagement vs channel (25%), freshness (15%).
        const perfPart = Math.min(Math.log2(1 + relPerf) / Math.log2(4), 1);
        const likePart = Math.min(relLikes / 1.5, 1);
        const freshPart = Math.max(0, 1 - ageHours / (MAX_AGE_DAYS * 24));
        const score = Math.min(100, Math.round(100 * (0.6 * perfPart + 0.25 * likePart + 0.15 * freshPart)) + (ch.favorite ? 5 : 0));

        videos.push({
          id: v.id,
          title: v.title,
          url: `https://www.youtube.com/watch?v=${v.id}`,
          thumbnail: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
          channel: ch.name || v.author,
          channelHandle: ch.handle,
          favorite: !!ch.favorite,
          published: v.published,
          views: v.views,
          likes: v.likes,
          description: v.description.slice(0, 280),
          score,
          outperforming: judged && relPerf >= 1.5,
          relPerf: Math.round(relPerf * 100) / 100,
        });
        kept++;
      }
      report.push(`ok   ${ch.name.padEnd(20)} ${String(all.length).padStart(2)} in feed, ${String(all.length - feed.length).padStart(2)} shorts, ${kept} kept`);
    } catch (err) {
      report.push(`FAIL ${ch.name.padEnd(20)} ${err.message}`);
    }
  }

  videos.sort((a, b) => b.score - a.score);
  await writeFile(cachePath, JSON.stringify(idCache, null, 2) + "\n");
  await writeFile(
    path.join(ROOT, "data", "videos.json"),
    JSON.stringify({ updated: new Date(now).toISOString(), maxAgeDays: MAX_AGE_DAYS, videos }, null, 2) + "\n"
  );
  console.log(report.join("\n"));
  console.log(`\n${videos.length} videos written to data/videos.json`);
  if (report.every((l) => l.startsWith("FAIL"))) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
