'use strict';
const { powerMonitor } = require('electron');
const { execFile } = require('node:child_process');

const state = { onBattery: false, thermal: 'unknown', suspended: false, memoryPressure: 'unknown' };
let started = false;
let sampling = null;
const listeners = new Set();
function notify() { for (const fn of listeners) fn({ ...state }); }
function start(fn) {
  if (fn) listeners.add(fn);
  if (started) return;
  started = true;
  try { state.onBattery = powerMonitor.isOnBatteryPower(); } catch (_) {}
  try { state.thermal = powerMonitor.getCurrentThermalState(); } catch (_) {}
  powerMonitor.on('on-battery', () => { state.onBattery = true; notify(); });
  powerMonitor.on('on-ac', () => { state.onBattery = false; notify(); });
  powerMonitor.on('thermal-state-change', ({ state: thermal }) => { state.thermal = thermal; notify(); });
  powerMonitor.on('suspend', () => { state.suspended = true; notify(); });
  powerMonitor.on('resume', () => { state.suspended = false; notify(); });
}

// Read the kernel's pressure level, not unused RAM: macOS uses spare RAM as cache.
// Reuse the tab-maintenance tick; never spawn a shell or add another polling timer.
function sampleMemoryPressure() {
  if (process.platform !== 'darwin') return Promise.resolve();
  if (sampling) return sampling;
  sampling = new Promise(resolve => {
    execFile('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], { timeout: 1500, maxBuffer: 128 }, (err, stdout) => {
      state.memoryPressure = err ? 'unknown' : ({ 1: 'normal', 2: 'warning', 4: 'critical' }[String(stdout).trim()] || 'unknown');
      resolve();
    });
  }).finally(() => { sampling = null; });
  return sampling;
}
function saving(s = state) { return s.onBattery || ['serious', 'critical'].includes(s.thermal); }
function sleepDelay(s = state, free = 1, platform = process.platform) {
  if (s.memoryPressure === 'critical') return 3 * 60e3;
  if (s.memoryPressure === 'warning') return 10 * 60e3;
  // Unknown pressure on macOS must not mistake a healthy file cache for an OOM.
  if (platform !== 'darwin') {
    if (free <= .15) return 3 * 60e3;
    if (free <= .35) return 10 * 60e3;
  }
  return (saving(s) ? 10 : 20) * 60e3;
}
module.exports = { state, start, saving, sleepDelay, sampleMemoryPressure };
