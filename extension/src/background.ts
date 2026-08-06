// Service worker: makes the toolbar icon open the side panel instead of a popup.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    // setPanelBehavior is only available on Chrome 116+; older Chrome falls back to
    // the default_path already declared in manifest.json, which chrome.action still opens.
  });
});
