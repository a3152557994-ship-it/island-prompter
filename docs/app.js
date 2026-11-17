import {
  PRODUCT_SLUG,
  PRICE_CNY,
  FREE_CHAR_LIMIT,
  ORDER_EMAIL_QQ,
  ORDER_EMAIL_GMAIL,
  computeIslandZoneLayout,
  computeGazeLockScrollY,
  estimateScriptDuration,
  createVoiceFollower,
  checkPrompterAccess,
  verifyLicenseToken,
} from "./prompter-engine.js";

const STORAGE_KEY = "opc_license_island_prompter_v1";

const SHORT_DEMO_SCRIPT = `大家好，拍口播视频最怕的就是眼神乱飘！
很多朋友把提词器铺满整个屏幕，念稿时眼珠子左右扫视，观众一眼就能看出你在念稿。
[微笑看镜头]
现在把高亮行锁死在顶部灵动岛下方60像素黄金区，再配合浏览器本地语音实时跟读：
你停顿思考，字幕就原地锁死；你临时跳读两句，字幕也能瞬间自动对齐！
不用每个月交39元月租，300字内完全免费，赶紧点下方按钮试试吧！`;

const LONG_LIVE_SCRIPT = `欢迎新进直播间的各位朋友！今天这场实测干货直播，我给大家准备了完整的三步口播起号心法，建议先点亮左上角关注防走失！
[停顿举起样机]
第一步，解决镜头恐惧与眼神飘忽。为什么大博主面对原相机侃侃而谈像在聊天，而新手一开机就像背课文？核心秘密就在视线夹角！只要把正在念的那一行字，严格卡在手机顶部前摄或者电脑刘海正下方60像素黄金带里，你的瞳孔和镜头夹角不到2.5度，拍出来百分百是自然真诚的眼神交流。
第二步，跨软件置顶提词。平时我们用系统原相机拍4K画质、用美颜相机调肤色、或者在微信视频号开直播、开腾讯会议汇报，切出浏览器就看不到词了怎么办？开启灵动提词的真画中画悬浮窗，无需安装任何臃肿客户端，直接把置顶提词条推到屏幕最顶端贴紧灵动岛，原相机4K录制和提词两不误！
[微笑互动]
第三步，告别每个月39元的自动续费刺客！市面同类提词软件一年下来要扣四百多块，而在灵动提词，一杯奶茶钱12元直接永久买断，无限字数长篇直播逐字稿加跨软件画中画悬浮窗终身畅用，本地离线运行绝不上传商业底稿！`;

const state = {
  isPro: false,
  licensePayload: null,
  licenseToken: "",
  cpm: 230,
  maxCharsPerLine: 16,
  speedMultiplier: 1.0,
  mirrorX: false,
  activeMode: "idle", // 'idle' | 'voice' | 'scroll' | 'sim'
  floatCursor: 0,
  follower: null,
  metrics: null,
  recognition: null,
  simTimer: null,
  pipStreamAttached: false,
};

const els = {
  proPill: document.getElementById("pro-pill"),
  scriptInput: document.getElementById("script-input"),
  btnSampleShort: document.getElementById("btn-sample-short"),
  btnSampleLong: document.getElementById("btn-sample-long"),

  tileCharCount: document.getElementById("tile-char-count"),
  valCharCount: document.getElementById("val-char-count"),
  lblCharQuota: document.getElementById("lbl-char-quota"),
  valDuration: document.getElementById("val-duration"),
  lblDurationRate: document.getElementById("lbl-duration-rate"),
  valLineCount: document.getElementById("val-line-count"),
  paceChips: Array.from(document.querySelectorAll(".pace-chip")),

  previewTrack: document.getElementById("preview-track"),
  fsOverlay: document.getElementById("fs-overlay"),
  fsTrack: document.getElementById("fs-track"),
  lblProgressPct: document.getElementById("lbl-progress-pct"),
  asrStatusText: document.getElementById("asr-status-text"),

  btnVoiceFollow: document.getElementById("btn-voice-follow"),
  btnAutoScroll: document.getElementById("btn-auto-scroll"),
  btnSimVoice: document.getElementById("btn-sim-voice"),
  btnEnterFs: document.getElementById("btn-enter-fs"),
  btnTopIslandFs: document.getElementById("btn-top-island-fs"),
  btnMirrorToggle: document.getElementById("btn-mirror-toggle"),
  btnResetCursor: document.getElementById("btn-reset-cursor"),

  btnHeroVoiceDemo: document.getElementById("btn-hero-voice-demo"),
  btnHeroPip: document.getElementById("btn-hero-pip"),
  btnLaunchPip: document.getElementById("btn-launch-pip"),
  btnFreeTry: document.getElementById("btn-free-try"),

  rngSpeed: document.getElementById("rng-speed"),
  lblSpeed: document.getElementById("lbl-speed"),
  rngLineWidth: document.getElementById("rng-line-width"),
  lblLineWidth: document.getElementById("lbl-line-width"),

  pipCanvas: document.getElementById("pip-canvas"),
  pipVideo: document.getElementById("pip-video"),

  btnFsVoice: document.getElementById("btn-fs-voice"),
  btnFsScroll: document.getElementById("btn-fs-scroll"),
  btnFsMirror: document.getElementById("btn-fs-mirror"),
  btnFsReset: document.getElementById("btn-fs-reset"),
  btnFsExit: document.getElementById("btn-fs-exit"),

  inputLicense: document.getElementById("input-license"),
  btnVerifyLicense: document.getElementById("btn-verify-license"),
  btnClearLicense: document.getElementById("btn-clear-license"),
  licenseBanner: document.getElementById("license-banner"),

  btnOpenOrder: document.getElementById("btn-open-order"),
  orderModal: document.getElementById("order-modal"),
  btnCloseModal: document.getElementById("btn-close-modal"),
  orderBrief: document.getElementById("order-brief"),
  mailtoQQ: document.getElementById("mailto-qq"),
  mailtoGmail: document.getElementById("mailto-gmail"),
  btnCopyOrder: document.getElementById("btn-copy-order"),
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function rebuildFollowerAndMetrics() {
  const text = els.scriptInput.value;
  state.metrics = estimateScriptDuration(text, { charsPerMinute: state.cpm });
  state.follower = createVoiceFollower(text, { maxCharsPerLine: state.maxCharsPerLine });
  state.floatCursor = 0;

  // Update Metrics UI
  const limitLabel = state.isPro ? `${state.metrics.spokenUnits} 字 (Pro无限)` : `${state.metrics.spokenUnits} / ${FREE_CHAR_LIMIT}`;
  els.valCharCount.textContent = limitLabel;
  const over = !state.isPro && !state.metrics.isWithinFreeLimit;
  els.tileCharCount.classList.toggle("over-limit", over);
  els.lblCharQuota.textContent = over
    ? `超出免费额度 ${state.metrics.spokenUnits - FREE_CHAR_LIMIT} 字（解锁 ¥12 永久买断）`
    : state.isPro
      ? "Pro 永久买断已解锁无限字数"
      : `免费额度剩余 ${state.metrics.freeLimitRemaining} 字`;

  els.valDuration.textContent = state.metrics.formattedDuration;
  els.lblDurationRate.textContent = `预计口播时长 (${state.cpm}字/分)`;
  els.valLineCount.textContent = `${state.follower.segmented.lines.length} 行`;

  renderTracks();
}

function renderLinesIntoTrack(trackEl, pos) {
  const lines = state.follower.segmented.lines;
  trackEl.classList.toggle("mirror-x", state.mirrorX);

  if (lines.length === 0) {
    trackEl.innerHTML = `<div class="p-line active">请输入口播逐字稿...</div>`;
    trackEl.style.transform = "translateY(0px)";
    return;
  }

  trackEl.innerHTML = lines
    .map((ln) => {
      if (ln.isCueOnly) {
        const cls = ln.index < pos.lineIndex ? "p-line cue past" : "p-line cue";
        return `<div class="${cls}" data-line="${ln.index}">${escapeHtml(ln.text)}</div>`;
      }
      if (ln.index < pos.lineIndex) {
        return `<div class="p-line past" data-line="${ln.index}">${escapeHtml(ln.text)}</div>`;
      }
      if (ln.index === pos.lineIndex) {
        const splitAt = Math.max(0, Math.min(ln.text.length, pos.charOffsetInLine));
        const donePart = escapeHtml(ln.text.slice(0, splitAt));
        const restPart = escapeHtml(ln.text.slice(splitAt));
        return `<div class="p-line active" data-line="${ln.index}"><span class="spoken-done">${donePart}</span><span>${restPart}</span></div>`;
      }
      return `<div class="p-line" data-line="${ln.index}">${escapeHtml(ln.text)}</div>`;
    })
    .join("");

  const layout = computeIslandZoneLayout(440, 350, { safeTopInsetPx: -8, lineHeightPx: 46 });
  const activeLine = lines[pos.lineIndex] || lines[0];
  const intraRatio =
    activeLine && activeLine.text.length > 0 ? pos.charOffsetInLine / activeLine.text.length : 0;
  const scrollY = computeGazeLockScrollY(pos.lineIndex, intraRatio, layout);
  const mirrorPrefix = state.mirrorX ? "scaleX(-1) " : "";
  trackEl.style.transform = `${mirrorPrefix}translateY(${scrollY}px)`;
}

function renderTracks() {
  if (!state.follower) return;
  const pos = state.follower.getState();
  els.lblProgressPct.textContent = `${Math.round(pos.progressRatio * 100)}%`;

  renderLinesIntoTrack(els.previewTrack, pos);
  renderLinesIntoTrack(els.fsTrack, pos);
  renderPipCanvasFrame(pos);
}

/**
 * Render crisp 30fps teleprompter frame onto `<canvas id="pip-canvas">` so native
 * `<video>.requestPictureInPicture()` floats over Camera, BeautyCam, Tencent Meeting, or WeChat Live!
 */
function renderPipCanvasFrame(pos = state.follower?.getState()) {
  const canvas = els.pipCanvas;
  if (!canvas || !pos || !state.follower) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  ctx.save();
  ctx.fillStyle = "#050811";
  ctx.fillRect(0, 0, w, h);

  if (state.mirrorX) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }

  // Top Header Status Strip (0..28px)
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, w, 28);
  ctx.fillStyle = "#34d399";
  ctx.font = "bold 13px -apple-system, 'PingFang SC', sans-serif";
  const modeLabel =
    state.activeMode === "voice"
      ? "🎙️ 语音实时跟读中"
      : state.activeMode === "scroll"
        ? `▶ 匀速滚屏 (${state.speedMultiplier.toFixed(1)}x)`
        : state.activeMode === "sim"
          ? "🎬 智能跟读+跳读演示中"
          : "👁️ 顶部前摄 60px 锁眼就绪";
  ctx.fillText(`● ${modeLabel}`, 14, 19);

  const pctText = `${Math.round(pos.progressRatio * 100)}%`;
  ctx.textAlign = "right";
  ctx.fillStyle = "#93c5fd";
  ctx.fillText(pctText, w - 14, 19);
  ctx.textAlign = "left";

  // Top 60px Golden Eye-Contact Zone (y = 32..92)
  ctx.fillStyle = "rgba(16, 185, 129, 0.16)";
  ctx.fillRect(10, 32, w - 20, 60);
  ctx.strokeStyle = "#10b981";
  ctx.lineWidth = 2;
  ctx.strokeRect(10, 32, w - 20, 60);

  const lines = state.follower.segmented.lines;
  const activeIdx = pos.lineIndex;

  // Draw Active Line Centered inside Top 60px Golden Band
  const activeLine = lines[activeIdx];
  if (activeLine) {
    ctx.font = "bold 26px -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif";
    const fullText = activeLine.text;
    const totalW = ctx.measureText(fullText).width;
    const startX = Math.max(20, (w - totalW) / 2);
    const splitAt = Math.max(0, Math.min(fullText.length, pos.charOffsetInLine));
    const doneStr = fullText.slice(0, splitAt);
    const restStr = fullText.slice(splitAt);

    ctx.fillStyle = "#34d399";
    ctx.fillText(doneStr, startX, 71);
    const doneW = ctx.measureText(doneStr).width;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(restStr, startX + doneW, 71);
  }

  // Upcoming 3 lines below Golden Band
  ctx.textAlign = "center";
  for (let offset = 1; offset <= 3; offset += 1) {
    const nextLn = lines[activeIdx + offset];
    if (!nextLn) break;
    const y = 92 + offset * 52;
    ctx.font = offset === 1 ? "600 22px -apple-system, 'PingFang SC', sans-serif" : "500 20px -apple-system, 'PingFang SC', sans-serif";
    ctx.fillStyle = offset === 1 ? "#cbd5e1" : "#64748b";
    ctx.fillText(nextLn.text, w / 2, y);
  }

  // Bottom progress bar
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(0, h - 5, w, 5);
  ctx.fillStyle = "#10b981";
  ctx.fillRect(0, h - 5, Math.round(w * pos.progressRatio), 5);

  ctx.restore();
}

function stopAllActiveModes() {
  if (state.recognition) {
    const rec = state.recognition;
    state.recognition = null;
    try {
      rec.stop();
    } catch {
      // ignore
    }
  }
  if (state.simTimer) {
    clearTimeout(state.simTimer);
    state.simTimer = null;
  }
  state.activeMode = "idle";
  syncActionButtons();
}

function syncActionButtons() {
  const isVoice = state.activeMode === "voice";
  const isScroll = state.activeMode === "scroll";
  els.btnVoiceFollow.textContent = isVoice ? "⏹ 停止语音跟读" : "🎙️ 开启本地语音跟读";
  els.btnFsVoice.textContent = isVoice ? "⏹ 停止跟读" : "🎙️ 语音跟读";
  els.btnAutoScroll.textContent = isScroll ? "⏸ 暂停滚屏" : "▶ 匀速滚屏";
  els.btnFsScroll.textContent = isScroll ? "⏸ 暂停滚屏" : "▶ 匀速滚屏";
  els.btnMirrorToggle.classList.toggle("btn-emerald", state.mirrorX);
  els.btnFsMirror.classList.toggle("btn-emerald", state.mirrorX);
}

function ensureFeatureAllowed(mode = "island") {
  const gate = checkPrompterAccess({
    spokenUnits: state.metrics?.spokenUnits || 0,
    mode,
    isPro: state.isPro,
  });
  if (!gate.allowed) {
    openOrderModal(gate.message);
    return false;
  }
  return true;
}

function toggleLocalVoiceFollow() {
  if (state.activeMode === "voice") {
    stopAllActiveModes();
    els.asrStatusText.textContent = "⏸ 已暂停本地语音跟读（字幕停在当前阅读行）";
    renderTracks();
    return;
  }

  if (!ensureFeatureAllowed("island")) return;

  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    els.asrStatusText.textContent =
      "⚠️ 当前浏览器未开放本地 SpeechRecognition 接口，已为您启动「智能跟读仿真演示」或可使用匀速滚屏！";
    startSimulatedVoiceDemo();
    return;
  }

  stopAllActiveModes();
  state.activeMode = "voice";
  syncActionButtons();

  const rec = new SpeechRec();
  rec.lang = "zh-CN";
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.onstart = () => {
    els.asrStatusText.textContent = "🎙️ 正在聆听麦克风：请自然朗读顶部 60px 高亮行（停顿即停、跳读自动对齐）...";
  };

  rec.onresult = (event) => {
    let latestChunk = "";
    for (let i = Math.max(0, event.resultIndex); i < event.results.length; i += 1) {
      latestChunk += event.results[i][0].transcript;
    }
    const res = state.follower.feedTranscript(latestChunk);
    state.floatCursor = res.cursor;
    const statusTag = res.jumped ? "⚡ 跳读已自动对齐" : res.matched ? "✅ 实时跟读推进" : "⏸ 停顿锁定中";
    els.asrStatusText.textContent = `${statusTag}｜识别片段：「${latestChunk.slice(-18)}」`;
    renderTracks();
  };

  rec.onerror = (ev) => {
    if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
      stopAllActiveModes();
      els.asrStatusText.textContent = "⚠️ 麦克风权限未开启，请允许浏览器访问麦克风或点击「🎬 模拟朗读+跳读」预览效果。";
    }
  };

  rec.onend = () => {
    if (state.activeMode === "voice" && state.recognition === rec) {
      try {
        rec.start();
      } catch {
        stopAllActiveModes();
      }
    }
  };

  state.recognition = rec;
  try {
    rec.start();
  } catch {
    stopAllActiveModes();
  }
  renderTracks();
}

function toggleConstantScroll() {
  if (state.activeMode === "scroll") {
    stopAllActiveModes();
    els.asrStatusText.textContent = "⏸ 匀速滚屏已暂停";
    renderTracks();
    return;
  }

  if (!ensureFeatureAllowed("island")) return;
  stopAllActiveModes();
  state.activeMode = "scroll";
  state.floatCursor = state.follower.getState().cursor;
  if (state.floatCursor >= state.follower.segmented.totalSpokenChars) {
    state.follower.reset();
    state.floatCursor = 0;
  }
  syncActionButtons();
  els.asrStatusText.textContent = `▶ 匀速平滑滚屏进行中（${state.speedMultiplier.toFixed(1)}x · 贴紧顶部 60px 黄金区）`;
}

/**
 * Interactive simulated ASR demo: demonstrates normal voice follow -> 1s pause hold -> skipping ahead a clause!
 */
function startSimulatedVoiceDemo() {
  if (!ensureFeatureAllowed("island")) return;
  stopAllActiveModes();
  state.follower.reset();
  state.floatCursor = 0;
  state.activeMode = "sim";
  syncActionButtons();
  renderTracks();

  const lines = state.follower.segmented.lines.filter((l) => !l.isCueOnly);
  if (lines.length === 0) return;

  const steps = [];
  // Step through first 2 spoken lines naturally
  for (let lIdx = 0; lIdx < Math.min(2, lines.length); lIdx += 1) {
    const t = lines[lIdx].text;
    const mid = Math.max(3, Math.floor(t.length / 2));
    steps.push({ delay: 520, transcript: t.slice(0, mid), note: "🎙️ 正常语速跟读推进..." });
    steps.push({ delay: 560, transcript: t, note: "🎙️ 正常语速跟读推进..." });
  }
  // Simulate 1.1s speaker thinking pause
  steps.push({ delay: 950, transcript: "", note: "⏸ 模拟主播卡壳停顿 1 秒 → 字幕原地稳稳锁死，绝不乱滚！" });

  // Simulate skipping 1 line forward (jump-reading!)
  const jumpTarget = lines[Math.min(lines.length - 1, 3)] || lines[lines.length - 1];
  if (jumpTarget) {
    steps.push({
      delay: 750,
      transcript: jumpTarget.text.slice(0, Math.min(8, jumpTarget.text.length)),
      note: "⚡ 模拟主播临时跳读下一段 → 算法瞬间自动对齐新位置！",
    });
    steps.push({
      delay: 650,
      transcript: jumpTarget.text,
      note: "✅ 跳读对齐完成，始终锁在顶部 60px 黄金区！",
    });
  }

  let idx = 0;
  const runNext = () => {
    if (state.activeMode !== "sim" || idx >= steps.length) {
      state.activeMode = "idle";
      syncActionButtons();
      renderTracks();
      return;
    }
    const st = steps[idx];
    idx += 1;
    const res = state.follower.feedTranscript(st.transcript);
    state.floatCursor = res.cursor;
    els.asrStatusText.textContent = st.note;
    renderTracks();
    state.simTimer = setTimeout(runNext, st.delay);
  };

  state.simTimer = setTimeout(runNext, 350);
}

async function launchCrossAppPictureInPicture() {
  if (!ensureFeatureAllowed("pip")) return;

  renderPipCanvasFrame();
  try {
    if (!state.pipStreamAttached && typeof els.pipCanvas.captureStream === "function") {
      const stream = els.pipCanvas.captureStream(30);
      els.pipVideo.srcObject = stream;
      state.pipStreamAttached = true;
    }
    await els.pipVideo.play();

    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
      return;
    }

    if (typeof els.pipVideo.requestPictureInPicture === "function") {
      await els.pipVideo.requestPictureInPicture();
      els.asrStatusText.textContent =
        "🪟 画中画悬浮窗已弹出！请将其拖到屏幕最顶端贴紧前摄，即可切去原相机/视频号/腾讯会议录制！";
      if (state.activeMode === "idle") {
        toggleConstantScroll();
      }
      return;
    }

    // iOS/macOS Safari WebKit fallback
    if (typeof els.pipVideo.webkitSetPresentationMode === "function") {
      els.pipVideo.webkitSetPresentationMode("picture-in-picture");
      els.asrStatusText.textContent = "🪟 Safari 画中画悬浮窗已启动！拖到灵动岛下方即可跨 App 录口播！";
      if (state.activeMode === "idle") {
        toggleConstantScroll();
      }
      return;
    }

    els.asrStatusText.textContent = "⚠️ 当前浏览器环境限制画中画弹窗，建议在 Safari / Chrome / Edge 中打开。";
  } catch (err) {
    els.asrStatusText.textContent = `⚠️ 启动画中画提示：${err?.message || "请再次点击按钮授权弹出"}`;
  }
}

function startAnimationLoop() {
  let lastTs = performance.now();
  const tick = (now) => {
    const dtSec = Math.min(0.1, (now - lastTs) / 1000);
    lastTs = now;

    if (state.activeMode === "scroll" && state.follower) {
      const total = state.follower.segmented.totalSpokenChars;
      if (total > 0) {
        const charsPerSec = (state.cpm / 60) * state.speedMultiplier;
        state.floatCursor += charsPerSec * dtSec;
        if (state.floatCursor >= total) {
          state.follower.setCursor(total);
          stopAllActiveModes();
          els.asrStatusText.textContent = "🎉 本篇口播稿已滚屏完毕！";
        } else {
          state.follower.setCursor(Math.floor(state.floatCursor));
        }
        renderTracks();
      }
    } else {
      // Keep 30fps PiP canvas stream fresh
      renderPipCanvasFrame();
    }

    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function openOrderModal(reasonText = "") {
  const units = state.metrics?.spokenUnits || 0;
  const brief = [
    `【下单产品】灵动提词 IslandPrompter Pro 永久买断版 (slug: ${PRODUCT_SLUG})`,
    `【买断价格】¥${PRICE_CNY} 一次性永久买断（拒绝 ¥39/月包月续费，终身可用）`,
    `【解锁权益】无限字数长篇直播逐字稿 + 真·跨软件画中画置顶悬浮窗 (PiP)`,
    `【当前字数】${units} 字`,
    reasonText ? `【触发场景】${reasonText}` : null,
    `【接收激活码邮箱】（直接发送本邮件即刻秒回 OPC1. 离线激活码）`,
  ]
    .filter(Boolean)
    .join("\n");

  els.orderBrief.textContent = brief;
  const subject = encodeURIComponent(`购买灵动提词 IslandPrompter 永久买断激活码 (¥${PRICE_CNY})`);
  const body = encodeURIComponent(brief);
  els.mailtoQQ.href = `mailto:${ORDER_EMAIL_QQ}?subject=${subject}&body=${body}`;
  els.mailtoGmail.href = `mailto:${ORDER_EMAIL_GMAIL}?subject=${subject}&body=${body}`;
  els.orderModal.classList.remove("hidden");
}

function updateProUI() {
  if (state.isPro) {
    els.proPill.textContent = "Pro 永久买断已激活";
    els.btnLaunchPip.textContent = "🚀 弹出跨软件画中画悬浮窗 (已解锁)";
    els.btnClearLicense.classList.remove("hidden");
    els.licenseBanner.className = "banner ok";
    els.licenseBanner.textContent = `✅ 已通过本地 Ed25519 公钥验签激活 Pro 永久买断版（授权账号：${state.licensePayload?.e || "VIP"}），无限字数长稿与跨软件画中画悬浮窗已全部解锁！`;
    els.licenseBanner.classList.remove("hidden");
  } else {
    els.proPill.textContent = "300字内永久免费";
    els.btnLaunchPip.textContent = "🚀 弹出跨软件画中画悬浮窗 (Pro)";
    els.btnClearLicense.classList.add("hidden");
  }
  rebuildFollowerAndMetrics();
}

async function verifyAndPersist(token, silent = false) {
  const res = await verifyLicenseToken(token);
  if (res.valid) {
    state.isPro = true;
    state.licensePayload = res.payload;
    state.licenseToken = token.trim();
    localStorage.setItem(STORAGE_KEY, state.licenseToken);
    els.inputLicense.value = state.licenseToken;
    updateProUI();
  } else if (!silent) {
    els.licenseBanner.className = "banner err";
    els.licenseBanner.textContent = `❌ 激活码校验未通过：${res.message || res.reason}`;
    els.licenseBanner.classList.remove("hidden");
  }
}

function bindEvents() {
  els.scriptInput.addEventListener("input", () => {
    stopAllActiveModes();
    rebuildFollowerAndMetrics();
  });

  els.btnSampleShort.addEventListener("click", () => {
    stopAllActiveModes();
    els.scriptInput.value = SHORT_DEMO_SCRIPT;
    rebuildFollowerAndMetrics();
  });

  els.btnSampleLong.addEventListener("click", () => {
    stopAllActiveModes();
    els.scriptInput.value = LONG_LIVE_SCRIPT;
    rebuildFollowerAndMetrics();
  });

  els.paceChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      state.cpm = Number(chip.dataset.cpm || 230);
      els.paceChips.forEach((c) => c.classList.toggle("active", c === chip));
      rebuildFollowerAndMetrics();
    });
  });

  // Click any line in preview or fullscreen track to jump manually
  const handleTrackClick = (e) => {
    const lineEl = e.target.closest(".p-line");
    if (!lineEl || !state.follower) return;
    const idx = Number(lineEl.dataset.line);
    const ln = state.follower.segmented.lines[idx];
    if (ln) {
      state.follower.setCursor(ln.startSpokenIndex);
      state.floatCursor = ln.startSpokenIndex;
      renderTracks();
    }
  };
  els.previewTrack.addEventListener("click", handleTrackClick);
  els.fsTrack.addEventListener("click", handleTrackClick);

  els.btnVoiceFollow.addEventListener("click", toggleLocalVoiceFollow);
  els.btnFsVoice.addEventListener("click", toggleLocalVoiceFollow);

  els.btnAutoScroll.addEventListener("click", toggleConstantScroll);
  els.btnFsScroll.addEventListener("click", toggleConstantScroll);

  els.btnSimVoice.addEventListener("click", startSimulatedVoiceDemo);
  els.btnHeroVoiceDemo.addEventListener("click", startSimulatedVoiceDemo);

  const toggleMirror = () => {
    state.mirrorX = !state.mirrorX;
    syncActionButtons();
    renderTracks();
  };
  els.btnMirrorToggle.addEventListener("click", toggleMirror);
  els.btnFsMirror.addEventListener("click", toggleMirror);

  const resetToTop = () => {
    stopAllActiveModes();
    state.follower?.reset();
    state.floatCursor = 0;
    els.asrStatusText.textContent = "↺ 已回到口播稿第一行（锁定顶部 60px 黄金区）";
    renderTracks();
  };
  els.btnResetCursor.addEventListener("click", resetToTop);
  els.btnFsReset.addEventListener("click", resetToTop);

  const openFullscreenGazeLock = () => {
    if (!ensureFeatureAllowed("island")) return;
    els.fsOverlay.classList.remove("hidden");
    renderTracks();
  };
  els.btnEnterFs.addEventListener("click", openFullscreenGazeLock);
  els.btnTopIslandFs.addEventListener("click", openFullscreenGazeLock);
  els.btnFreeTry.addEventListener("click", () => {
    if ((state.metrics?.spokenUnits || 0) > FREE_CHAR_LIMIT && !state.isPro) {
      els.scriptInput.value = SHORT_DEMO_SCRIPT;
      rebuildFollowerAndMetrics();
    }
    openFullscreenGazeLock();
  });

  els.btnFsExit.addEventListener("click", () => {
    els.fsOverlay.classList.add("hidden");
  });

  els.btnHeroPip.addEventListener("click", launchCrossAppPictureInPicture);
  els.btnLaunchPip.addEventListener("click", launchCrossAppPictureInPicture);

  els.rngSpeed.addEventListener("input", () => {
    state.speedMultiplier = Number(els.rngSpeed.value);
    els.lblSpeed.textContent = `${state.speedMultiplier.toFixed(1)}x`;
  });

  els.rngLineWidth.addEventListener("input", () => {
    state.maxCharsPerLine = Number(els.rngLineWidth.value);
    els.lblLineWidth.textContent = `${state.maxCharsPerLine} 字/行`;
    rebuildFollowerAndMetrics();
  });

  els.btnOpenOrder.addEventListener("click", () => openOrderModal());
  els.btnCloseModal.addEventListener("click", () => els.orderModal.classList.add("hidden"));
  els.orderModal.addEventListener("click", (e) => {
    if (e.target === els.orderModal) els.orderModal.classList.add("hidden");
  });

  els.btnCopyOrder.addEventListener("click", async () => {
    await navigator.clipboard.writeText(
      `${els.orderBrief.textContent}\n发码联系邮箱：${ORDER_EMAIL_QQ} / ${ORDER_EMAIL_GMAIL}`
    );
    els.btnCopyOrder.textContent = "✅ 已复制订单摘要";
    setTimeout(() => {
      els.btnCopyOrder.textContent = "📋 复制订单信息";
    }, 2000);
  });

  els.btnVerifyLicense.addEventListener("click", () => {
    verifyAndPersist(els.inputLicense.value, false);
  });

  els.btnClearLicense.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    state.isPro = false;
    state.licensePayload = null;
    state.licenseToken = "";
    els.inputLicense.value = "";
    els.licenseBanner.classList.add("hidden");
    updateProUI();
  });

  if ("mediaSession" in navigator) {
    try {
      navigator.mediaSession.setActionHandler("play", () => {
        if (state.activeMode === "idle") toggleConstantScroll();
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        stopAllActiveModes();
      });
    } catch {
      // ignore unsupported mediaSession handlers
    }
  }
}

async function init() {
  els.scriptInput.value = SHORT_DEMO_SCRIPT;
  bindEvents();

  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    await verifyAndPersist(saved, true);
  } else {
    rebuildFollowerAndMetrics();
  }

  startAnimationLoop();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

init();
