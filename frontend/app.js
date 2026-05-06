const API_BASE = "";

// ── Mode toggle ──
const modeBtns = document.querySelectorAll(".mode-btn");
const singleForm = document.getElementById("transcribe-form");
const profileForm = document.getElementById("profile-form");

let currentMode = "single";

modeBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    modeBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentMode = btn.dataset.mode;

    clearState();

    if (currentMode === "single") {
      singleForm.classList.remove("hidden");
      profileForm.classList.add("hidden");
    } else {
      singleForm.classList.add("hidden");
      profileForm.classList.remove("hidden");
    }
  });
});

// ── Single reel elements ──
const form = document.getElementById("transcribe-form");
const urlInput = document.getElementById("reel-url");
const statusEl = document.getElementById("status");
const statusText = document.getElementById("status-text");
const resultBox = document.getElementById("result-box");
const transcriptEl = document.getElementById("transcript");
const resultMeta = document.getElementById("result-meta");
const errorBox = document.getElementById("error-box");
const errorText = document.getElementById("error-text");
const warningBox = document.getElementById("warning-box");
const copyBtn = document.getElementById("copy-btn");
const copyText = document.getElementById("copy-text");
const submitBtn = document.getElementById("submit-btn");
const btnText = document.getElementById("btn-text");
const btnSpinner = document.getElementById("btn-spinner");

// ── Profile elements ──
const profileUrlInput = document.getElementById("profile-url");
const profileSubmitBtn = document.getElementById("profile-submit-btn");
const profileBtnText = document.getElementById("profile-btn-text");
const profileBtnSpinner = document.getElementById("profile-btn-spinner");
const reelCountInput = document.getElementById("reel-count");
const profileResults = document.getElementById("profile-results");
const progressText = document.getElementById("progress-text");
const reelList = document.getElementById("reel-list");
const copyAllBtn = document.getElementById("copy-all-btn");
const copyAllText = document.getElementById("copy-all-text");

function getProvider() {
  return document.querySelector('input[name="provider"]:checked').value;
}

// ── Single reel logic ──

function setLoading(loading) {
  submitBtn.disabled = loading;
  btnText.textContent = loading ? "Working..." : "Transcribe";
  btnSpinner.classList.toggle("hidden", !loading);
  statusEl.classList.toggle("hidden", !loading);

  const steps = ["Downloading reel...", "Extracting audio...", "Transcribing..."];
  if (loading) {
    let i = 0;
    statusText.textContent = steps[0];
    window._statusInterval = setInterval(() => {
      i = Math.min(i + 1, steps.length - 1);
      statusText.textContent = steps[i];
    }, 4000);
  } else {
    clearInterval(window._statusInterval);
  }
}

function clearState() {
  errorBox.classList.add("hidden");
  resultBox.classList.add("hidden");
  warningBox.classList.add("hidden");
  statusEl.classList.add("hidden");
  profileResults.classList.add("hidden");
  copyAllBtn.classList.add("hidden");
  reelList.innerHTML = "";
}

function showError(msg) {
  errorText.textContent = msg;
  errorBox.classList.remove("hidden");
  resultBox.classList.add("hidden");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;

  clearState();
  setLoading(true);

  const payload = {
    url,
    provider: getProvider(),
    language: document.getElementById("language").value,
  };

  try {
    const res = await fetch(`${API_BASE}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || `Server error (HTTP ${res.status})`);
    }

    transcriptEl.textContent = data.transcript;

    resultMeta.innerHTML = "";
    const badges = [];
    if (data.provider === "openai") badges.push("OpenAI Whisper");
    if (data.provider === "gemini") badges.push("Google Gemini");
    if (data.language_detected) badges.push(`Lang: ${data.language_detected}`);
    if (data.duration_seconds != null) badges.push(`${data.duration_seconds.toFixed(1)}s`);
    badges.forEach((b) => {
      const span = document.createElement("span");
      span.textContent = b;
      resultMeta.appendChild(span);
    });

    if (data.warning) {
      warningBox.textContent = data.warning;
      warningBox.classList.remove("hidden");
    }

    resultBox.classList.remove("hidden");
  } catch (err) {
    showError(err.message);
  } finally {
    setLoading(false);
  }
});

copyBtn.addEventListener("click", () => copyToClipboard(transcriptEl.textContent, copyBtn, copyText));

// ── Profile logic ──

let profileResultsData = [];

profileForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = profileUrlInput.value.trim();
  const count = parseInt(reelCountInput.value, 10);
  if (!url || !count) return;

  clearState();
  setProfileLoading(true);

  profileResults.classList.remove("hidden");
  profileResultsData = [];
  reelList.innerHTML = "";
  progressText.textContent = "Fetching profile reels...";

  const payload = {
    profile_url: url,
    count,
    provider: getProvider(),
    language: document.getElementById("profile-language").value,
  };

  try {
    const res = await fetch(`${API_BASE}/transcribe-profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.detail || `Server error (HTTP ${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let completed = 0;
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const json = trimmed.slice(6);
        let event;
        try { event = JSON.parse(json); } catch { continue; }

        if (event.type === "reels_found") {
          total = event.total;
          progressText.textContent = `0 / ${total} transcribed`;
          event.reels.forEach((reel, i) => {
            reelList.appendChild(createReelCard(i, reel.title, reel.url));
          });
        }

        if (event.type === "progress") {
          const card = document.getElementById(`reel-card-${event.index}`);
          if (card) {
            const statusEl = card.querySelector(".reel-status");
            statusEl.textContent = event.status === "downloading" ? "Downloading..." : "Transcribing...";
            statusEl.className = "reel-status working";
          }
        }

        if (event.type === "result") {
          completed++;
          progressText.textContent = `${completed} / ${total} transcribed`;
          profileResultsData.push(event);

          const card = document.getElementById(`reel-card-${event.index}`);
          if (card) {
            const statusEl = card.querySelector(".reel-status");
            statusEl.textContent = "Done";
            statusEl.className = "reel-status done";
            const transcriptPre = card.querySelector(".reel-transcript");
            transcriptPre.textContent = event.transcript;
            transcriptPre.classList.remove("hidden");

            const copyReelBtn = card.querySelector(".copy-reel-btn");
            copyReelBtn.classList.remove("hidden");
          }
        }

        if (event.type === "error") {
          completed++;
          progressText.textContent = `${completed} / ${total} transcribed`;

          const card = document.getElementById(`reel-card-${event.index}`);
          if (card) {
            const statusEl = card.querySelector(".reel-status");
            statusEl.textContent = `Error: ${event.error}`;
            statusEl.className = "reel-status error";
          }
        }

        if (event.type === "done") {
          copyAllBtn.classList.remove("hidden");
        }
      }
    }
  } catch (err) {
    showError(err.message);
  } finally {
    setProfileLoading(false);
  }
});

function setProfileLoading(loading) {
  profileSubmitBtn.disabled = loading;
  profileBtnText.textContent = loading ? "Working..." : "Transcribe";
  profileBtnSpinner.classList.toggle("hidden", !loading);
  statusEl.classList.toggle("hidden", !loading);

  if (loading) {
    statusText.textContent = "Processing profile reels...";
  }
}

function createReelCard(index, title, url) {
  const card = document.createElement("div");
  card.className = "reel-card";
  card.id = `reel-card-${index}`;

  card.innerHTML = `
    <div class="reel-card-header">
      <div class="reel-info">
        <span class="reel-number">${index + 1}</span>
        <span class="reel-title">${escapeHtml(title)}</span>
      </div>
      <div class="reel-actions">
        <button class="copy-reel-btn copy-btn hidden" onclick="copySingleReel(${index})">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          <span>Copy</span>
        </button>
        <span class="reel-status pending">Pending</span>
      </div>
    </div>
    <pre class="reel-transcript hidden"></pre>
  `;

  return card;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ── Copy helpers ──

function copyToClipboard(text, btn, textEl) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    textEl.textContent = "Copied!";
    btn.classList.add("copied");
    setTimeout(() => { textEl.textContent = "Copy"; btn.classList.remove("copied"); }, 2000);
  }).catch(() => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    textEl.textContent = "Copied!";
    setTimeout(() => { textEl.textContent = "Copy"; }, 2000);
  });
}

window.copySingleReel = function (index) {
  const item = profileResultsData.find((r) => r.index === index);
  if (!item) return;

  const text = `Title: ${item.title}\n\n${item.transcript}`;
  const btn = document.querySelector(`#reel-card-${index} .copy-reel-btn`);
  const textEl = btn.querySelector("span");
  copyToClipboard(text, btn, textEl);
};

copyAllBtn.addEventListener("click", () => {
  if (!profileResultsData.length) return;

  const text = profileResultsData
    .map((item, i) => {
      const sep = "=".repeat(60);
      return `${sep}\n${i + 1}. ${item.title}\nURL: ${item.url}\n${sep}\n\n${item.transcript}`;
    })
    .join("\n\n\n");

  copyToClipboard(text, copyAllBtn, copyAllText);
});
