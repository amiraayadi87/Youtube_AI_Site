# AI Watchlist

A personal YouTube page that shows only **recent, good-quality AI videos** from hand-picked channels, with Nick Saraev pinned at the top.

## How it works

- `channels.json` lists the channels to follow. Channels marked `"favorite": true` get their own section at the top, and none of their AI videos are filtered out.
- Every 4 hours a GitHub Action (`.github/workflows/update.yml`) runs `scripts/fetch-videos.mjs`, which reads each channel's public YouTube RSS feed (no API key needed) and keeps a video only if it:
  1. was uploaded in the last 14 days,
  2. is about AI (title and description are checked against an AI keyword list),
  3. is not a Short,
  4. is holding its own against that channel's other recent uploads (views per day compared with the channel's median). Videos under 36 hours old get a pass because it's too early to judge them.
- Each video gets a quality score (0–100): 60% performance against its own channel, 25% like rate, 15% freshness. Videos getting more than 1.5× their channel's usual views per day are tagged **Outperforming**.
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
