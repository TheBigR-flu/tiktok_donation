// Run: node test/apps-script-test.js — checks the receiver's validation.
const assert = require("assert");
const fs = require("fs"), path = require("path"), vm = require("vm");
const src = fs.readFileSync(path.join(__dirname, "../apps-script/Code.gs"), "utf8");
function load(open) {
  const mod = { exports: {} };
  vm.runInNewContext(src.replace("const COLLECTION_OPEN = false;", "const COLLECTION_OPEN = " + open + ";"), { module: mod });
  return mod.exports;
}
assert.ok(src.includes("const COLLECTION_OPEN = false;"), "shipped receiver must start closed");
const closed = load(false);
assert.throws(() => closed.validate({ sid: "28292", rid: "", part: 1, parts: 1, rows: [["7234567890123456789", "2026-10-02 20:15:03"]] }), /not open/);
assert.doesNotThrow(() => closed.validate({ sid: "00042", rid: "", part: 1, parts: 1, rows: [["7234567890123456789", "2026-10-02 20:15:03"]] }));
const { validate, toCSV } = load(true);

const good = { sid: "28292", rid: "R_7nvWYtkNlm2RBF4", part: 1, parts: 1,
  rows: [["7234567890123456789", "2026-10-02 20:15:03"]] };
const c = validate(good);
assert.strictEqual(toCSV(c), "rid,sid,video_id,watched_at\nR_7nvWYtkNlm2RBF4,28292,7234567890123456789,2026-10-02 20:15:03\n");
assert.doesNotThrow(() => validate({ ...good, rid: "" }));

const bad = [
  { ...good, sid: "1234" }, { ...good, sid: "abcde" }, { ...good, rid: "<script>" },
  { ...good, part: 2 }, { ...good, parts: 51, part: 1 }, { ...good, rows: [] },
  { ...good, rows: [["not-an-id", "2026-10-02 20:15:03"]] },
  { ...good, rows: [["7234567890123456789", "=HYPERLINK(\"x\")"]] },
  null, "string",
];
// Mixed batch: bad rows skipped, good rows kept.
const mixed = validate({ ...good, rows: [["7234567890123456789", "2026-10-02 20:15:03"], ["x", "y"],
  ["7234567890123456780", "2026-10-02T20:15:03Z"], ["7234567890123456781", "2026-10-02 20:15:03 UTC"],
  ["7234567890123456782", "=cmd|' /C calc'!A0"], ["7234567890123456783", "2026-10-02 20:15:03", "extra"]] });
assert.strictEqual(mixed.rows.length, 3); assert.strictEqual(mixed.skipped, 3);
bad.forEach((b, i) => assert.throws(() => validate(b), "case " + i + " should be rejected"));
console.log("Receiver validation tests passed (" + bad.length + " bad inputs rejected).");
