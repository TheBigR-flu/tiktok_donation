// Run: node test/test.js
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const { extract, toCSV } = require("../extract.js");

const json = JSON.parse(fs.readFileSync(path.join(__dirname, "sample_tiktok.json"), "utf8"));
const rows = extract(json);

// Watch history from both export layouts, duplicate and bad link dropped, favorites ignored.
assert.deepStrictEqual(rows, [
  { video_id: "7234567890123456700", watched_at: "2026-10-02 20:14:40" },
  { video_id: "7234567890123456789", watched_at: "2026-10-02 20:15:03" },
  { video_id: "7300000000000000002", watched_at: "2026-10-03 07:00:00" },
]);

const csv = toCSV(rows, "R_abc", "28292");
for (const secret of ["should_not_appear", "private message", "friend", "7000000000000000001"]) {
  assert.ok(!csv.includes(secret), "leaked: " + secret);
}
assert.ok(csv.startsWith("rid,sid,video_id,watched_at\n"));
assert.strictEqual(csv.trim().split("\n").length, 4);

// Splitting: every part under the limit, each with a header, no rows lost or duplicated.
const { toCSVParts } = require("../extract.js");
const many = Array.from({ length: 5000 }, (_, i) => ({ video_id: String(7e18 + i), watched_at: "2026-10-01 00:00:" + i }));
const parts = toCSVParts(many, "R_abc", "28292", 50000);
assert.ok(parts.length > 1, "should split");
let total = 0;
for (const p of parts) {
  assert.ok(Buffer.byteLength(p) <= 50000, "part too big");
  assert.ok(p.startsWith("rid,sid,video_id,watched_at\n"));
  total += p.trim().split("\n").length - 1;
}
assert.strictEqual(total, 5000);
assert.strictEqual(toCSVParts(rows, "R_abc", "28292", 9e6).length, 1);

// TXT export converts to the same rows as JSON.
const { txtToJson, isHistoryFile } = require("../extract.js");
const txt = fs.readFileSync(path.join(__dirname, "sample_watch_history.txt"), "utf8");
assert.deepStrictEqual(extract(txtToJson(txt)), rows, "TXT and JSON should give identical rows");
assert.deepStrictEqual(extract(txtToJson(txt.replace(/\n/g, "\r\n"))), rows, "Windows line endings");
assert.ok(isHistoryFile("TikTok/Activity/Watch History.txt"));
assert.ok(isHistoryFile("Activity/Browsing History.txt"));
assert.ok(isHistoryFile("Video Browsing History.txt"));
assert.ok(!isHistoryFile("Activity/Search History.txt"));
assert.ok(!isHistoryFile("Direct Messages/Chat History.txt"));
assert.ok(!isHistoryFile("Watch History.json"));
assert.ok(isHistoryFile("TikTok/Your Activity/Watch History.txt"));
assert.ok(!isHistoryFile("TikTok/Your Activity/Drama Watch History.txt"));
assert.ok(!isHistoryFile("TikTok/Your Activity/Searches.txt"));
assert.ok(!isHistoryFile("TikTok/Your Activity/Share History.txt"));
assert.ok(!isHistoryFile("TikTok/Your Activity/Login History.txt"));

console.log("All tests passed.\n" + csv);
