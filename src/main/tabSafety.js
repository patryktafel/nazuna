'use strict';
// A failed/changed frame is not evidence that it has no unsaved work.
const CHECK_ACTIVITY = `(() => {
  try {
    if (document.pictureInPictureElement) return true;
    for (const el of document.querySelectorAll('audio,video')) {
      if (!el.paused || el.currentTime > 0 || el.srcObject) return true;
    }
    for (const el of document.querySelectorAll('input,textarea')) {
      const t = (el.type || '').toLowerCase();
      if (t === 'file') { if (el.files && el.files.length) return true; continue; }
      if (['hidden','submit','button','image','reset'].includes(t)) continue;
      if (t === 'checkbox' || t === 'radio') { if (el.checked !== el.defaultChecked) return true; }
      else if (el.value !== el.defaultValue) return true;
    }
    for (const el of document.querySelectorAll('select')) {
      for (const o of el.options) if (o.selected !== o.defaultSelected) return true;
    }
    // Conservative for editors even after focus leaves the editable element.
    for (const el of document.querySelectorAll('[contenteditable]')) {
      if (el.isContentEditable && (el.textContent || '').trim()) return true;
    }
    return navigator.locks ? navigator.locks.query().then(s => s.held.length > 0, () => true) : false;
  } catch (_) { return true; }
})()`;
function eligible(tab) {
  if (!tab.owner || tab.sleeping || !tab.wc || tab.wc.isDestroyed()) return false;
  if (tab.id === tab.owner.activeTabId || tab.audible || tab.hadAudio || tab.loading || tab.preventSleep) return false;
  try { if (tab.wc.isCurrentlyAudible() || tab.wc.isBeingCaptured() || tab.wc.isDevToolsOpened()) return false; } catch (_) { return false; }
  return true;
}
async function sleepIfSafe(tab, stillEligible = () => true) {
  if (!eligible(tab) || tab._sleepCheck) return false;
  const wc = tab.wc;
  const url = wc.getURL();
  const lastActiveAt = tab.lastActiveAt;
  tab._sleepCheck = true;
  let timer;
  try {
    const frames = wc.mainFrame.framesInSubtree;
    if (!frames.length) return false;
    const result = await Promise.race([
      Promise.all(frames.map(f => f.executeJavaScript(CHECK_ACTIVITY).catch(() => true))),
      new Promise(resolve => { timer = setTimeout(() => resolve([true]), 2000); timer.unref?.(); })
    ]);
    if (result.some(Boolean) || !eligible(tab) || !stillEligible() || tab.wc !== wc || wc.getURL() !== url || tab.lastActiveAt !== lastActiveAt) return false;
    const current = wc.mainFrame.framesInSubtree;
    if (current.length !== frames.length || current.some((f,i) => f !== frames[i])) return false;
    tab.sleep();
    tab.owner.scheduleSync();
    return true;
  } catch (_) { return false; }
  finally { clearTimeout(timer); tab._sleepCheck = false; }
}
module.exports = { eligible, sleepIfSafe, CHECK_ACTIVITY };
