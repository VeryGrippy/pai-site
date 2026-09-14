const PAI_SITE = {
  version: "6.4.0-alpha.5",
  channel: "Developer Alpha",
  installerUrl: "downloads/PAISetup.exe",
  requirements: "Windows 10/11 · 64-bit",
};

document.querySelectorAll('[data-version]').forEach(el => el.textContent = PAI_SITE.version);
document.querySelectorAll('[data-channel]').forEach(el => el.textContent = PAI_SITE.channel);
document.querySelectorAll('[data-requirements]').forEach(el => el.textContent = PAI_SITE.requirements);
document.querySelectorAll('[data-download]').forEach(el => {
  el.href = PAI_SITE.installerUrl;
  el.addEventListener('click', (event) => {
    if (PAI_SITE.installerUrl.includes('PAISetup.exe')) {
      // Normal static-host behavior: if the installer has not been uploaded yet,
      // the host will return 404. This avoids fake external URLs in source.
    }
  });
});

document.querySelectorAll('[data-year]').forEach(el => el.textContent = new Date().getFullYear());
