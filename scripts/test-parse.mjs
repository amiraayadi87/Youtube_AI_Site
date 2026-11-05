// Quick offline check of the feed parser and AI filter: node scripts/test-parse.mjs
import assert from "node:assert/strict";
import { parseFeed, isAboutAI } from "./fetch-videos.mjs";

const xml = `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
<entry>
  <id>yt:video:abc123DEF45</id><yt:videoId>abc123DEF45</yt:videoId><yt:channelId>UCxxxxxxxxxxxxxxxxxxxxxx</yt:channelId>
  <title>I Built an AI Agent That Runs My Business &amp; More</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=abc123DEF45"/>
  <author><name>Nick Saraev</name><uri>https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx</uri></author>
  <published>2026-11-04T15:00:00+00:00</published>
  <media:group><media:title>t</media:title>
    <media:thumbnail url="https://i1.ytimg.com/vi/abc123DEF45/hqdefault.jpg" width="480" height="360"/>
    <media:description>Full n8n walkthrough</media:description>
    <media:community><media:starRating count="1234" average="5.00" min="1" max="5"/><media:statistics views="45678"/></media:community>
  </media:group>
</entry>
<entry>
  <id>yt:video:zzz</id><yt:videoId>zzz</yt:videoId><yt:channelId>UCy</yt:channelId>
  <title>My morning routine vlog</title><link rel="alternate" href="https://www.youtube.com/watch?v=zzz"/>
  <author><name>Someone</name></author><published>2026-11-03T10:00:00+00:00</published>
  <media:group><media:description>coffee and a walk</media:description>
  <media:community><media:starRating count="5"/><media:statistics views="100"/></media:community></media:group>
</entry></feed>`;

const [a, b] = parseFeed(xml);
assert.equal(a.id, "abc123DEF45");
assert.equal(a.title, "I Built an AI Agent That Runs My Business & More");
assert.equal(a.author, "Nick Saraev");
assert.equal(a.views, 45678);
assert.equal(a.likes, 1234);
assert.equal(isAboutAI(a), true);
assert.equal(isAboutAI(b), false);
assert.equal(isAboutAI({ title: "Claude Code just changed everything", description: "" }), true);
assert.equal(isAboutAI({ title: "Said what I said", description: "" }), false);
console.log("parser tests passed");
