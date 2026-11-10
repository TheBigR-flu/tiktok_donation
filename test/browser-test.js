// End-to-end browser test of the donation page.
// Run: node test/browser-test.js   (needs: npm i playwright jszip)
// Sends to Google are intercepted and run through the real receiver code (apps-script/Code.gs).
const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const vm = require("vm");
const JSZip = require(process.env.JSZIP || "jszip");

const SITE = path.resolve(__dirname, "..");
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "donation-test-"));
const sample = path.join(SITE, "test/sample_tiktok.json");
const results = [];
const check = (name, ok, extra = "") => results.push((ok ? "PASS " : "FAIL ") + name + (extra ? " — " + extra : ""));

const RAFFLE = "https://example.qualtrics.com/jfe/form/SV_test";
// Load the real receiver validation.
const gsSrc = fs.readFileSync(path.join(SITE, "apps-script/Code.gs"), "utf8");
function loadGs(open) {
  const m = { exports: {} };
  vm.runInNewContext(gsSrc.replace("const COLLECTION_OPEN = false;", "const COLLECTION_OPEN = " + open + ";")
    .replace('"PASTE_RAFFLE_LINK_HERE"', JSON.stringify(RAFFLE)).replace('"PASTE_RAFFLE_KEY_HERE"', '"testkey123"'), { module: m });
  return m.exports;
}
const gsOpen = loadGs(true), gsClosed = loadGs(false);

const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/" || urlPath === "/closed.html") {
    let html = fs.readFileSync(path.join(SITE, "index.html"), "utf8");
    if (urlPath === "/") html = html.replace("const COLLECTION_OPEN = false;", "const COLLECTION_OPEN = true;");
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(html);
  }
  const p = path.join(SITE, urlPath);
  if (!p.startsWith(SITE) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": types[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
});

// mode: "ok" | "fail-once" | "fail-always"
async function mockReceiver(page, state) {
  await page.route("https://script.google.com/**", async (route) => {
    const req = route.request();
    state.calls++;
    state.contentTypes.push(req.headers()["content-type"]);
    if (state.mode === "fail-always" || (state.mode === "fail-once" && state.calls === 1) ||
        (state.mode === "fail-part3" && JSON.parse(req.postData()).part === 3)) {
      return route.fulfill({ status: 500, body: "error" });
    }
    let out;
    try {
      const gs = state.closed ? gsClosed : gsOpen;
      const clean = gs.validate(JSON.parse(req.postData()));
      state.files.push(gs.toCSV(clean));
      out = gs.savedReply(clean);
      state.replies.push(out);
    } catch (e) { out = { ok: false, error: e.message }; }
    route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(out) });
  });
}

(async () => {
  await new Promise((r) => server.listen(8765, r));
  check("shipped page starts closed", fs.readFileSync(path.join(SITE, "index.html"), "utf8").includes("const COLLECTION_OPEN = false;"));
  check("no [email] placeholder left", !fs.readFileSync(path.join(SITE, "index.html"), "utf8").includes("[email]"));
  const zipPath = path.join(OUT, "sample.zip");
  const z = new JSZip(); z.file("TikTok_Data/user_data_tiktok.json", fs.readFileSync(sample));
  fs.writeFileSync(zipPath, await z.generateAsync({ type: "nodebuffer" }));
  const big = { Activity: { "Video Browsing History": { VideoList: Array.from({ length: 200000 }, (_, i) => ({ Date: "2026-01-01 00:00:00", Link: "https://www.tiktokv.com/share/video/" + (7000000000000000000n + BigInt(i)) + "/" })) } } };
  const bigPath = path.join(OUT, "big.json"); fs.writeFileSync(bigPath, JSON.stringify(big));
  // TXT export: watch history + a DM file that shares a video link (must be ignored) + search history.
  const txtSample = fs.readFileSync(path.join(SITE, "test/sample_watch_history.txt"));
  const tz = new JSZip();
  tz.file("TikTok_Data/Activity/Watch History.txt", txtSample);
  tz.file("TikTok_Data/Direct Messages/Chat History.txt", "Date: 2026-10-05 10:00:00\nFrom: friend\nMessage: private message\nLink: https://www.tiktokv.com/share/video/7999999999999999999/\n");
  tz.file("TikTok_Data/Activity/Search History.txt", "Date: 2026-10-05 10:00:00\nSearch Term: should_not_appear\n");
  const txtZipPath = path.join(OUT, "txt_export.zip");
  fs.writeFileSync(txtZipPath, await tz.generateAsync({ type: "nodebuffer" }));
  const txtSingle = path.join(OUT, "Watch History.txt"); fs.writeFileSync(txtSingle, txtSample);
  const txtWrong = path.join(OUT, "Chat History.txt"); fs.writeFileSync(txtWrong, "Link: https://www.tiktokv.com/share/video/7999999999999999999/\n");
  const badPath = path.join(OUT, "bad.json"); fs.writeFileSync(badPath, "{not json");
  const emptyPath = path.join(OUT, "empty.json"); fs.writeFileSync(emptyPath, '{"Profile":{}}');

  const browser = await chromium.launch();
  for (const vp of [{ name: "desktop", w: 1200, h: 900 }, { name: "phone", w: 390, h: 844 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
    const page = await ctx.newPage();
    const errors = [], external = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
    page.on("request", (r) => { if (!/^(http:\/\/localhost:8765|blob:|data:|https:\/\/script\.google\.com|https:\/\/example\.qualtrics\.com)/.test(r.url())) external.push(r.url()); });
    const state = { mode: "ok", calls: 0, files: [], contentTypes: [], replies: [], closed: false };
    await mockReceiver(page, state);
    await page.route("https://example.qualtrics.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<title>raffle</title>raffle" }));
    if (vp.name === "desktop") {
      const html = fs.readFileSync(path.join(SITE, "index.html"), "utf8");
      check("raffle link is not in the public page code", !/qualtrics\.com/i.test(html));
      check("Send button says it goes to the raffle", /Send and go to the raffle/.test(html) && /go straight to the raffle/.test(html));
    }

    // 1. Happy path: ID from link, JSON file, send without reviewing.
    await page.goto("http://localhost:8765/?rid=R_7nvWYtkNlm2RBF4&sid=28292");
    check(vp.name + ": study ID shown from link", (await page.textContent("#sid-display")) === "28292");
    check(vp.name + ": send step hidden before file", !(await page.isVisible("#step-send")));
    await page.setInputFiles("#file", sample);
    await page.waitForSelector("#step-send:not(.hidden)");
    check(vp.name + ": JSON → 3 videos ready", (await page.textContent("#count")) === "3");
    check(vp.name + ": review list closed by default", !(await page.isVisible("#review")));
    check(vp.name + ": no network before Send", state.calls === 0);
    await page.click("#send");
    await page.waitForSelector("#done:not(.hidden)");
    check(vp.name + ": one request sent", state.calls === 1);
    check(vp.name + ": sent as text/plain (no CORS preflight)", state.contentTypes[0].startsWith("text/plain"));
    const f = state.files[0] || "";
    check(vp.name + ": receiver saved 3 rows with sid and rid", f.trim().split("\n").length === 4 && f.includes("R_7nvWYtkNlm2RBF4,28292,"));
    check(vp.name + ": no private data sent", !/should_not_appear|private message|7000000000000000001/.test(f));
    check(vp.name + ": earlier steps hidden after send", !(await page.isVisible("#step-select")));
    const raffleHref = await page.getAttribute("#raffle-link", "href");
    check(vp.name + ": raffle link came from receiver, key only, no IDs", raffleHref === RAFFLE + "?k=testkey123", raffleHref);
    check(vp.name + ": raffle button shown with no fallback warning", (await page.isVisible("#raffle-link")) && !(await page.isVisible("#raffle-missing")));
    await page.screenshot({ path: path.join(OUT, vp.name + "_done.png"), fullPage: true });
    await page.waitForURL(/qualtrics\.com/, { timeout: 5000 }).catch(() => {});
    check(vp.name + ": automatically taken to the raffle after Send", page.url() === RAFFLE + "?k=testkey123", page.url());

    // 2. Review and remove a row, then send.
    state.files = []; state.calls = 0;
    await page.goto("http://localhost:8765/?rid=R_7nvWYtkNlm2RBF4&sid=28292");
    await page.setInputFiles("#file", sample);
    await page.waitForSelector("#step-send:not(.hidden)");
    await page.click("#toggle-review");
    check(vp.name + ": review list opens", await page.isVisible("#review"));
    await page.click("#rows tr:nth-child(1)");
    check(vp.name + ": count drops after removal", (await page.textContent("#count")) === "2");
    await page.screenshot({ path: path.join(OUT, vp.name + "_review.png"), fullPage: true });
    await page.click("#send");
    await page.waitForSelector("#done:not(.hidden)");
    check(vp.name + ": removed row not sent", !state.files[0].includes("7234567890123456700") && state.files[0].trim().split("\n").length === 3);

    // 3. ZIP file, manual ID, bad rid ignored.
    state.files = []; state.calls = 0;
    await page.goto("http://localhost:8765/?rid=<script>");
    check(vp.name + ": manual ID box when no sid", await page.isVisible("#sid-input"));
    await page.setInputFiles("#file", zipPath);
    await page.waitForSelector("#step-send:not(.hidden)");
    check(vp.name + ": ZIP → 3 videos", (await page.textContent("#count")) === "3");
    check(vp.name + ": send blocked without ID", await page.isDisabled("#send"));
    await page.fill("#sid-input", "12-345");
    check(vp.name + ": ID box keeps digits", (await page.inputValue("#sid-input")) === "12345");
    await page.click("#send");
    await page.waitForSelector("#done:not(.hidden)");
    check(vp.name + ": bad rid dropped, sid kept", state.files[0].includes(",12345,") && !state.files[0].includes("script"));

    // 3b. TXT export: zip and single file, DMs and searches never sent.
    for (const [label, file] of [["TXT zip", txtZipPath], ["single TXT", txtSingle]]) {
      Object.assign(state, { calls: 0, files: [] });
      await page.goto("http://localhost:8765/?sid=28292");
      await page.setInputFiles("#file", file);
      await page.waitForSelector("#step-send:not(.hidden)");
      check(vp.name + ": " + label + " → 3 videos", (await page.textContent("#count")) === "3");
      await page.click("#send");
      await page.waitForSelector("#done:not(.hidden)");
      const sent = state.files[0] || "";
      check(vp.name + ": " + label + " sends same rows as JSON", sent.includes("7234567890123456789") && sent.includes("7300000000000000002") && sent.trim().split("\n").length === 4);
      check(vp.name + ": " + label + " never sends DM link or search", !/7999999999999999999|should_not_appear|private message/.test(sent));
    }
    await page.goto("http://localhost:8765/?sid=28292");
    await page.setInputFiles("#file", txtWrong);
    await page.waitForFunction(() => document.querySelector("#status").textContent.includes("isn't your watch history"));
    check(vp.name + ": non-history .txt rejected", !(await page.isVisible("#step-send")));

    // 4. Network fails once → automatic retry succeeds.
    Object.assign(state, { mode: "fail-once", calls: 0, files: [] });
    await page.goto("http://localhost:8765/?sid=28292");
    await page.setInputFiles("#file", sample);
    await page.waitForSelector("#step-send:not(.hidden)");
    await page.click("#send");
    await page.waitForSelector("#done:not(.hidden)", { timeout: 15000 });
    check(vp.name + ": retries after one failure", state.calls === 2 && state.files.length === 1);

    // 5. Server down → clear error, Send re-enabled, file stays local.
    Object.assign(state, { mode: "fail-always", calls: 0, files: [] });
    await page.goto("http://localhost:8765/?sid=28292");
    await page.setInputFiles("#file", sample);
    await page.waitForSelector("#step-send:not(.hidden)");
    await page.click("#send");
    await page.waitForFunction(() => document.querySelector("#send-note").textContent.startsWith("Sending didn't work"), null, { timeout: 20000 });
    check(vp.name + ": failure shows message and gives up after 3 tries", state.calls === 3);
    check(vp.name + ": failed send → no raffle link anywhere on page", !(await page.isVisible("#done")) && !(await page.getAttribute("#raffle-link", "href")));
    check(vp.name + ": Send re-enabled after failure", !(await page.isDisabled("#send")));
    state.mode = "ok";
    await page.click("#send");
    await page.waitForSelector("#done:not(.hidden)");
    check(vp.name + ": manual resend works", state.files.length === 1);

    // 6. Heavy user: 200,000 videos, sent in chunks.
    Object.assign(state, { mode: "ok", calls: 0, files: [], replies: [] });
    await page.goto("http://localhost:8765/?rid=R_7nvWYtkNlm2RBF4&sid=55555");
    let t0 = Date.now();
    await page.setInputFiles("#file", bigPath);
    await page.waitForSelector("#step-send:not(.hidden)", { timeout: 60000 });
    check(vp.name + ": 200k videos ready", (await page.textContent("#count")) === "200,000", (Date.now() - t0) + " ms");
    t0 = Date.now();
    await page.click("#send");
    await page.waitForSelector("#done:not(.hidden)", { timeout: 60000 });
    const saved = state.files.reduce((n, csv) => n + csv.trim().split("\n").length - 1, 0);
    check(vp.name + ": 200k sent in 4 chunks, nothing lost", state.calls === 4 && saved === 200000, state.calls + " requests, " + saved + " rows, " + (Date.now() - t0) + " ms");
    // 6a. Part 3 of 4 keeps failing, student taps Send again → resumes at part 3, nothing saved twice.
    Object.assign(state, { mode: "fail-part3", calls: 0, files: [], replies: [] });
    await page.goto("http://localhost:8765/?rid=R_7nvWYtkNlm2RBF4&sid=55555");
    await page.setInputFiles("#file", bigPath);
    await page.waitForSelector("#step-send:not(.hidden)", { timeout: 60000 });
    await page.click("#send");
    await page.waitForFunction(() => document.querySelector("#send-note").textContent.startsWith("Sending didn't work"), null, { timeout: 30000 });
    check(vp.name + ": partial failure → no raffle yet", !(await page.isVisible("#done")) && state.files.length === 2);
    state.mode = "ok";
    await page.click("#send");
    await page.waitForSelector("#done:not(.hidden)", { timeout: 60000 });
    const partRows = state.files.reduce((n, csv) => n + csv.trim().split("\n").length - 1, 0);
    check(vp.name + ": resend continues from failed part, nothing saved twice", state.files.length === 4 && partRows === 200000, state.files.length + " files, " + partRows + " rows");
    check(vp.name + ": only the last chunk's reply carries the raffle link", state.replies.map((r) => !!r.raffle).join() === "false,false,false,true");

    // 6b. Closed mode (as shipped): real IDs blocked, test IDs work, receiver also refuses.
    Object.assign(state, { mode: "ok", calls: 0, files: [], closed: true });
    await page.goto("http://localhost:8765/closed.html?sid=28292");
    check(vp.name + ": closed banner shown", await page.isVisible("#closed-banner"));
    await page.setInputFiles("#file", sample);
    await page.waitForSelector("#step-send:not(.hidden)");
    check(vp.name + ": real ID blocked while closed", (await page.isDisabled("#send")) && (await page.textContent("#send-note")).includes("isn't open yet"));
    await page.screenshot({ path: path.join(OUT, vp.name + "_closed.png"), fullPage: true });
    check(vp.name + ": nothing sent while closed", state.calls === 0);
    await page.goto("http://localhost:8765/closed.html?sid=00042");
    await page.setInputFiles("#file", sample);
    await page.waitForSelector("#step-send:not(.hidden)");
    await page.click("#send");
    await page.waitForSelector("#done:not(.hidden)");
    check(vp.name + ": test ID 00042 sends while closed", state.files.length === 1 && state.files[0].includes(",00042,"));
    const direct = await page.evaluate(async () => (await (await fetch("https://script.google.com/macros/s/X/exec", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ sid: "28292", rid: "", part: 1, parts: 1, rows: [["7234567890123456789", "2026-10-02 20:15:03"]] }) })).json()));
    check(vp.name + ": receiver refuses real ID while closed", direct.ok === false && /not open/.test(direct.error));
    state.closed = false;
    await page.goto("http://localhost:8765/?sid=28292");
    check(vp.name + ": no banner when open", !(await page.isVisible("#closed-banner")));

    // 7. Bad and empty files.
    await page.goto("http://localhost:8765/?sid=28292");
    await page.setInputFiles("#file", badPath);
    await page.waitForFunction(() => document.querySelector("#status").textContent.startsWith("Couldn't"));
    check(vp.name + ": bad file shows error", true);
    await page.setInputFiles("#file", emptyPath);
    await page.waitForFunction(() => document.querySelector("#status").textContent.startsWith("No watch history"));
    check(vp.name + ": no-history file shows message", !(await page.isVisible("#step-send")));

    // 8. Layout, errors, network.
    check(vp.name + ": no horizontal scroll", !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
    check(vp.name + ": no JS errors", errors.length === 0, errors.join("; "));
    check(vp.name + ": only Google receiver contacted", external.length === 0, external.join(", "));
    await ctx.close();
  }
  await browser.close(); server.close();
  console.log(results.join("\n"));
  process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
