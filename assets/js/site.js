const PAI_SITE = {
  defaultChannel: "developer",
  requirements: "Windows 10/11 · 64-bit",
  releaseBaseUrl: "https://verygrippy.github.io/pai-site",
  manifestCandidates(channel) {
    return [
      `${this.releaseBaseUrl}/${channel}/latest.json`,
      `${channel}/latest.json`,
      `updates/${channel}/latest.json`,
    ];
  },
};

const CHANNEL_LABELS = {
  developer: "Developer Alpha",
  beta: "Beta",
  stable: "Stable",
};

function setText(selector, value) {
  document.querySelectorAll(selector).forEach(el => { el.textContent = value; });
}

function setStatus(message, kind = "normal") {
  document.querySelectorAll("[data-release-status]").forEach(el => {
    el.textContent = message;
    el.dataset.state = kind;
  });
}

function enableDownloads(url, filename) {
  document.querySelectorAll("[data-download]").forEach(el => {
    el.href = url;
    el.removeAttribute("aria-disabled");
    el.classList.remove("disabled");
    el.removeAttribute("title");
    if (filename) el.setAttribute("download", filename);
  });
}

async function fetchManifest(channel) {
  let lastError;
  for (const url of PAI_SITE.manifestCandidates(channel)) {
    try {
      const response = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return { manifest: await response.json(), source: url };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Release manifest unavailable");
}

async function loadRelease() {
  const channel = document.documentElement.dataset.releaseChannel || PAI_SITE.defaultChannel;
  setText("[data-requirements]", PAI_SITE.requirements);
  setText("[data-channel]", CHANNEL_LABELS[channel] || channel);

  try {
    const { manifest } = await fetchManifest(channel);
    if (!manifest.version) throw new Error("Manifest is missing version");

    const channelLabel = CHANNEL_LABELS[manifest.channel] || manifest.channel || CHANNEL_LABELS[channel];
    setText("[data-version]", manifest.version);
    setText("[data-channel]", channelLabel);
    setText("[data-release-notes]", manifest.release_notes || "Current PAI release.");

    const downloadUrl = manifest.installer_url || manifest.package_url;
    if (downloadUrl) {
      const filename = downloadUrl.split("/").pop().split("?")[0]
        || (manifest.installer_url ? `PAISetup-${manifest.version}.exe` : `PAI-${manifest.version}-windows-x64.zip`);
      enableDownloads(downloadUrl, filename);
    }

    setStatus(`Current ${channelLabel} · ${manifest.version}`, "ready");
  } catch (error) {
    console.error("PAI release lookup failed:", error);
    setText("[data-version]", "6.9.0-alpha.7");
    setStatus("Live release lookup unavailable; showing the latest published alpha information.", "warning");
  }
}

function setupNavigation() {
  const toggle = document.querySelector(".mobile-toggle");
  const nav = document.querySelector(".nav-links");
  if (!toggle || !nav) return;

  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });

  nav.querySelectorAll("a").forEach(link => {
    link.addEventListener("click", () => {
      nav.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    });
  });
}

function setupReveal() {
  const items = document.querySelectorAll("[data-reveal]");
  if (!items.length) return;

  if (!("IntersectionObserver" in window)) {
    items.forEach(item => item.classList.add("revealed"));
    return;
  }

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("revealed");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.08, rootMargin: "0px 0px -40px" });

  items.forEach(item => observer.observe(item));
}

document.querySelectorAll("[data-year]").forEach(el => {
  el.textContent = new Date().getFullYear();
});

setupNavigation();
setupReveal();
loadRelease();
