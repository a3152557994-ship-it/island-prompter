/**
 * IslandPrompter (灵动提词) — Dual-Runtime Gaze-Lock Layout, Fuzzy Local Voice-Follow Alignment,
 * Spoken Duration Estimator & Offline Ed25519 License Engine.
 * Works identically in Node.js (ESM) and modern browsers (<script type="module">) with zero dependencies.
 */

export const PUBLIC_SPKI_BASE64 = "MCowBQYDK2VwAyEAP5NCVP7CT0tgaGLSGMe4r87SjYRWTM6gN6igBZYSXys=";
export const PRODUCT_SLUG = "island-prompter";
export const PRICE_CNY = 12;
export const COMPETITOR_MONTHLY_CNY = 39;
export const FREE_CHAR_LIMIT = 300;
export const ISLAND_GOLDEN_ZONE_PX = 60;
export const ORDER_EMAIL_QQ = "3152557994@qq.com";
export const ORDER_EMAIL_GMAIL = "a3152557994@gmail.com";

export const PACE_PRESETS = {
  calm: { id: "calm", label: "娓娓道来 / 知识科普", cpm: 185 },
  standard: { id: "standard", label: "短视频标准口播", cpm: 230 },
  live: { id: "live", label: "快节奏直播带货", cpm: 285 },
};

const DIGIT_TO_CN = {
  "0": "零",
  "1": "一",
  "2": "二",
  "3": "三",
  "4": "四",
  "5": "五",
  "6": "六",
  "7": "七",
  "8": "八",
  "9": "九",
};

// High-frequency Mandarin ASR homophone / near-sound equivalence buckets for resilient local matching
const HOMOPHONE_GROUPS = [
  "的得地",
  "在再载",
  "做作坐座",
  "他她它塌",
  "那呐纳哪",
  "题提啼",
  "词辞磁瓷",
  "器气汽弃契",
  "岛到倒导蹈",
  "视事市式试室识是世",
  "频平评屏瓶凭",
  "播波拨玻",
  "流留刘浏览",
  "直值职植殖",
  "镜境静敬径竟劲",
  "头投途",
  "眼演掩衍",
  "神身深伸",
  "飘漂票瓢",
  "买迈卖麦脉",
  "断段锻缎",
  "月阅跃悦越粤",
  "费废肺沸",
  "元员圆园源缘原",
  "零灵铃凌玲龄",
  "动洞冻栋",
  "悬玄旋选",
  "浮服幅福符扶",
  "窗床创闯",
  "画话化划华",
  "中忠钟终衷",
  "一壹",
  "二两贰",
];

const HOMOPHONE_MAP = new Map();
for (const group of HOMOPHONE_GROUPS) {
  const canonical = group[0];
  for (const ch of group) {
    HOMOPHONE_MAP.set(ch, canonical);
  }
}

/**
 * Normalize small Arabic integers (e.g. "60" -> "六十", "12" -> "十二", "39" -> "三十九")
 * and individual digits so spoken ASR numerals match written digits seamlessly.
 */
export function normalizeSpokenText(rawText) {
  if (!rawText) return "";
  const strippedCues = String(rawText)
    .replace(/\[[^\]]{1,16}\]/g, " ")
    .replace(/【[^】]{1,16}】/g, " ");

  const expandedNums = strippedCues.replace(/\d+/g, (numStr) => {
    if (numStr.length === 2) {
      const tens = Number(numStr[0]);
      const ones = Number(numStr[1]);
      if (tens >= 1 && tens <= 9) {
        const tensPart = tens === 1 ? "十" : `${DIGIT_TO_CN[String(tens)]}十`;
        const onesPart = ones === 0 ? "" : DIGIT_TO_CN[String(ones)];
        return tensPart + onesPart;
      }
    }
    let out = "";
    for (const ch of numStr) {
      out += DIGIT_TO_CN[ch] || ch;
    }
    return out;
  });

  let clean = "";
  for (const ch of expandedNums.toLowerCase()) {
    if (/[\u4e00-\u9fff]/.test(ch) || /[a-z0-9]/.test(ch)) {
      clean += ch;
    }
  }
  return clean;
}

function phoneticKey(ch) {
  return HOMOPHONE_MAP.get(ch) || ch;
}

/**
 * Compute top-edge Dynamic Island / Front-Camera gaze-lock geometry.
 * Ensures the active highlighted line stays strictly inside the top 60px golden band
 * so the speaker's eyes stay within <2.5 degrees of the front camera lens.
 */
export function computeIslandZoneLayout(viewportWidth = 393, viewportHeight = 852, options = {}) {
  const safeTopInsetPx = Math.max(0, Number(options.safeTopInsetPx || 0));
  const goldenZoneHeightPx = ISLAND_GOLDEN_ZONE_PX; // Strictly 60px golden zone
  const goldenZoneTopPx = safeTopInsetPx + 8;
  const goldenZoneCenterY = goldenZoneTopPx + goldenZoneHeightPx / 2;
  const maxLineWidthPx = Math.min(500, Math.max(250, Math.round(viewportWidth * 0.86)));
  const lineHeightPx = Math.max(38, Math.min(54, Number(options.lineHeightPx || 46)));

  return {
    viewportWidth,
    viewportHeight,
    goldenZoneTopPx,
    goldenZoneHeightPx,
    goldenZoneBottomPx: goldenZoneTopPx + goldenZoneHeightPx,
    goldenZoneCenterY,
    maxLineWidthPx,
    lineHeightPx,
  };
}

/**
 * Compute vertical translate offset so `activeLineIndex + intraLineRatio` stays centered
 * inside the top 60px Dynamic Island golden eye-contact zone.
 */
export function computeGazeLockScrollY(activeLineIndex, intraLineRatio = 0, layout = computeIslandZoneLayout()) {
  const idx = Math.max(0, Number(activeLineIndex) || 0);
  const ratio = Math.max(0, Math.min(1, Number(intraLineRatio) || 0));
  const currentLineCenter = (idx + 0.5 + ratio * 0.35) * layout.lineHeightPx;
  return Math.round((layout.goldenZoneCenterY - currentLineCenter) * 10) / 10;
}

/**
 * Segment raw teleprompter script into narrow eye-span lines (preventing horizontal eye-sweep)
 * and build a character-indexed spoken stream for real-time speech alignment.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {number} [options.maxCharsPerLine=16]
 */
export function segmentScript(text, options = {}) {
  const maxCharsPerLine = Math.max(8, Math.min(36, Number(options.maxCharsPerLine || 16)));
  const raw = String(text || "").replace(/\r\n/g, "\n").trim();

  if (!raw) {
    return { lines: [], spokenStream: [], totalSpokenChars: 0 };
  }

  // Split into paragraphs first, then break clauses cleanly within maxCharsPerLine
  const paragraphs = raw.split(/\n+/);
  const rawLines = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // Extract stage cue-only lines like [停顿2秒]
    if (/^(\[[^\]]+\]|【[^】]+】)$/.test(trimmed)) {
      rawLines.push({ text: trimmed, isCueOnly: true });
      continue;
    }

    // Split paragraph into natural punctuation clauses while keeping punctuation attached
    const clauses = trimmed.match(/[^。！？；，、：.!?;,]*(?:[。！？；，、：.!?;,]+|$)/g) || [trimmed];
    let buffer = "";

    const flushBuffer = () => {
      if (buffer.trim()) {
        rawLines.push({ text: buffer.trim(), isCueOnly: false });
      }
      buffer = "";
    };

    for (const clause of clauses) {
      if (!clause) continue;
      if ((buffer + clause).length <= maxCharsPerLine) {
        buffer += clause;
      } else {
        if (buffer) flushBuffer();
        if (clause.length <= maxCharsPerLine) {
          buffer = clause;
        } else {
          // Wrap long unpunctuated clause without splitting ASCII words mid-token
          const tokens = clause.match(/[A-Za-z0-9]+|[^A-Za-z0-9]/g) || [];
          let chunk = "";
          for (const tok of tokens) {
            if (chunk.length + tok.length > maxCharsPerLine && chunk.length > 0) {
              rawLines.push({ text: chunk.trim(), isCueOnly: false });
              chunk = tok;
            } else {
              chunk += tok;
            }
          }
          buffer = chunk;
        }
      }
    }
    flushBuffer();
  }

  // Index speakable characters across all lines
  const spokenStream = [];
  const lines = rawLines.map((item, lineIndex) => {
    const lineText = item.text;
    const startSpokenIndex = spokenStream.length;

    if (!item.isCueOnly) {
      let inBracketCue = false;
      for (let i = 0; i < lineText.length; i += 1) {
        const ch = lineText[i];
        if (ch === "[" || ch === "【") {
          inBracketCue = true;
          continue;
        }
        if (ch === "]" || ch === "】") {
          inBracketCue = false;
          continue;
        }
        if (inBracketCue) continue;

        // Expand digits consistently with normalizeSpokenText
        if (/\d/.test(ch)) {
          // Check if part of 2-digit number
          let numToken = ch;
          let j = i;
          while (j + 1 < lineText.length && /\d/.test(lineText[j + 1])) {
            j += 1;
            numToken += lineText[j];
          }
          const expanded = normalizeSpokenText(numToken);
          for (const nCh of expanded) {
            spokenStream.push({
              normChar: nCh,
              phonetic: phoneticKey(nCh),
              lineIndex,
              charOffsetInLine: j + 1,
            });
          }
          i = j;
        } else {
          const low = ch.toLowerCase();
          if (/[\u4e00-\u9fff]/.test(low) || /[a-z]/.test(low)) {
            spokenStream.push({
              normChar: low,
              phonetic: phoneticKey(low),
              lineIndex,
              charOffsetInLine: i + 1,
            });
          }
        }
      }
    }

    const endSpokenIndex = spokenStream.length;
    return {
      index: lineIndex,
      text: lineText,
      isCueOnly: item.isCueOnly,
      startSpokenIndex,
      endSpokenIndex,
      spokenCount: endSpokenIndex - startSpokenIndex,
    };
  });

  return {
    lines,
    spokenStream,
    totalSpokenChars: spokenStream.length,
  };
}

/**
 * Estimate speaking word/character metrics and broadcast duration.
 */
export function estimateScriptDuration(text, options = {}) {
  const charsPerMinute = Math.max(80, Math.min(450, Number(options.charsPerMinute || PACE_PRESETS.standard.cpm)));
  const majorPauseSec = Number(options.majorPauseSec ?? 0.42);
  const minorPauseSec = Number(options.minorPauseSec ?? 0.18);

  const raw = String(text || "")
    .replace(/\[[^\]]{1,16}\]/g, " ")
    .replace(/【[^】]{1,16}】/g, " ");

  const cjkChars = (raw.match(/[\u4e00-\u9fff]/g) || []).length;
  const englishWords = (raw.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || []).length;
  const numberTokens = (raw.match(/\d+(?:\.\d+)?/g) || []).length;
  const majorPauses = (raw.match(/[。！？；.!?;]+|\n+/g) || []).length;
  const minorPauses = (raw.match(/[，、：,:]+/g) || []).length;

  // 1 English word ~= 1.5 spoken CJK syllables in broadcast pacing
  const spokenUnits = cjkChars + Math.ceil(englishWords * 1.5) + numberTokens * 2;
  const speechSeconds = (spokenUnits / charsPerMinute) * 60;
  const pauseSeconds = majorPauses * majorPauseSec + minorPauses * minorPauseSec;
  const totalSeconds = spokenUnits === 0 ? 0 : Math.max(1, Math.round(speechSeconds + pauseSeconds));

  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  const formattedDuration = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

  return {
    cjkChars,
    englishWords,
    numberTokens,
    spokenUnits,
    charsPerMinute,
    totalSeconds,
    formattedDuration,
    isWithinFreeLimit: spokenUnits <= FREE_CHAR_LIMIT,
    freeLimitRemaining: Math.max(0, FREE_CHAR_LIMIT - spokenUnits),
  };
}

/**
 * Compute fuzzy similarity (0..1) between two short normalized strings using phonetic-aware DP edit distance.
 */
export function computeFuzzySimilarity(queryStr, candidateStr) {
  const n = queryStr.length;
  const m = candidateStr.length;
  if (n === 0 || m === 0) return 0;

  const dp = Array.from({ length: n + 1 }, () => new Float32Array(m + 1));
  for (let i = 0; i <= n; i += 1) dp[i][0] = i;
  for (let j = 0; j <= m; j += 1) dp[0][j] = j;

  for (let i = 1; i <= n; i += 1) {
    const qCh = queryStr[i - 1];
    const qPh = phoneticKey(qCh);
    for (let j = 1; j <= m; j += 1) {
      const cCh = candidateStr[j - 1];
      let subCost = 1;
      if (qCh === cCh) {
        subCost = 0;
      } else if (qPh === phoneticKey(cCh)) {
        // Near-zero penalty for Mandarin homophones (e.g. 提词器 vs 题词器, 灵动岛 vs 灵动到)
        subCost = 0.18;
      }
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + subCost
      );
    }
  }

  const dist = dp[n][m];
  return Math.max(0, 1 - dist / Math.max(n, m));
}

function resolveCursorPosition(segmented, cursor) {
  const total = segmented.totalSpokenChars;
  if (total === 0 || segmented.lines.length === 0) {
    return { cursor: 0, lineIndex: 0, charOffsetInLine: 0, progressRatio: 0 };
  }
  const clamped = Math.max(0, Math.min(total, cursor));
  if (clamped === 0) {
    return { cursor: 0, lineIndex: 0, charOffsetInLine: 0, progressRatio: 0 };
  }
  const token = segmented.spokenStream[clamped - 1];
  return {
    cursor: clamped,
    lineIndex: token.lineIndex,
    charOffsetInLine: token.charOffsetInLine,
    progressRatio: Math.round((clamped / total) * 1000) / 1000,
  };
}

/**
 * Core local SpeechRecognition fuzzy alignment engine:
 * - Pause-hold: empty/unchanged speech holds exact cursor (停顿即停)
 * - Homophone & ASR typo resilience: advances smoothly even with imperfect recognition
 * - Jump-read auto-snap: skipping 1–3 clauses forward automatically re-locks onto the new position (跳读对齐)
 *
 * @param {ReturnType<typeof segmentScript>} segmented
 * @param {number} currentCursor - current index in `[0..segmented.totalSpokenChars]`
 * @param {string} transcript - cumulative or incremental ASR transcript chunk
 * @param {object} [options]
 */
export function alignSpeechTranscript(segmented, currentCursor, transcript, options = {}) {
  const {
    lookbehind = 6,
    lookahead = 95,
    minLocalSimilarity = 0.62,
    minJumpSimilarity = 0.78,
  } = options;

  const total = segmented.totalSpokenChars;
  if (total === 0) {
    return { matched: false, moved: false, reason: "EMPTY_SCRIPT", ...resolveCursorPosition(segmented, 0), confidence: 0 };
  }

  const normSpoken = normalizeSpokenText(transcript);
  if (!normSpoken) {
    return {
      matched: false,
      moved: false,
      reason: "PAUSE_HOLD",
      ...resolveCursorPosition(segmented, currentCursor),
      confidence: 0,
    };
  }

  const streamChars = segmented.spokenStream.map((s) => s.normChar).join("");
  const startWin = Math.max(0, currentCursor - lookbehind);
  const endWin = Math.min(total, currentCursor + lookahead);

  // Build query tails: full recent tail (up to 8 chars) + agile jump-read suffix (up to 4 chars)
  const tailLengths = [];
  const primaryLen = Math.min(8, normSpoken.length);
  if (primaryLen >= 2) tailLengths.push(primaryLen);
  if (normSpoken.length >= 5 && primaryLen > 4) {
    tailLengths.push(4);
  }
  if (normSpoken.length === 1 && currentCursor < total) {
    tailLengths.push(1);
  }

  let bestCandidate = null;

  for (const qLen of tailLengths) {
    const query = normSpoken.slice(-qLen);
    const isShortJumpProbe = qLen <= 4 && primaryLen > 4;

    for (let pos = startWin; pos <= endWin - qLen; pos += 1) {
      const candidateEnd = pos + qLen;
      // Do not drift backwards behind currentCursor
      if (candidateEnd < currentCursor) continue;

      const cand = streamChars.slice(pos, candidateEnd);
      const sim = computeFuzzySimilarity(query, cand);
      const jumpDist = Math.max(0, pos - currentCursor);

      const requiredSim =
        qLen === 1
          ? 1.0
          : jumpDist > 16 || isShortJumpProbe
            ? Math.max(minJumpSimilarity, isShortJumpProbe ? 0.88 : minJumpSimilarity)
            : minLocalSimilarity;

      if (sim < requiredSim) continue;

      // Mild forward-continuity preference so nearby natural progression beats accidental distant echo
      const proximityBias = Math.max(0, 0.08 - jumpDist * 0.0012);
      const lengthBonus = qLen >= 6 ? 0.04 : 0;
      const score = sim + proximityBias + lengthBonus;

      if (!bestCandidate || score > bestCandidate.score) {
        bestCandidate = {
          cursor: candidateEnd,
          confidence: Math.round(sim * 1000) / 1000,
          score,
          jumpDist,
        };
      }
    }
  }

  if (!bestCandidate) {
    return {
      matched: false,
      moved: false,
      reason: "NO_CONFIDENT_MATCH",
      ...resolveCursorPosition(segmented, currentCursor),
      confidence: 0,
    };
  }

  const nextCursor = Math.max(currentCursor, bestCandidate.cursor);
  const resolved = resolveCursorPosition(segmented, nextCursor);
  return {
    matched: true,
    moved: nextCursor > currentCursor,
    jumped: bestCandidate.jumpDist > 16,
    reason: bestCandidate.jumpDist > 16 ? "JUMP_ALIGNED" : "VOICE_ADVANCED",
    ...resolved,
    confidence: bestCandidate.confidence,
  };
}

/**
 * Stateful helper wrapping `segmentScript` and `alignSpeechTranscript` for live teleprompter sessions.
 */
export function createVoiceFollower(scriptText, options = {}) {
  const segmented = segmentScript(scriptText, options);
  let cursor = 0;
  let lastTranscript = "";

  return {
    segmented,
    getState() {
      return resolveCursorPosition(segmented, cursor);
    },
    setCursor(nextCursor) {
      cursor = Math.max(0, Math.min(segmented.totalSpokenChars, Math.round(nextCursor)));
      return resolveCursorPosition(segmented, cursor);
    },
    reset() {
      cursor = 0;
      lastTranscript = "";
      return resolveCursorPosition(segmented, 0);
    },
    feedTranscript(transcript) {
      const clean = String(transcript || "");
      if (!clean.trim() || clean === lastTranscript) {
        return {
          matched: false,
          moved: false,
          reason: "PAUSE_HOLD",
          ...resolveCursorPosition(segmented, cursor),
          confidence: 0,
        };
      }
      lastTranscript = clean;
      const res = alignSpeechTranscript(segmented, cursor, clean, options);
      if (res.matched) {
        cursor = res.cursor;
      }
      return res;
    },
  };
}

/**
 * Conversion funnel gate:
 * - <= 300 spoken units in standard/island/voice/mirror web teleprompter: 100% FREE unlimited!
 * - > 300 spoken units (long livestream scripts) OR cross-app PiP floating window: ¥12 lifetime unlock.
 */
export function checkPrompterAccess({ spokenUnits = 0, mode = "island", isPro = false } = {}) {
  if (isPro) {
    return { allowed: true, tier: "pro", reason: null };
  }
  if (mode === "pip") {
    return {
      allowed: false,
      tier: "free",
      reason: "PIP_FLOATING_LOCKED",
      message: `真·跨软件画中画悬浮窗（直接悬浮在原相机/美颜相机/腾讯会议/视频号开播画面上方）需解锁 ¥${PRICE_CNY} 永久买断版`,
    };
  }
  if (spokenUnits > FREE_CHAR_LIMIT) {
    return {
      allowed: false,
      tier: "free",
      reason: "LONG_SCRIPT_LOCKED",
      message: `当前口播稿共 ${spokenUnits} 字（免费版支持 ${FREE_CHAR_LIMIT} 字以内无限次使用）。解锁无限字数长篇直播稿 + 真画中画悬浮窗仅需 ¥${PRICE_CNY} 永久买断（拒绝竞品 ¥${COMPETITOR_MONTHLY_CNY}/月割韭菜）！`,
    };
  }
  return { allowed: true, tier: "free", reason: null };
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function base64UrlToBytes(b64url) {
  const normalized = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (normalized.length % 4)) % 4;
  return base64ToBytes(normalized + "=".repeat(padLen));
}

/**
 * Verify an OPC1.<base64url_payload>.<base64url_sig> Ed25519 offline license token.
 * Signed message is `OPC1.${payloadB64}` in UTF-8.
 */
export async function verifyLicenseToken(token, options = {}) {
  const {
    expectedProduct = PRODUCT_SLUG,
    publicSpkiBase64 = PUBLIC_SPKI_BASE64,
    nowSec = Math.floor(Date.now() / 1000),
  } = options;

  if (typeof token !== "string" || !token.trim()) {
    return { valid: false, reason: "EMPTY_TOKEN", message: "请输入激活码" };
  }

  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts[0] !== "OPC1" || !parts[1] || !parts[2]) {
    return { valid: false, reason: "BAD_FORMAT", message: "激活码格式应为 OPC1.<payload>.<signature>" };
  }

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    return { valid: false, reason: "NO_WEBCRYPTO", message: "当前运行环境不支持 WebCrypto Ed25519" };
  }

  try {
    const [, payloadB64, sigB64] = parts;
    const spkiBytes = base64ToBytes(publicSpkiBase64);
    const sigBytes = base64UrlToBytes(sigB64);
    const signedBytes = new TextEncoder().encode(`OPC1.${payloadB64}`);

    const key = await subtle.importKey("spki", spkiBytes, { name: "Ed25519" }, false, ["verify"]);
    const verified = await subtle.verify("Ed25519", key, sigBytes, signedBytes);
    if (!verified) {
      return { valid: false, reason: "BAD_SIGNATURE", message: "激活码签名校验失败" };
    }

    const payloadJson = new TextDecoder().decode(base64UrlToBytes(payloadB64));
    const payload = JSON.parse(payloadJson);

    if (expectedProduct && payload.p !== expectedProduct && payload.p !== "*") {
      return {
        valid: false,
        reason: "PRODUCT_MISMATCH",
        message: `该激活码归属产品 "${payload.p}"，不适用于 "${expectedProduct}"`,
        payload,
      };
    }

    if (payload.exp && Number(payload.exp) > 0 && nowSec > Number(payload.exp)) {
      return {
        valid: false,
        reason: "EXPIRED",
        message: "该激活码已过期",
        payload,
      };
    }

    return { valid: true, payload };
  } catch (err) {
    return {
      valid: false,
      reason: "VERIFY_ERROR",
      message: err?.message || "激活码解析异常",
    };
  }
}
