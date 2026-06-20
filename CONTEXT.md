# Context: YouTube Transcript Copy

A Chrome extension (Manifest V3) that does one thing: get the transcript of the
currently-open YouTube video and either copy it to the clipboard or save it to a
file. Primary use case: feeding a transcript to an LLM.

## Glossary

### Transcript
The full spoken text of a YouTube video, derived from its captions. In this
project the Transcript is delivered as **plain prose** (caption fragments joined
and whitespace-normalized), with **no timestamps**, preceded by a header.

### Header
Two lines prepended to every Transcript: the video **title** and the video
**URL**, followed by a blank line. Makes a copied/saved Transcript
self-identifying.

### Caption Segment
One line of caption text that gets joined with the others to form the prose
Transcript. We obtain Segments by a layered extractor (see ADR 0002, which
supersedes ADR 0001): first the InnerTube ANDROID `/player` caption track, and
if that is blocked, by scraping YouTube's on-page transcript panel. Directly
fetching the WEB caption file is blocked by YouTube's PoToken requirement.

### Copy action
Popup action: write the Transcript to the system clipboard.

### Save action
Popup action: download the Transcript as a `.txt` file named after the sanitized
video title (falling back to the video ID), via an in-page Blob download link
(no `downloads` permission required).

### Popup
The extension's only UI: a small panel opened from the Chrome toolbar icon,
offering the Copy action and the Save action plus status feedback.
