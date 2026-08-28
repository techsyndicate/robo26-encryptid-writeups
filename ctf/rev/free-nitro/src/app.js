(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const feed = $("feed");
  const consoleEl = $("console");
  const barEl = $("bar");
  const barfill = $("barfill");

  const PEOPLE = [
    ["Lil_Asriel", "#2965F2"], ["chonk404", "#593695"], ["sniper_btw", "#ED4245"],
    ["ghostie#0001", "#23A55A"], ["xX_Noob_Xx", "#FEE75C"], ["teaghosted", "#EB459E"],
    ["el_bartito", "#F23F43"], ["omega_lul", "#5865F2"], ["dusty_towns", "#F0B232"],
  ];
  function timeStr() {
    const d = new Date();
    return d.getHours().toString().padStart(2, "0") + ":" +
      d.getMinutes().toString().padStart(2, "0") + ":" +
      d.getSeconds().toString().padStart(2, "0");
  }
function pushClaim(instant) {
    const [name, color] = PEOPLE[Math.floor(Math.random() * PEOPLE.length)];
    const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let code = "";
    for (let i = 0; i < 25; i++) code += ALPHA[Math.floor(Math.random() * ALPHA.length)];
    const el = document.createElement("div");
    el.className = "feed-item";
    el.innerHTML = `<span class="avatar" style="background:${color}">${name[0]}</span>
      <span><span class="name">${name}</span> claimed <span class="code">discord.com/gifts/${code}</span></span>
      <time>${timeStr()}</time>`;
    feed.prepend(el);
    while (feed.children.length > 7) feed.lastChild.remove();
    if (!instant) setTimeout(pushClaim, 2200 + Math.random() * 3500);
  }

  let online = 12409;
  const giftCd = $("giftCd");
  if (giftCd) {
    let giftLeft = 9 * 60 + 59;
    setInterval(() => {
      giftLeft = Math.max(0, giftLeft - 1);
      giftCd.textContent = String(Math.floor(giftLeft / 60)).padStart(2, "0") + ":" + String(giftLeft % 60).padStart(2, "0");
    }, 1000);
  }
  setInterval(() => {
    online += Math.floor(Math.random() * 21) - 10;
    $("online").textContent = Math.max(10400, online).toLocaleString();
  }, 1300);

  const canvas = $("confetti");
  const ctx = canvas.getContext("2d");
  let confettiOn = false;
  function resizeCanvas() { canvas.width = innerWidth; canvas.height = innerHeight; }
  addEventListener("resize", resizeCanvas); resizeCanvas();
  let bits = [];
  function launchConfetti() {
    bits = Array.from({ length: 160 }, () => ({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * 180,
      s: 4 + Math.random() * 6,
      v: 2 + Math.random() * 3.5,
      r: Math.random() * Math.PI,
      vr: (Math.random() - .5) * .3,
      c: ["#5865F2", "#57F287", "#FEE75C", "#ED4245", "#EB459E", "#FFFFFF"][Math.floor(Math.random() * 6)],
    }));
    confettiOn = true; canvas.style.display = "block";
    if (!launchConfetti.raf) launchConfetti.raf = requestAnimationFrame(tickConfetti);
  }
  function tickConfetti() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    bits.forEach((b) => {
      b.y += b.v; b.x += Math.sin(b.y * 0.02); b.r += b.vr;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r);
      ctx.fillStyle = b.c; ctx.fillRect(-b.s / 2, -b.s / 2, b.s, b.s * 0.6);
      ctx.restore();
    });
    bits = bits.filter((b) => b.y < canvas.height + 30);
    if (bits.length) requestAnimationFrame(tickConfetti);
    else { confettiOn = false; canvas.style.display = "none"; }
  }

  let wasm = null;
  const errBanner = (m) => {
    document.querySelector(".card").style.borderColor = "#ed4245";
    document.querySelector(".legal").innerHTML = `<span class="red">WARNING ${m}</span>`;
  };

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }

  async function loadBundle() {
    let resp;
    try {
      resp = await fetch("/api/bundle", { method: "GET", credentials: "same-origin", cache: "no-store", headers: { "x-nitro-fp": fingerprintCookie } });
    } catch (e) {
      errBanner("the relay bailed before the handshake. no nitro today.");
      $("go").disabled = true;
      return false;
    }
    if (!resp.ok) {
      errBanner("the souvenir shop is closed (no valid human session). no nitro today.");
      $("go").disabled = true;
      return false;
    }
    let b64 = "";
    try {
      const j = await resp.json();
      b64 = j?.data ?? "";
    } catch { b64 = ""; }
    if (!b64) {
      errBanner("empty souvenir box arrived. no nitro today.");
      $("go").disabled = true;
      return false;
    }
    const bytes = base64ToBytes(b64);
    let digest = "";
    try {
      const d = await crypto.subtle.digest("SHA-256", bytes);
      digest = [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
    } catch { digest = ""; }
    if (digest && digest !== WASM_SHA256) {
      errBanner("the souvenir shop is closed (somebody swapped the keychain). no nitro today.");
      $("go").disabled = true;
      return false;
    }
    try {
      const mod = new WebAssembly.Module(bytes);
      const inst = new WebAssembly.Instance(mod);
      wasm = inst.exports;
      return true;
    } catch (e) {
      errBanner("too many swipes: " + e);
      $("go").disabled = true;
      return false;
    }
  }

  const view = () => new DataView(wasm.memory.buffer);
  function readOut() {
    const p = wasm.get_output_buf();
    const n = wasm.get_output_len();
    let s = "";
    const v = view();
    for (let i = 0; i < n; i++) s += String.fromCharCode(v.getUint8(p + i));
    return s;
  }
  function writeIn(str) {
    const p = wasm.get_input_buf();
    const v = view();
    for (let i = 0; i < str.length; i++) v.setUint8(p + i, str.charCodeAt(i));
  }

const CONSOLE = [
    ["ok", "OK nitro engine v4.0 spinning up (totally not a toaster)"],
    ["ok", "OK linked to dispense pool 8.12.0"],
    ["", "dialing the w3c relay... voicemail full"],
    ["warn", "boosting entitlement table... 1,024 rows stitched in"],
    ["", "poking LeLagoon node 7 with a long stick..."],
    ["ok", "LeLagoon node 7 answered (latency 4ms, promised)"],
    ["", "stirring the arcane mixer (label says DO NOT)"],
    ["", "baking gift link (salted, definitely not caramel)..."],
    ["warn", "wrapping gift in tissue paper before the warden..."],
    ["", "arming the burn-after-claim window"],
    ["", "syncing 3,012,814 ledger rows with Lagoondyne..."],
    ["ok", "ledger checksum accepted (we counted twice, trust)"],
    ["warn", "claim rate 12/s, throttling hot slots by hand"],
    ["", "injecting gold-plated entitlement cookie..."],
    ["", "minting code..."],
    ["warn", "queue position: #1 (sneaky soul skipped ahead)"],
    ["", "staking a slot with session table salt..."],
    ["ok", "claim slot reserved and watered"],
    ["", "ferrying code across the dispense bay..."],
    ["warn", "vault handshake renegotiated mid-flight (again)"],
    ["", "finalizing..."],
    ["ok", "OK code sealed. Don't bend it."],
  ];
  function appendLine(cls, text) {
    const d = document.createElement("div");
    if (cls) d.className = cls;
    d.textContent = text;
    consoleEl.appendChild(d);
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  const reportAgent = (info) => {
    try {
      fetch("/api/ai-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "client_signal", ...info }),
        keepalive: true,
      });
    } catch { /* best effort */ }
  };

  function fingerprint() {
    let fp = "";
    try {
      fp = (document.cookie.match(/(?:^|; )nitro_fp=([^;]+)/) || [])[1] || "";
    } catch { fp = ""; }
    if (fp) return fp;
    fp = "fp_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 12) + "_" + Math.random().toString(36).slice(2, 8);
    try {
      document.cookie = "nitro_fp=" + encodeURIComponent(fp) + "; SameSite=Lax; Path=/; Max-Age=86400";
    } catch { /* */ }
    return fp;
  }
  window.__NITRO_T0 = Date.now();
  const fingerprintCookie = fingerprint();

  (function detectAutomation() {
    try {
      const ua = navigator.userAgent || "";
      const signals = [];
      if (navigator.webdriver === true) signals.push("navigator.webdriver");
      if (window._phantom || window.callPhantom) signals.push("phantomjs");
      if (window.__playwright) signals.push("playwright");
      if (window.cdc_ && window.cdc_.Json) signals.push("cdc_scroller");
      if (/HeadlessChrome|PhantomJS|Puppeteer|Playwright/i.test(ua)) signals.push("headless_ua");
      if (signals.length) reportAgent({ detection: "automation", signals, ua });
    } catch { /* best effort */ }
  })();

  async function runTheater(token) {
    consoleEl.style.display = "block";
    barEl.style.display = "block";
    consoleEl.innerHTML = "";
    barfill.style.width = "0%";
    for (let i = 0; i < CONSOLE.length; i++) {
      appendLine(...CONSOLE[i]);
      barfill.style.width = Math.min(99, ((i + 1) / CONSOLE.length) * 100) + "%";
      await sleep(260 + Math.random() * 240);
    }
    barfill.style.width = "99%";
    await sleep(420);
  }

  function openVerify() {
    $("verContinue").disabled = true;
    $("verifyOverlay").classList.add("show");
    if (window.grecaptcha) try { window.grecaptcha.reset(); } catch { /* */ }
    renderRecap();
  }

  function showResult(html) {
    $("resultModal").innerHTML = html;
    $("resultOverlay").classList.add("show");
  }

  async function finalize(token) {
    $("verifyOverlay").classList.remove("show");
    const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    const persona = (token.split("").reduce((a, c) => a + c.charCodeAt(0), 7)) >>> 0;

    wasm.get_gift(seed, persona);
    const link = readOut();

    const clamped = token.slice(0, 64);
    writeIn(clamped);
    const owner = wasm.verify_token(clamped.length) | 0;
    const prize = owner ? readOut() : null;

    if (owner) {
      launchConfetti();
      showResult(`
        <h3>HYPE OWNER NITRO MINTED</h3>
        <img src="cool.jpg" class="reward-banner" alt="cool reward unlocked">
        <p>That username held the ultra-secret <b style="color:var(--blurple-2)">vip pass</b>. The dispense bay printed the one-time VIP voucher:</p>
        <div class="codebox">${prize}</div>
        <span class="owner-chip">BACKSTAGE PASS * 24H</span>
        <img src="cool-cat.jpg" class="reward-badge" alt="cat with the reward">
        <div class="countdown" id="cd"></div>
        <button class="btn btn-small" onclick="location.reload()">Mint again</button>
      `);
      tickCd($("cd"), 9 * 60 + 59);
      return;
    }

showResult(`
      <h3>GIFT CLAIMED. Discord Nitro</h3>
      <p>Your 3-month Nitro gift is ready. Open it before the window closes:</p>
      <div class="codebox"><a href="${link}" target="_blank" rel="noopener">${link}</a></div>
      <p style="color:var(--dim);font-size:12px;margin-top:4px">opens straight into the Discord claim page</p>
      <button class="btn btn-small" id="copyBtn">COPY Copy link</button>
      <button class="btn btn-small" style="background:var(--panel2);border:1px solid var(--border)" onclick="location.reload()">New code</button>
    `);
    const cb = $("copyBtn");
    if (cb) cb.addEventListener("click", () => {
      navigator.clipboard.writeText(link).then(() => { cb.textContent = "OK Copied"; });
    });
  }

  function tickCd(el, total, done) {
    const t0 = Date.now();
    const id = setInterval(() => {
      const left = Math.max(0, total - Math.floor((Date.now() - t0) / 1000));
      const m = Math.floor(left / 60), s = left % 60;
      el.textContent = "redeem window: " + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
      if (left === 0) { clearInterval(id); if (done) done(); }
    }, 250);
  }

  $("genForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const hp = $("email");
    if (hp && hp.value && hp.value.trim()) {
      reportAgent({ detection: "honeypot_filled", field: "email", value: hp.value.slice(0, 512) });
      $("go").disabled = true;
      document.querySelector(".card").style.borderColor = "#ed4245";
      return;
    }
    const token = $("token").value.trim();
    if (token.length < 4) {
      $("token").focus();
      $("token").style.borderColor = "#ed4245";
      setTimeout(() => ($("token").style.borderColor = ""), 1500);
      return;
    }
    $("go").disabled = true;
    await runTheater(token);
    openVerify();
    $("go").disabled = false;
  });

  const recapBox = $("recapBox");
  const capStatus = $("capStatus");
  let wasmReady = false;
  let recapReady = false;
  let recapFailed = false;

  const RECAPTCHA_SITE_KEY = "6LdbxHstAAAAAOQIvWvZdYdCfIab8hyk0NFUf6AD";
  const showCap = (m) => { capStatus.textContent = m; capStatus.style.display = "block"; };
  const hideCap = () => { capStatus.style.display = "none"; };
  const enableContinue = (v) => { $("verContinue").disabled = !v; };

  async function mintSession(recaptcha) {
    try {
      const resp = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-nitro-fp": fingerprintCookie, "x-nitro-t0": String(window.__NITRO_T0 || Date.now()) },
        body: JSON.stringify({ recaptcha, fp: fingerprintCookie }),
        credentials: "same-origin",
      });
      let j = null;
      try { j = await resp.json(); } catch { /* */ }
      if (resp.ok && j && j.success) return { ok: true, error: "", reason: "" };
      const ct = (resp.headers && resp.headers.get ? resp.headers.get("content-type") : "") || "";
      if (!resp.ok && ct.includes("text/html")) return { ok: false, reason: "cloudflare_challenge", error: "http_" + resp.status };
      return { ok: false, reason: (j && j.reason) || "", error: (j && j.error) || ("http_" + resp.status) };
    } catch (e) {
      return { ok: false, error: "network_error" };
    }
  }

  let mintErr = "";
  async function unlockWasm(recaptcha) {
    if (wasmReady) return true;
    const m = await mintSession(recaptcha);
    if (!m.ok) { mintErr = m.reason || m.error || "session_mint_failed"; return false; }
    const loaded = await loadBundle();
    if (!loaded) { mintErr = "bundle_failed"; return false; }
    mintErr = "";
    wasmReady = true;
    return true;
  }

  let recapRendered = false;
  let recapTimer = null;
  function renderRecap() {
    const ov = $("verifyOverlay");
    if (!window.grecaptcha || recapRendered) return;
    if (ov && !ov.classList.contains("show")) return;
    try {
      window.grecaptcha.render(recapBox.id, {
        sitekey: RECAPTCHA_SITE_KEY,
        callback: () => { recapReady = true; enableContinue(true); },
        "expired-callback": () => { recapReady = false; enableContinue(false); },
        "error-callback": () => { recapReady = false; recapFailed = true; enableContinue(false); },
      });
      recapRendered = true;
      recapFailed = false;
    } catch (e) {
      recapReady = false;
      recapFailed = true;
      enableContinue(false);
    }
  }

  window.__recapLoad = () => { recapReady = false; renderRecap(); };

  function clearRecapTimer() {
    if (recapTimer) { clearInterval(recapTimer); recapTimer = null; }
  }

  function loadRecaptcha() {
    if (window.grecaptcha) { renderRecap(); return; }
    let attempt = 0;
    let scriptEl = null;
    const inject = () => {
      if (window.grecaptcha) { renderRecap(); clearRecapTimer(); return; }
      if (attempt >= 3) { recapReady = false; recapFailed = true; clearRecapTimer(); return; }
      attempt++;
      const s = document.createElement("script");
      s.src = "https://www.google.com/recaptcha/api.js?onload=__recapLoad&render=explicit";
      s.async = true; s.defer = true;
      s.onerror = () => { recapReady = false; recapFailed = true; };
      s.onload = () => { if (window.grecaptcha) renderRecap(); };
      if (scriptEl) scriptEl.remove();
      document.head.appendChild(s);
      scriptEl = s;
    };
    inject();
    recapTimer = setInterval(inject, 4000);
    setTimeout(() => {
      if (!window.grecaptcha) { recapReady = false; recapFailed = true; }
      clearRecapTimer();
    }, 20000);
  }

  function resetCap() {
    clearRecapTimer();
    hideCap();
    if (window.grecaptcha) try { window.grecaptcha.reset(); } catch { /* */ }
    recapReady = false;
    enableContinue(false);
  }

  function gateOkOrError(detail) {
    if (detail === "cloudflare_challenge") {
      showCap("Blocked by a Cloudflare intercept layer. Refresh the page, solve it once, then mouse again.");
      return;
    }
    if (recapFailed || detail === "network_error") {
      showCap("Human check could not load. Refresh the page and try again.");
      return;
    }
    showCap("Human check did not clear (" + (detail || "please try again") + ").");
  }

  $("verContinue").addEventListener("click", async () => {
    const token = $("token").value.trim();
    $("verContinue").disabled = true;
    $("verContinue").textContent = "minting...";
    hideCap();

    let recaptcha = "";
    try { recaptcha = (recapReady && window.grecaptcha && window.grecaptcha.getResponse()) || ""; } catch { recaptcha = ""; }
    if (!recaptcha) {
      gateOkOrError(recapFailed ? "captcha_did_not_load" : "box_not_checked");
      $("verContinue").textContent = "Continue";
      return;
    }
    const ok = await unlockWasm(recaptcha);
    if (!ok) {
      resetCap();
      gateOkOrError(mintErr);
      $("verContinue").textContent = "Continue";
      return;
    }
    finalize(token);
  });

  loadRecaptcha();

  pushClaim(true);
})();