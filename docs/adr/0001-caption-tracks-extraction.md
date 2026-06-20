# 0001 — Extract transcripts via `captionTracks`, not DOM scraping

Status: Accepted (2026-06-19)

## Context

The extension needs the transcript of the current YouTube video. There are two
realistic ways to obtain it from inside the user's browser:

- **A. `captionTracks`:** read the `ytInitialPlayerResponse` object embedded in
  the watch page, find
  `captions.playerCaptionsTracklistRenderer.captionTracks[]`, and fetch the
  chosen track's `baseUrl` with `&fmt=json3` to get structured caption segments.
- **B. DOM scrape:** programmatically open YouTube's "Show transcript" panel and
  read the rendered `<ytd-transcript-segment-renderer>` elements.

Server-side libraries (e.g. `youtube-transcript-api`) get IP-blocked on cloud
hosts, but that doesn't apply here: our fetches run in the user's logged-in
browser session, sharing their IP and cookies.

## Decision

Use approach A. Read `captionTracks` and fetch the `fmt=json3` caption file.

## Consequences

- Cleaner, structured data (text + timing) independent of YouTube's visual
  layout; works even if the user never opened the transcript panel.
- Less brittle than DOM scraping: depends on the shape of an internal JSON
  object, which changes less often than CSS class names and DOM structure.
- Still undocumented and unofficial — YouTube can rename fields and break us. If
  A starts failing in practice, DOM scraping (B) remains a fallback we can add
  later.
- Timing data from the segments is fetched but discarded (v1 outputs prose with
  no timestamps).
