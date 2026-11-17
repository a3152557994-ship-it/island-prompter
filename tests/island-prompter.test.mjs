import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PUBLIC_SPKI_BASE64,
  PRODUCT_SLUG,
  PRICE_CNY,
  FREE_CHAR_LIMIT,
  ISLAND_GOLDEN_ZONE_PX,
  normalizeSpokenText,
  computeIslandZoneLayout,
  computeGazeLockScrollY,
  segmentScript,
  estimateScriptDuration,
  computeFuzzySimilarity,
  alignSpeechTranscript,
  createVoiceFollower,
  checkPrompterAccess,
  verifyLicenseToken,
} from "../src/prompter-engine.mjs";
import * as docsEngine from "../docs/prompter-engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function toBase64Url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function signToken(payloadObj, privateKey) {
  const payloadB64 = toBase64Url(Buffer.from(JSON.stringify(payloadObj), "utf8"));
  const sig = crypto.sign(null, Buffer.from(`OPC1.${payloadB64}`, "utf8"), privateKey);
  return `OPC1.${payloadB64}.${toBase64Url(sig)}`;
}

test("src/prompter-engine.mjs and docs/prompter-engine.js stay byte-identical", () => {
  const srcBytes = fs.readFileSync(path.join(ROOT, "src", "prompter-engine.mjs"), "utf8");
  const docsBytes = fs.readFileSync(path.join(ROOT, "docs", "prompter-engine.js"), "utf8");
  assert.equal(srcBytes, docsBytes);
  assert.equal(docsEngine.PUBLIC_SPKI_BASE64, PUBLIC_SPKI_BASE64);
  assert.equal(PRODUCT_SLUG, "island-prompter");
  assert.equal(PRICE_CNY, 12);
  assert.equal(FREE_CHAR_LIMIT, 300);
  assert.equal(ISLAND_GOLDEN_ZONE_PX, 60);
});

test("Top 60px Dynamic Island gaze-lock layout & scroll anchor math keep active line pinned", () => {
  const layout = computeIslandZoneLayout(393, 852, { safeTopInsetPx: 12, lineHeightPx: 46 });
  assert.equal(layout.goldenZoneHeightPx, 60);
  assert.equal(layout.goldenZoneTopPx, 20);
  assert.equal(layout.goldenZoneBottomPx, 80);
  assert.equal(layout.goldenZoneCenterY, 50);

  const yLine0 = computeGazeLockScrollY(0, 0, layout);
  const yLine3 = computeGazeLockScrollY(3, 0, layout);
  assert.ok(yLine3 < yLine0, "Advancing lines must translate track upward into the fixed 60px top zone");
  assert.equal(yLine0 - yLine3, 3 * 46);
});

test("Script clause segmentation, stage cues, and broadcast duration estimator are accurate", () => {
  const script = `大家好，欢迎来到今天的数码实测频道！
[微笑看镜头]
只要把高亮行锁死在顶部灵动岛下方60像素黄金区，拍4K视频就能自然直视镜头。`;

  const seg = segmentScript(script, { maxCharsPerLine: 16 });
  assert.ok(seg.lines.length >= 4);
  const cueLine = seg.lines.find((l) => l.isCueOnly);
  assert.ok(cueLine, "Expected [微笑看镜头] to be recognized as non-spoken cue pill");
  assert.equal(cueLine.spokenCount, 0);

  for (const ln of seg.lines.filter((l) => !l.isCueOnly)) {
    assert.ok(ln.text.length <= 18, `Expected narrow eye-span line <=18 chars, got "${ln.text}" (${ln.text.length})`);
  }

  const metricsSlow = estimateScriptDuration(script, { charsPerMinute: 185 });
  const metricsFast = estimateScriptDuration(script, { charsPerMinute: 285 });
  assert.ok(metricsSlow.spokenUnits > 35 && metricsSlow.spokenUnits <= 300);
  assert.equal(metricsSlow.isWithinFreeLimit, true);
  assert.ok(metricsSlow.totalSeconds > metricsFast.totalSeconds);
  assert.match(metricsSlow.formattedDuration, /^\d{2}:\d{2}$/);
});

test("Voice-follow fuzzy alignment handles normal speech, homophones, pause-hold, and jump-reading", () => {
  const script = [
    "大家好，欢迎来到口播提词实测。",
    "很多博主拍视频最大的痛点就是眼神飘忽不定。",
    "其实只要把字幕锁死在灵动岛下方60像素黄金区，",
    "再打开跨软件画中画悬浮窗，就能一条过！",
  ].join("\n");

  const follower = createVoiceFollower(script, { maxCharsPerLine: 16 });

  // 1. Progressive speech with homophone typo ("题词" instead of "提词")
  const step1 = follower.feedTranscript("大家好欢迎来到口播题词实测");
  assert.equal(step1.matched, true);
  assert.equal(step1.moved, true);
  assert.ok(step1.confidence >= 0.85);
  const cursorAfterLine1 = step1.cursor;
  assert.ok(cursorAfterLine1 >= 11);

  // 2. Pause-hold: empty transcript or repeated transcript holds exact cursor without drifting
  const pause1 = follower.feedTranscript("");
  assert.equal(pause1.moved, false);
  assert.equal(pause1.cursor, cursorAfterLine1);
  assert.equal(pause1.reason, "PAUSE_HOLD");

  const pause2 = follower.feedTranscript("大家好欢迎来到口播题词实测");
  assert.equal(pause2.moved, false);
  assert.equal(pause2.cursor, cursorAfterLine1);

  // 3. Homophone + Arabic/Chinese number equivalence ("灵动到下方六十像素" vs "灵动岛下方60像素")
  assert.equal(normalizeSpokenText("60像素"), "六十像素");
  assert.ok(computeFuzzySimilarity(normalizeSpokenText("灵动到下方60像素"), normalizeSpokenText("灵动岛下方六十像素")) > 0.9);

  // 4. Jump-reading (skipping sentence 2 completely and reading sentence 3!)
  const jumpRes = follower.feedTranscript("大家好欢迎来到口播题词实测其实只要把字幕锁死在灵动到下方60像素");
  assert.equal(jumpRes.matched, true);
  assert.equal(jumpRes.moved, true);
  assert.equal(jumpRes.jumped, true);
  assert.equal(jumpRes.reason, "JUMP_ALIGNED");
  assert.ok(jumpRes.cursor > cursorAfterLine1 + 25, `Expected jump cursor > ${cursorAfterLine1 + 25}, got ${jumpRes.cursor}`);

  // 5. Finish final line
  const endRes = follower.feedTranscript("再打开跨软件画中画悬浮窗就能一条过");
  assert.equal(endRes.matched, true);
  assert.equal(endRes.progressRatio, 1);

  // Direct stateless check
  const direct = alignSpeechTranscript(follower.segmented, 0, "欢迎来到口播提词");
  assert.equal(direct.matched, true);
  assert.ok(direct.cursor >= 8);
});

test("Funnel gate (300 chars free / PiP + unlimited Pro) & Ed25519 OPC1 verification pass 100%", async () => {
  assert.equal(checkPrompterAccess({ spokenUnits: 299, mode: "island", isPro: false }).allowed, true);
  assert.equal(checkPrompterAccess({ spokenUnits: 300, mode: "island", isPro: false }).allowed, true);
  assert.equal(checkPrompterAccess({ spokenUnits: 301, mode: "island", isPro: false }).allowed, false);
  assert.equal(checkPrompterAccess({ spokenUnits: 120, mode: "pip", isPro: false }).allowed, false);
  assert.equal(checkPrompterAccess({ spokenUnits: 1500, mode: "pip", isPro: true }).allowed, true);

  // Validate production SPKI key
  const prodDer = Buffer.from(PUBLIC_SPKI_BASE64, "base64");
  const prodKey = await globalThis.crypto.subtle.importKey("spki", prodDer, { name: "Ed25519" }, false, ["verify"]);
  assert.equal(prodKey.algorithm.name, "Ed25519");

  const badProd = await verifyLicenseToken("OPC1.eyJ2IjoxLCJwIjoiaXNsYW5kLXByb21wdGVyIn0.AAAA");
  assert.equal(badProd.valid, false);
  assert.equal(badProd.reason, "BAD_SIGNATURE");

  // Ephemeral Ed25519 roundtrip
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const testSpkiB64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const nowSec = Math.floor(Date.now() / 1000);

  const validTok = signToken({ v: 1, p: "island-prompter", e: "creator@qq.com", plan: "lifetime", iat: nowSec, exp: 0 }, privateKey);
  const wildcardTok = signToken({ v: 1, p: "*", e: "vip@qq.com", plan: "all", iat: nowSec, exp: 0 }, privateKey);
  const wrongProdTok = signToken({ v: 1, p: "paper-clean", e: "u@qq.com", plan: "pro", iat: nowSec, exp: 0 }, privateKey);
  const expiredTok = signToken({ v: 1, p: "island-prompter", e: "u@qq.com", plan: "pro", iat: nowSec - 600, exp: nowSec - 5 }, privateKey);

  const v1 = await verifyLicenseToken(validTok, { publicSpkiBase64: testSpkiB64, nowSec });
  assert.equal(v1.valid, true);
  assert.equal(v1.payload.p, "island-prompter");

  const v2 = await verifyLicenseToken(wildcardTok, { publicSpkiBase64: testSpkiB64, nowSec });
  assert.equal(v2.valid, true);

  const v3 = await verifyLicenseToken(wrongProdTok, { publicSpkiBase64: testSpkiB64, nowSec });
  assert.equal(v3.valid, false);
  assert.equal(v3.reason, "PRODUCT_MISMATCH");

  const v4 = await verifyLicenseToken(expiredTok, { publicSpkiBase64: testSpkiB64, nowSec });
  assert.equal(v4.valid, false);
  assert.equal(v4.reason, "EXPIRED");
});

test("PWA & GEO/SEO files exist and contain zero leaked local paths or private keys", () => {
  const requiredDocs = ["index.html", "style.css", "app.js", "prompter-engine.js", "manifest.webmanifest", "sw.js", "llms.txt", "robots.txt", "sitemap.xml"];
  for (const f of requiredDocs) {
    assert.equal(fs.existsSync(path.join(ROOT, "docs", f)), true, `Missing docs/${f}`);
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "manifest.webmanifest"), "utf8"));
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons.length >= 2);

  const allFiles = [
    path.join(ROOT, "README.md"),
    path.join(ROOT, "package.json"),
    path.join(ROOT, "src", "prompter-engine.mjs"),
    ...requiredDocs.map((f) => path.join(ROOT, "docs", f)),
  ];
  for (const fp of allFiles) {
    const content = fs.readFileSync(fp, "utf8");
    assert.equal(/\/Users\/[A-Za-z0-9_-]+/.test(content), false, `Forbidden local path leaked in ${fp}`);
    assert.equal(content.includes(["BEGIN", "PRIVATE", "KEY"].join(" ")), false, `Private key leaked in ${fp}`);
  }
});
