// Extraction logic. Runs entirely in the participant's browser.
// Keeps only video IDs and timestamps from TikTok watch history.
// Everything else in the export (messages, searches, profile, etc.) is ignored.

(function (root) {
  "use strict";

  // Section names TikTok has used for watch history across export versions.
  const HISTORY_KEYS = [
    "video browsing history",
    "watch history",
    "browsing history",
  ];

  // Walk the JSON and find every array of {Date, Link} items that sits
  // under a watch-history section. Returns raw items.
  // Collects into one array (no spread), so histories of any length are safe.
  function findWatchLists(node, inHistory, found) {
    if (!node || typeof node !== "object") return found;
    if (Array.isArray(node)) {
      if (inHistory && node.length && looksLikeWatchItem(node[0])) {
        for (let i = 0; i < node.length; i++) found.push(node[i]);
        return found;
      }
      for (let i = 0; i < node.length; i++) {
        const child = node[i];
        if (child && typeof child === "object") findWatchLists(child, inHistory, found);
      }
      return found;
    }
    for (const key of Object.keys(node)) {
      findWatchLists(node[key], inHistory || HISTORY_KEYS.includes(key.toLowerCase()), found);
    }
    return found;
  }

  function getField(item, names) {
    for (const k of Object.keys(item)) {
      if (names.includes(k.toLowerCase())) return item[k];
    }
    return undefined;
  }

  function looksLikeWatchItem(item) {
    return item && typeof item === "object" &&
      getField(item, ["date", "time"]) !== undefined &&
      getField(item, ["link", "videolink", "url"]) !== undefined;
  }

  // Must match the receiver's rule (apps-script/Code.gs).
  const DATE_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?\s?(Z|UTC|[+-]\d{2}:?\d{2})?$/;

  // Pull the numeric video ID out of a TikTok link.
  // e.g. https://www.tiktokv.com/share/video/7234567890123456789/
  function videoIdFromLink(link) {
    if (typeof link !== "string") return null;
    const m = link.match(/(?:video\/|\/v\/|item_id=)(\d{8,25})/);
    return m ? m[1] : null;
  }

  // ---- TXT exports ----
  // TikTok's TXT export is a set of .txt files. Only files named as watch or
  // browsing history are read; messages, searches, etc. are never opened.
  function isHistoryFile(path) {
    const name = String(path).split("/").pop().toLowerCase();
    // Exact names only, so "Drama Watch History", "Search History", etc. are never opened.
    return /^(video[ _-]?)?(watch|browsing)[ _-]?history\.txt$/.test(name);
  }

  // Convert a TXT watch-history file into the same structure as the JSON
  // export, so both formats go through one pipeline. Entries look like:
  //   Date: 2026-10-02 20:15:03
  //   Link: https://www.tiktokv.com/share/video/7234567890123456789/
  function txtToJson(text) {
    const list = [];
    let date = null;
    const lines = String(text).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^\s*([A-Za-z ]+?)\s*:\s*(.*?)\s*$/);
      if (!m) continue;
      const key = m[1].toLowerCase().replace(/\s+/g, "");
      if (key === "date" || key === "time") date = m[2];
      else if ((key === "link" || key === "videolink" || key === "url") && date !== null) {
        list.push({ Date: date, Link: m[2] });
        date = null;
      }
    }
    return { Activity: { "Video Browsing History": { VideoList: list } } };
  }

  // Main entry: JSON object in, clean rows out.
  function extract(json) {
    const raw = findWatchLists(json, false, []);
    const seen = new Set();
    const rows = [];
    for (const item of raw) {
      const date = String(getField(item, ["date", "time"]) || "").trim();
      const id = videoIdFromLink(getField(item, ["link", "videolink", "url"]));
      if (!id || !DATE_RE.test(date)) continue;
      const key = id + "|" + date;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ video_id: id, watched_at: date });
    }
    rows.sort((a, b) => a.watched_at.localeCompare(b.watched_at));
    return rows;
  }

  function toCSV(rows, rid, sid) {
    const esc = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    const lines = ["rid,sid,video_id,watched_at"];
    for (const r of rows) lines.push([rid, sid, r.video_id, r.watched_at].map(esc).join(","));
    return lines.join("\n") + "\n";
  }

  // Split rows into CSV parts, each under maxBytes, each with its own header.
  function toCSVParts(rows, rid, sid, maxBytes) {
    const header = "rid,sid,video_id,watched_at\n";
    const esc = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    const parts = [];
    let cur = header, curBytes = header.length;
    for (const r of rows) {
      const line = [rid, sid, r.video_id, r.watched_at].map(esc).join(",") + "\n";
      if (curBytes + line.length > maxBytes && cur !== header) {
        parts.push(cur); cur = header; curBytes = header.length;
      }
      cur += line; curBytes += line.length;
    }
    parts.push(cur);
    return parts;
  }

  const api = { extract, toCSV, toCSVParts, videoIdFromLink, txtToJson, isHistoryFile };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TikTokExtract = api;
})(this);
