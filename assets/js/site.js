const PAI_SITE = {
  defaultChannel: "developer",
  requirements: "Windows 10/11 · 64-bit",
  manifestCandidates(channel) {
    return [`${channel}/latest.json`, `updates/${channel}/latest.json`];
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
  document.querySelectorAll('[data-release-status]').forEach(el => {
    el.textContent = message;
    el.dataset.state = kind;
  });
}

function disableDownloads(message) {
  document.querySelectorAll('[data-download]').forEach(el => {
    el.removeAttribute('href');
    el.setAttribute('aria-disabled', 'true');
    el.classList.add('disabled');
    el.title = message;
  });
}

function enableDownloads(url, filename) {
  document.querySelectorAll('[data-download]').forEach(el => {
    el.href = url;
    el.removeAttribute('aria-disabled');
    el.classList.remove('disabled');
    el.removeAttribute('title');
    if (filename) el.setAttribute('download', filename);
  });
}

async function fetchManifest(channel) {
  let lastError;
  for (const url of PAI_SITE.manifestCandidates(channel)) {
    try {
      const response = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const manifest = await response.json();
      return { manifest, source: url };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Release manifest unavailable');
}

async function loadRelease() {
  const channel = document.documentElement.dataset.releaseChannel || PAI_SITE.defaultChannel;
  setText('[data-requirements]', PAI_SITE.requirements);
  setText('[data-channel]', CHANNEL_LABELS[channel] || channel);
  setStatus('Checking current release…');
  disableDownloads('Checking current PAI release');

  try {
    const { manifest } = await fetchManifest(channel);
    if (!manifest.version) throw new Error('Manifest is missing version');

    setText('[data-version]', manifest.version);
    setText('[data-channel]', CHANNEL_LABELS[manifest.channel] || manifest.channel || CHANNEL_LABELS[channel]);
    setText('[data-release-notes]', manifest.release_notes || 'Current PAI release.');

    const installerUrl = manifest.installer_url;
    if (!installerUrl) {
      setStatus('Release is live, but the Windows installer has not been published yet.', 'warning');
      disableDownloads('Installer not yet published for this release');
      return;
    }

    const filename = installerUrl.split('/').pop().split('?')[0] || `PAISetup-${manifest.version}.exe`;
    enableDownloads(installerUrl, filename);
    setStatus(`Current ${CHANNEL_LABELS[manifest.channel] || manifest.channel || 'release'} · ${manifest.version}`, 'ready');
  } catch (error) {
    console.error('PAI release lookup failed:', error);
    setText('[data-version]', 'Unavailable');
    setStatus('Unable to reach the PAI release service. Please try again shortly.', 'error');
    disableDownloads('Release service unavailable');
  }
}

document.querySelectorAll('[data-year]').forEach(el => el.textContent = new Date().getFullYear());
loadRelease();
