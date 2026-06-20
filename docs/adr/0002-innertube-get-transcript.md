# 0002 — Layered extraction: ANDROID `/player` + transcript-panel scrape

Status: Accepted (2026-06-19). Supersedes the extraction mechanism of
[0001](0001-caption-tracks-extraction.md).

## Context

ADR 0001 fetched `captionTracks[].baseUrl` directly with `fmt=json3`. In testing
this returned **HTTP 200 with an empty body**.

Root cause (confirmed against external reports): YouTube now stamps WEB caption
`baseUrl`s with `&exp=xpe`, requiring a **PoToken** — a proof-of-origin token
minted at runtime by the player JavaScript. A direct fetch without it returns an
empty 200 even from a logged-in browser. There is no documented way to mint one.
(jdepoix/youtube-transcript-api#592, karthink/elfeed-tube#43.)

Two replacements were tried:

1. **InnerTube `get_transcript`** (the endpoint YouTube's own "Show transcript"
   uses). We sent the page's continuation token + `INNERTUBE_CONTEXT`. It
   returned **HTTP 400 `FAILED_PRECONDITION` ("Precondition check failed.")**.
   This error is documented as tied to client-version mismatches and is reported
   as intermittent/flaky — a poor foundation. (LuanRT/YouTube.js#1102,
   ReVanced/revanced-patches#5572.)

2. **InnerTube ANDROID `/player`.** Requesting the player with an ANDROID client
   context returns `captionTracks` whose `baseUrl`s are typically *not*
   PoToken-gated, so fetching them as `json3` yields real data.

## Decision

Use a layered extractor in the page's MAIN world, with a guaranteed fallback:

1. **InnerTube ANDROID `/player`** → `captionTracks` → fetch chosen track as
   `json3` → join to prose. Fast and structured.
2. If that yields nothing (empty/gated/no tracks), **scrape YouTube's own
   transcript panel**: open it (expand description, click the "transcript"
   control) and read the rendered `ytd-transcript-segment-renderer` text.
   YouTube performs the authenticated fetch itself, so this can't be
   PoToken-blocked — it is the robust backstop.

`get_transcript` was evaluated and rejected (see above).

## Consequences

- Resilient: an undocumented-API change to method 1 falls through to the
  UI-level scrape, and vice versa.
- Both layers are still internal/undocumented (player response shape, ANDROID
  client behavior, transcript-panel DOM); any could change.
- Method 2 has visible side effects (it opens the transcript panel) and adds a
  short wait while the panel loads.
- We keep ADR 0001's `pickTrack` selection for method 1; method 2 returns
  whatever track the panel defaults to.
