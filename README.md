# YouTube Transcript Copy

A tiny Chrome extension (Manifest V3) that does one thing: grab the transcript of
the YouTube video you're watching and either **copy it to your clipboard** or
**save it as a `.txt` file**. Built for feeding transcripts to an LLM.

## What it does

1. Click the extension's toolbar icon while on a YouTube video.
2. The popup reads the video's captions and shows two buttons:
   - **Copy transcript** → puts it on your clipboard.
   - **Save as .txt** → downloads it, named after the video title.
3. Output is the video **title + URL** header, then the transcript as plain
   prose (no timestamps).

It auto-selects a caption track (preferring human-written captions in your
browser language, falling back to other manual tracks, then auto-generated
captions). Works on `/watch` and `/shorts` pages.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Pin the extension, open a YouTube video, and click the icon.

## How it works

On click it injects a small function into the page (MAIN world) that extracts the
transcript with a layered, fallback-safe strategy:

1. **InnerTube ANDROID `/player`** → read `captionTracks` → fetch the chosen
   track as `fmt=json3` → join to prose.
2. If that's empty or blocked, **scrape YouTube's own transcript panel** — open
   it and read the rendered segments, letting YouTube do the authenticated
   fetch.

Direct WEB caption-file fetches are blocked by YouTube's PoToken requirement, so
the layered approach is what makes this reliable. Because everything runs in the
page's own `youtube.com` origin, the extension needs only `activeTab` +
`scripting` — no broad host permissions, no background service worker. See
[docs/adr/0002](docs/adr/0002-innertube-get-transcript.md) for the full
rationale (and [0001](docs/adr/0001-caption-tracks-extraction.md) for the
superseded first approach).

## Not in v1 (easy follow-ups)

- Language picker / timestamp toggle / `.md` output
- Chrome Web Store packaging

## Limitations

- Relies on undocumented YouTube internals (InnerTube player response and the
  transcript-panel DOM); a YouTube change could break a layer. The two layers
  back each other up, and on failure the popup shows a small diagnostic line
  indicating which step broke.
- Videos with no captions at all can't produce a transcript.
