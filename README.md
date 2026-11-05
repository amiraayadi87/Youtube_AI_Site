# AI Watchlist

A personal YouTube page for an AI product builder: only **recent videos that help you build better AI products** (courses, build walkthroughs, conference talks with real lessons), from hand-picked channels.

## How it works

- `channels.json` lists the channels to pull from. `"favorite": true` gives a small score boost and skips the view-count filter (nothing is shown on the page).
- `scripts/relevance.mjs` asks Claude whether each new video is useful for an AI product builder and drops the rest (news, hype, drama, consumer ads). Each video is judged once; verdicts are cached in `data/judgments.json`. Needs the `ANTHROPIC_API_KEY` repository secret; without it a stricter keyword rule is used.
- Every 4 hours a GitHub Action (`.github/workflows/update.yml`) runs `scripts/fetch-videos.mjs`, which reads each channel's public YouTube RSS feed (no API key needed) and keeps a video only if it:
  1. was uploaded in the last 14 days,
  2. is about AI (title and description are checked against an AI keyword list),
  3. is not a Short,
  4. is holding its own against that channel's other uploads: its views are compared with what the channel's videos typically have at the same age. Videos under 36 hours old get a pass because it's too early to judge them.
- Each video gets a quality score (0–100): 60% performance against its own channel, 25% like rate, 15% freshness. Videos with more than 1.5× the views the channel's videos usually have at that age are tagged **Outperforming**.
- The result is saved to `data/videos.json` and the site is published with GitHub Pages.

## Using the site

- **Best / Newest**: sort by quality score or by upload time.
- **3d / 7d / 14d**: time window.
- Click a video to play it on the page. It's then marked as watched and hidden (untick **Hide watched** to see watched videos again). Watched history is kept in your browser only.

## Changing channels

Edit `channels.json` on GitHub. Add a channel with its handle (the part after `@` in its URL):

```json
{ "handle": "SomeChannel", "name": "Some Channel" }
```

The site rebuilds automatically after the edit. You can also run it any time from **Actions → Update videos and publish site → Run workflow**.

## Tuning (optional)

Set these as repository variables or edit the workflow:
- `MAX_AGE_DAYS` (default `14`)
- `MIN_RELATIVE_PERF` (default `0.35`): raise it to be stricter about quality.
