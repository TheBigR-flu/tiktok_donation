/**
 * Receiver for the TikTok donation page.
 * Deploy as a Web app: Execute as = Me, Who has access = Anyone.
 * Visitors can only ADD files to one folder. They can't read anything.
 */

// Paste the ID of your private Drive folder here
// (the part after /folders/ in the folder's URL).
const FOLDER_ID = "PASTE_FOLDER_ID_HERE";

// Keep false until IRB approval. While false, only test IDs 00000–00999 are saved.
// Set to true (here AND in index.html) to open the study, then deploy a new version.
const COLLECTION_OPEN = false;

// Raffle. The page gets this link ONLY after the last part of a donation is saved,
// so it never appears in the public GitHub code. The key is the same for everyone
// (it proves "donated", not who). Keep the real values here, not in the repo.
const RAFFLE_URL = "PASTE_RAFFLE_LINK_HERE";
const RAFFLE_KEY = "PASTE_RAFFLE_KEY_HERE";

const MAX_ROWS = 60000;   // per request; the page sends in chunks
// Same rules as extract.js on the page.
const ID_RE = /^\d{8,25}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?\s?(Z|UTC|[+-]\d{2}:?\d{2})?$/;

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const clean = validate(data);
    const folder = DriveApp.getFolderById(FOLDER_ID);
    const stamp = Utilities.formatDate(new Date(), "UTC", "yyyyMMdd'T'HHmmss");
    const name = clean.sid + "_" + (clean.rid || "norid") + "_" + stamp +
      "_part" + clean.part + "of" + clean.parts + ".csv";
    folder.createFile(name, toCSV(clean), MimeType.CSV);
    return reply(savedReply(clean));
  } catch (err) {
    return reply({ ok: false, error: String(err.message || err) });
  }
}

// Reject anything that isn't exactly the expected shape.
function validate(d) {
  if (!d || typeof d !== "object") throw new Error("bad request");
  const sid = String(d.sid || "");
  if (!/^\d{5}$/.test(sid)) throw new Error("bad study ID");
  if (!COLLECTION_OPEN && !/^00\d{3}$/.test(sid)) throw new Error("study not open yet");
  const rid = String(d.rid || "");
  if (rid && !/^R_[A-Za-z0-9]{10,20}$/.test(rid)) throw new Error("bad survey code");
  const part = Number(d.part), parts = Number(d.parts);
  if (!(Number.isInteger(part) && Number.isInteger(parts) && part >= 1 && part <= parts && parts <= 50)) {
    throw new Error("bad part number");
  }
  if (!Array.isArray(d.rows) || d.rows.length === 0 || d.rows.length > MAX_ROWS) throw new Error("bad rows");
  // Keep well-formed rows; skip anything else rather than losing the whole batch.
  const rows = [];
  d.rows.forEach(function (r) {
    if (!Array.isArray(r) || r.length !== 2) return;
    const id = String(r[0]), at = String(r[1]);
    if (ID_RE.test(id) && DATE_RE.test(at)) rows.push([id, at]);
  });
  if (rows.length === 0) throw new Error("no valid rows");
  return { sid: sid, rid: rid, part: part, parts: parts, rows: rows, skipped: d.rows.length - rows.length };
}

// Reply after a part is saved. Only the LAST part carries the raffle link,
// and the page sends parts in order, stopping at any failure.
function savedReply(clean) {
  const out = { ok: true, part: clean.part, parts: clean.parts, saved: clean.rows.length, skipped: clean.skipped };
  if (clean.part === clean.parts) out.raffle = raffleLink();
  return out;
}

function raffleLink() {
  if (!/^https:\/\//.test(RAFFLE_URL)) return "";
  return RAFFLE_URL + (RAFFLE_URL.indexOf("?") < 0 ? "?" : "&") + "k=" + encodeURIComponent(RAFFLE_KEY);
}

function toCSV(c) {
  const lines = ["rid,sid,video_id,watched_at"];
  c.rows.forEach(function (r) { lines.push([c.rid, c.sid, r[0], r[1]].join(",")); });
  return lines.join("\n") + "\n";
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Lets you check the deployment by opening the URL in a browser.
function doGet() {
  return reply({ ok: true, status: "receiver running", collectionOpen: COLLECTION_OPEN });
}

// For local testing only (ignored by Apps Script).
if (typeof module !== "undefined") module.exports = { validate: validate, toCSV: toCSV, raffleLink: raffleLink, savedReply: savedReply };
