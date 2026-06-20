"use strict";

// ---------------------------------------------------------------------------
// Injected into the active tab's MAIN world (the page's own JS context) on
// popup open. MAIN world is required so we can read page globals (`window.ytcfg`,
// `window.ytInitialPlayerResponse`) and operate the page's own UI. Must be fully
// self-contained: it is serialized and run in the page, so it cannot close over
// anything here.
//
// Strategy (see docs/adr/0002): YouTube blocks direct caption-file fetches with
// a PoToken requirement, so we use a layered approach with a guaranteed
// fallback:
//   1. InnerTube ANDROID `/player` -> captionTracks -> json3. The ANDROID
//      client's caption URLs are typically not PoToken-gated.
//   2. If that yields nothing, scrape YouTube's own transcript panel: open it
//      and read the rendered segments. YouTube performs the authenticated
//      fetch itself, so this can't be PoToken-blocked.
// A `trace`/`detail` string records each boundary so a failure says where it
// broke.
// ---------------------------------------------------------------------------
async function extractTranscript() {
  const trace = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const normalize = (s) => s.replace(/\s+/g, " ").trim();

  function currentId() {
    try {
      const u = new URL(location.href);
      if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2] || "";
      return u.searchParams.get("v") || "";
    } catch {
      return "";
    }
  }

  function fail(reason, note) {
    return { ok: false, reason, detail: note + " | " + trace.join(" > ") };
  }

  // manual track in page language → any manual track → auto-generated (asr).
  function pickTrack(tracks) {
    const manual = tracks.filter((t) => (t.kind || "") !== "asr");
    const pool = manual.length ? manual : tracks;
    const lang = (navigator.language || "en").slice(0, 2).toLowerCase();
    const match = pool.find(
      (t) => (t.languageCode || "").slice(0, 2).toLowerCase() === lang
    );
    return match || pool[0];
  }

  // Attempt 1: InnerTube ANDROID /player, then fetch the caption file as json3.
  async function viaPlayer(wantId) {
    try {
      const ytcfg = window.ytcfg;
      const key = ytcfg && ytcfg.get && ytcfg.get("INNERTUBE_API_KEY");
      if (!key) {
        trace.push("player:no-key");
        return null;
      }
      const res = await fetch(
        "https://www.youtube.com/youtubei/v1/player?key=" + encodeURIComponent(key),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            context: {
              client: {
                clientName: "ANDROID",
                clientVersion: "20.10.38",
                androidSdkVersion: 30,
                hl: "en",
                gl: "US",
              },
            },
            videoId: wantId,
          }),
        }
      );
      trace.push("player:" + res.status);
      if (!res.ok) return null;
      const data = await res.json();
      const tracks =
        data &&
        data.captions &&
        data.captions.playerCaptionsTracklistRenderer &&
        data.captions.playerCaptionsTracklistRenderer.captionTracks;
      if (!tracks || !tracks.length) {
        trace.push("player:no-tracks");
        return null;
      }
      const track = pickTrack(tracks);
      const url = new URL(track.baseUrl, location.origin);
      url.searchParams.set("fmt", "json3");
      const cap = await fetch(url.toString(), { credentials: "include" });
      trace.push("cap:" + cap.status);
      if (!cap.ok) return null;
      const text = await cap.text();
      if (!text) {
        trace.push("cap:empty");
        return null;
      }
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        trace.push("cap:notjson");
        return null;
      }
      const body = normalize(
        (json.events || [])
          .filter((e) => e.segs)
          .map((e) => e.segs.map((s) => s.utf8 || "").join(""))
          .join(" ")
      );
      if (!body) {
        trace.push("cap:empty-body");
        return null;
      }
      trace.push("player:ok");
      return body;
    } catch (e) {
      trace.push("player:err(" + e.message + ")");
      return null;
    }
  }

  // Attempt 2: open and scrape YouTube's transcript panel.
  async function viaPanel() {
    function read() {
      const nodes = document.querySelectorAll("ytd-transcript-segment-renderer");
      if (!nodes.length) return null;
      const out = [];
      nodes.forEach((n) => {
        const t = n.querySelector(".segment-text");
        out.push(((t ? t.textContent : n.textContent) || "").trim());
      });
      const filtered = out.filter(Boolean);
      return filtered.length ? filtered : null;
    }

    let segs = read();
    if (segs) {
      trace.push("panel:already");
      return normalize(segs.join(" "));
    }

    // Expand the description, where the "Show transcript" button lives.
    const expand = document.querySelector(
      "ytd-text-inline-expander #expand, tp-yt-paper-button#expand"
    );
    if (expand) {
      expand.click();
      await sleep(300);
    }

    // Find any control whose label mentions "transcript" and click it.
    let btn = null;
    const els = document.querySelectorAll(
      "button, a, tp-yt-paper-button, ytd-button-renderer, yt-button-shape"
    );
    for (const c of els) {
      const label = (
        ((c.getAttribute && c.getAttribute("aria-label")) || "") +
        " " +
        (c.textContent || "")
      ).toLowerCase();
      if (label.includes("transcript")) {
        btn = c;
        break;
      }
    }
    if (!btn) {
      trace.push("panel:no-button");
      return null;
    }
    btn.click();

    // Wait for the panel to populate (~4.5s max).
    for (let i = 0; i < 30; i++) {
      await sleep(150);
      segs = read();
      if (segs) {
        trace.push("panel:ok");
        return normalize(segs.join(" "));
      }
    }
    trace.push("panel:timeout");
    return null;
  }

  try {
    const wantId = currentId();
    trace.push("id=" + (wantId || "?"));

    let body = await viaPlayer(wantId);
    if (!body) body = await viaPanel();
    if (!body) return fail("read-failed", "all-methods-failed");

    const player = window.ytInitialPlayerResponse;
    const title =
      (player && player.videoDetails && player.videoDetails.title) ||
      document.title.replace(/\s*-\s*YouTube\s*$/, "").trim() ||
      "transcript";

    return { ok: true, title, videoId: wantId, body, detail: trace.join(" > ") };
  } catch (e) {
    return fail("read-failed", "throw:" + (e && e.message));
  }
}

// ---------------------------------------------------------------------------
// Popup orchestration (runs in the popup's own context, has chrome.* access).
// ---------------------------------------------------------------------------
const copyBtn = document.getElementById("copy");
const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status");
const detailEl = document.getElementById("detail");

let transcript = null; // { text, filename } once loaded

function setStatus(message, kind) {
  statusEl.textContent = message;
  statusEl.className = kind || "";
}

const MESSAGES = {
  "not-youtube": "Open a YouTube video first.",
  "no-captions": "This video has no captions.",
  "read-failed": "Couldn't read the transcript — try reloading the page.",
};

function sanitizeFilename(title, videoId) {
  const cleaned = (title || "")
    .replace(/[\\/:*?"<>|]/g, "_") // illegal on Windows/most filesystems
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return (cleaned || videoId || "transcript") + ".txt";
}

function isYouTubeVideo(urlString) {
  let u;
  try {
    u = new URL(urlString);
  } catch {
    return false;
  }
  if (!/(^|\.)youtube\.com$/.test(u.hostname)) return false;
  return (
    (u.pathname === "/watch" && u.searchParams.has("v")) ||
    u.pathname.startsWith("/shorts/")
  );
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

function downloadTxt(text, filename) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

copyBtn.addEventListener("click", async () => {
  if (!transcript) return;
  const ok = await copyToClipboard(transcript.text);
  setStatus(ok ? "Copied to clipboard." : "Copy failed.", ok ? "ok" : "error");
});

saveBtn.addEventListener("click", () => {
  if (!transcript) return;
  downloadTxt(transcript.text, transcript.filename);
  setStatus("Saved " + transcript.filename, "ok");
});

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !isYouTubeVideo(tab.url)) {
    setStatus(MESSAGES["not-youtube"], "error");
    return;
  }

  let result;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: extractTranscript,
    });
    result = injection?.result;
  } catch (e) {
    result = { ok: false, reason: "read-failed", detail: "inject-threw: " + e.message };
  }

  if (!result || !result.ok) {
    // Surface the boundary trace only on failure (YouTube changes often, and
    // this is what tells us which method/step broke).
    console.warn("[YT Transcript]", result);
    detailEl.textContent = result?.detail || "";
    setStatus(MESSAGES[result?.reason] || MESSAGES["read-failed"], "error");
    return;
  }
  detailEl.textContent = "";

  const url = result.videoId
    ? "https://www.youtube.com/watch?v=" + result.videoId
    : tab.url;
  transcript = {
    text: `${result.title}\n${url}\n\n${result.body}`,
    filename: sanitizeFilename(result.title, result.videoId),
  };

  copyBtn.disabled = false;
  saveBtn.disabled = false;
  setStatus("Transcript ready.", "ok");
}

init();
