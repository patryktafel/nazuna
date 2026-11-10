'use strict';
// Run with Electron, never against the user's profile. Same fixture before/after.
const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nazuna-bench-'));
fs.mkdirSync(path.join(base, 'Nazuna'));
fs.writeFileSync(path.join(base, 'Nazuna/settings.json'), JSON.stringify({ kreatorWersja: 2, showSuggestions: false }));
app.setPath('appData', base);
delete process.env.LOCALAPPDATA;
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(fn) { for (let i=0;i<300;i++) { if (fn()) return; await delay(100); } throw Error('Timeout'); }
const started = performance.now();
require('../src/main/index');
const W = require('../src/main/window');
const server = http.createServer((req,res) => {
  res.setHeader('Content-Type','text/html');
  res.end('<!doctype html><title>Nazuna fixture</title><h1>Local benchmark</h1><input><script>window.ticks=0;setInterval(()=>window.ticks++,100);window.frames=0;function tick(){window.frames++;requestAnimationFrame(tick)}tick()</script>');
});
(async () => {
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  await until(()=>W.allWindows()[0]?.win.isVisible());
  const startupMs = performance.now()-started;
  const win = W.allWindows()[0];
  if (process.env.NAZUNA_BENCH_BATTERY) require('electron').powerMonitor.emit('on-battery');
  const sample = async () => {
    win.win.show(); win.win.focus();
    app.getAppMetrics();
    await delay(5000);
    const all=[];
    for(let i=0;i<5;i++) { const metrics=app.getAppMetrics(); all.push({cpu:metrics.reduce((s,m)=>s+m.cpu.percentCPUUsage,0),rssMiB:metrics.reduce((s,m)=>s+m.memory.workingSetSize,0)/1024,processes:metrics.length}); await delay(1000); }
    return Object.fromEntries(Object.keys(all[0]).map(k=>[k,all.reduce((s,m)=>s+m[k],0)/all.length]));
  };
  const idle = await sample();
  const tabs=[];
  for(let i=0;i<12;i++) { tabs.push(win.newTab({url:`http://127.0.0.1:${server.address().port}/?tab=${i}`,background:i!==11})); }
  await until(()=>tabs.every(t=>!t.loading));
  const manyTabs = await sample();
  const visibility = await Promise.all(tabs.map(t=>t.wc.executeJavaScript('({hidden:document.hidden,ticks:window.ticks,frames:window.frames})')));
  let afterDiscard = null;
  if (process.env.NAZUNA_BENCH_DISCARD) {
    for (const t of tabs) t.lastActiveAt = Date.now() - 31 * 60e3;
    await W.usypianieCheck();
    afterDiscard = { ...(await sample()), sleeping: tabs.filter(t=>t.sleeping).length };
  }
  const result={afterDiscard,electron:process.versions.electron,arch:process.arch,simulatedBattery:!!process.env.NAZUNA_BENCH_BATTERY,startupMs,idle,manyTabs,visibility};
  const label=process.env.NAZUNA_BENCH_LABEL || 'sample';
  fs.writeFileSync(path.join(root,'reports',`${label}.json`),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
  server.close();
  app.quit();
})().catch(e=>{console.error(e);app.exit(1)});
