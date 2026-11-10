'use strict';
const { app, Menu, webContents, powerMonitor, net } = require('electron');
const fs=require('node:fs');const path=require('node:path');const http=require('node:http');const https=require('node:https');const assert=require('node:assert/strict');const {execFileSync}=require('node:child_process');
const base=process.env.NAZUNA_TEST_ROOT;
if (!base) throw Error('Run through tests/integration-runner.cjs');
app.setPath('appData',base);delete process.env.LOCALAPPDATA;delete process.env.NAZUNA_PROFILE;
const dir=path.join(base,'Nazuna');fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(path.join(base,'downloads'),{recursive:true});
const phase=process.env.NAZUNA_TEST_PHASE || '1';
if(phase==='1') fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify({kreatorWersja:2,startup:'restore',showSuggestions:false,downloadDir:path.join(base,'downloads')}));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label='condition',ms=12000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await delay(50)}throw Error('Timeout: '+label)}
require('../src/main/index');
const W=require('../src/main/window');const data=require('../src/main/data');const downloads=require('../src/main/downloads');const safety=require('../src/main/tabSafety');const power=require('../src/main/power');
const results=[];
async function check(name,fn){await fn();results.push({name,status:'pass'});console.log('PASS',name)}
function save(){fs.writeFileSync(path.join(__dirname,'../reports',`integration-${process.env.NAZUNA_TEST_LABEL ? process.env.NAZUNA_TEST_LABEL+"-" : ""}${phase}.json`),JSON.stringify({phase,profile:base,results},null,2))}
let server,tlsServer;
(async()=>{
 await until(()=>W.allWindows()[0]?.win.isVisible(),'initial window');
 let win=W.allWindows()[0];
 if(phase==='2') {
  const expected=JSON.parse(fs.readFileSync(path.join(base,'expected.json')));
  server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Restored</title><h1>Restored fixture</h1>')});
  await new Promise(r=>server.listen(new URL(expected.origin).port,'127.0.0.1',r));
  await check('session restored after process restart with lazy background tabs',async()=>{
   await until(()=>W.allWindows().length===expected.windows.length && W.allWindows().every(w=>w._kartyGotowe));
   const actual=W.allWindows().filter(w=>!w.isPrivate).map(w=>w.tabs.map(t=>t.displayUrl));
   assert.deepEqual(actual.map(a=>a.join('|')).sort(),expected.windows.map(a=>a.join('|')).sort());
   assert(W.allWindows().some(w=>w.tabs.some(t=>t.sleeping)));
  });
  await check('bookmarks, history and cookies persist after restart',async()=>{
   assert(data.bookmarkList().some(b=>b.url===expected.bookmark));
   assert(data.searchHistory('one',100).length>0);
   assert((await win.session.cookies.get({name:'nazuna-test'})).some(c=>c.value==='persisted'));
  });
  save();server.close();app.quit();return;
 }
 server=http.createServer((req,res)=>{
  if(req.url==='/download'){res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="fixture.txt"'});res.end('Nazuna deterministic download\n');return;}
  if(req.url==='/redirect-internal'){res.writeHead(302,{Location:'nazuna://settings'});res.end();return;}
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(`<!doctype html><title>${req.url}</title><h1>Nazuna ${req.url}</h1><a id="next" href="/two">Next</a><input id="text"><div contenteditable="true" id="editor"></div><div style="height:2000px"></div>`);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const open=async(url)=>{const t=win.newTab({url});await until(()=>!t.loading&&t.wc?.getURL()===url,'load '+url);await t.wc.executeJavaScript('document.readyState');return t};
 const invoke=(method,payload={})=>win.shell.executeJavaScript(`window.nazuna.invoke(${JSON.stringify(method)},${JSON.stringify(payload)})`);
 await check('native application menu and renderer IPC',async()=>{assert(Menu.getApplicationMenu().items.some(i=>i.label==='Edycja'));assert.equal((await invoke('app.state')).windowId,win.id);});
 await check('all themes reserve macOS window controls space without shifting other platforms',async()=>{
  const layouts=await win.shell.executeJavaScript(`(()=>{
   const root=document.documentElement,theme=root.dataset.motyw,washi=root.dataset.washi,mac=root.classList.contains('mac'),results=[];
   try {
    for(const isMac of [true,false]) for(const [motyw,paper] of [['ciemny',''],['jasny',''],['mgla',''],['mgla','dzien'],['mgla','noc']]) {
     root.classList.toggle('mac',isMac);root.dataset.motyw=motyw;
     if(paper)root.dataset.washi=paper;else delete root.dataset.washi;
     results.push({isMac,motyw,paper,left:document.querySelector('#tabs').getBoundingClientRect().left});
    }
   } finally {
    root.classList.toggle('mac',mac);if(theme===undefined)delete root.dataset.motyw;else root.dataset.motyw=theme;
    if(washi===undefined)delete root.dataset.washi;else root.dataset.washi=washi;
   }
   return results;
  })()`);
  for(const layout of layouts) assert(layout.isMac ? layout.left>=82 : layout.left<20,JSON.stringify(layout));
 });
 let tab;
 await check('local page, sandbox, isolation, no Node or privileged bridge',async()=>{
  tab=await open(origin+'/one');const prefs=tab.wc.getLastWebPreferences();assert.equal(prefs.sandbox,true);assert.equal(prefs.contextIsolation,true);assert.equal(prefs.nodeIntegration,false);assert.equal(prefs.webSecurity,true);
  assert.deepEqual(await tab.wc.executeJavaScript('[typeof require,typeof process,typeof window.nazuna]'),['undefined','undefined','undefined']);
 });
 await check('navigation back/forward',async()=>{
  await tab.wc.executeJavaScript("document.querySelector('#next').click()");await until(()=>tab.url===origin+'/two'&&!tab.loading);win.goBack();await until(()=>tab.url===origin+'/one'&&!tab.loading);win.goForward();await until(()=>tab.url===origin+'/two'&&!tab.loading);
 });
 await check('Netflix scriptlets keep native toString callable and still prune ad fields',async()=>{
  const {ElectronBlocker,Request}=require('@ghostery/adblocker-electron');
  const {isolateScriptlets}=require('../src/main/adblockScriptlets');
  const engine=isolateScriptlets(ElectronBlocker.deserialize(new Uint8Array(fs.readFileSync(path.join(__dirname,'../resources/adblock.bin')))));
  const url='https://www.netflix.com/browse',request=Request.fromRawDetails({url,type:'main_frame',sourceUrl:url});
  const {scripts}=engine.getCosmeticsFilters({url,hostname:request.hostname,domain:request.domain,getInjectionRules:true});
  assert(scripts.length>1);
  const t=await open(origin+'/scriptlets');
  for(const script of scripts)await t.wc.executeJavaScript(script);
  assert.equal(await t.wc.executeJavaScript('typeof Function.prototype.toString.call(fetch)'), 'string');
  assert.equal(await t.wc.executeJavaScript('typeof proxyApplyFn'),'undefined');
  const payload=JSON.stringify({result:{adverts:[1],title:'keep'},data:{pinotPausedPlaybackPage:{},keep:true}});
  assert.deepEqual(await t.wc.executeJavaScript(`JSON.parse(${JSON.stringify(payload)})`),{result:{title:'keep'},data:{keep:true}});
  win.closeTab(t.id);
 });
 await check('IPC rejects prototype methods and malformed payloads',async()=>{
  await assert.rejects(invoke('constructor'));await assert.rejects(invoke('settings.set','invalid'));assert((await invoke('app.state')).tabs.length>0);
 });
 await check('remote navigation and redirects cannot acquire internal privileges',async()=>{
  await tab.wc.executeJavaScript("location.href='nazuna://settings'");await delay(300);assert(!tab.wc.getURL().startsWith('nazuna:'));
  await tab.wc.executeJavaScript("location.href='/redirect-internal'");await delay(500);assert(!tab.wc.getURL().startsWith('nazuna://settings'));
  await tab.wc.loadURL(origin+'/one');
 });
 await check('shell cannot navigate to remote content',async()=>{
  const before=win.shell.getURL();await win.shell.executeJavaScript(`location.href=${JSON.stringify(origin+'/hostile')}`);await delay(150);assert.equal(win.shell.getURL(),before);
 });
 await check('permissions are scoped to scheme, host and port',async()=>{
  data.setPermission(origin,'notifications','allow');
  assert.equal(await tab.wc.executeJavaScript("navigator.permissions.query({name:'notifications'}).then(p=>p.state)"),'granted');
  const second=http.createServer((_q,r)=>{r.setHeader('Content-Type','text/html');r.end('<title>Other origin</title>')});await new Promise(r=>second.listen(0,'127.0.0.1',r));
  try { const other=await open(`http://127.0.0.1:${second.address().port}/`);assert.notEqual(await other.wc.executeJavaScript("navigator.permissions.query({name:'notifications'}).then(p=>p.state)"),'granted');win.closeTab(other.id); } finally { second.close(); }
  win.selectTab(tab.id);
 });
 await check('extension content script works in sandboxed tabs without file access',async()=>{
  const extensionDir=path.join(base,'fixture-extension');fs.mkdirSync(extensionDir);
  fs.writeFileSync(path.join(extensionDir,'manifest.json'),JSON.stringify({manifest_version:3,name:'Nazuna regression fixture',version:'1.0',content_scripts:[{matches:['http://127.0.0.1/*'],js:['content.js']}]}));
  fs.writeFileSync(path.join(extensionDir,'content.js'),"document.documentElement.setAttribute('data-extension-fixture','loaded')");
  const host=win.session.extensions||win.session;
  const extension=await host.loadExtension(extensionDir,{allowFileAccess:false});
  try { await tab.wc.loadURL(origin+'/one');await until(async()=>await tab.wc.executeJavaScript("document.documentElement.getAttribute('data-extension-fixture')==='loaded'")); } finally { host.removeExtension(extension.id); }
 });
 await check('download completes to selected directory',async()=>{
  downloads.oznaczGest(tab.wc);tab.wc.downloadURL(origin+'/download');await until(()=>downloads.list().some(d=>d.state==='completed'),'download');assert.equal(fs.readFileSync(path.join(base,'downloads/fixture.txt'),'utf8'),'Nazuna deterministic download\n');
 });
 await check('history and bookmark operations',async()=>{win.selectTab(tab.id);win.toggleBookmark();assert(data.bookmarkList().some(b=>b.url===origin+'/one'));assert(data.searchHistory('one',100).length>0);});
 await check('keyboard creates, cycles and closes tabs',async()=>{
  const n=win.tabs.length;win.shell.sendInputEvent({type:'keyDown',keyCode:'t',modifiers:['meta']});await until(()=>win.tabs.length===n+1);const id=win.activeTabId;win.shell.sendInputEvent({type:'keyDown',keyCode:'Tab',modifiers:['control']});await until(()=>win.activeTabId!==id);win.selectTab(id);win.shell.sendInputEvent({type:'keyDown',keyCode:'w',modifiers:['meta']});await until(()=>win.tabs.length===n);
 });
 await check('dirty form and unfocused editor are not discarded',async()=>{
  win.selectTab(tab.id);await tab.wc.executeJavaScript("document.querySelector('#text').value='unsaved'");const other=await open(origin+'/other');assert.equal(await safety.sleepIfSafe(tab),false);
  await tab.wc.executeJavaScript("document.querySelector('#text').value=''; document.querySelector('#editor').textContent='draft'");assert.equal(await safety.sleepIfSafe(tab),false);
  await tab.wc.executeJavaScript("document.querySelector('#editor').textContent=''");win.selectTab(other.id);
 });
 await check('WebRTC protects a silent call from discard',async()=>{
  const call=await open(origin+'/call');await call.wc.executeJavaScript('window.pc=new RTCPeerConnection()');await until(()=>call.preventSleep);win.selectTab(tab.id);assert.equal(await safety.sleepIfSafe(call),false);win.closeTab(call.id);
 });
 await check('muted video stream is protected from automatic discard',async()=>{
  const video=await open(origin+'/video');
  await video.wc.executeJavaScript("(async()=>{const c=document.createElement('canvas');c.getContext('2d').fillRect(0,0,100,100);const v=document.createElement('video');v.muted=true;v.srcObject=c.captureStream(1);document.body.append(v);await v.play()})()");
  win.selectTab(tab.id);assert.equal(await safety.sleepIfSafe(video),false);win.closeTab(video.id);
 });
 await check('sleep/wake releases renderer and preserves navigation history',async()=>{
  win.selectTab(tab.id);await tab.wc.loadURL(origin+'/two');await until(()=>!tab.loading);const old=tab.wc;const n=old.navigationHistory.length();const other=await open(origin+'/keep');assert.equal(await safety.sleepIfSafe(tab),true);await until(()=>old.isDestroyed());assert.equal(tab.wc,null);win.selectTab(tab.id);await until(()=>!tab.loading&&tab.wc?.getURL()===origin+'/two');assert.equal(tab.wc.navigationHistory.length(),n);win.goBack();await until(()=>tab.url===origin+'/one'&&!tab.loading);
 });
 await check('battery, suspend and AC events adjust policy and remove prewarm',async()=>{
  win._prepareSpare();powerMonitor.emit('on-battery');assert.equal(power.state.onBattery,true);assert.equal(win._spareTab,null);assert.equal(power.sleepDelay({...power.state,memoryPressure:'normal'}),600000);powerMonitor.emit('suspend');assert(power.state.suspended);powerMonitor.emit('resume');assert(!power.state.suspended);powerMonitor.emit('on-ac');assert(!power.state.onBattery);
 });
 await check('automatic maintenance sleeps aged tabs but preserves edited forms',async()=>{
  const idle=await open(origin+'/aged');const dirty=await open(origin+'/dirty');await dirty.wc.executeJavaScript("document.querySelector('#text').value='keep me'");win.selectTab(tab.id);
  idle.lastActiveAt=dirty.lastActiveAt=Date.now()-30*60000;await W.usypianieCheck();assert(idle.sleeping);assert(!dirty.sleeping);win.closeTab(idle.id);win.closeTab(dirty.id);
 });
 await check('native fullscreen preserves toolbar and uses no cursor polling',async()=>{
  win.win.setFullScreen(true);await until(()=>win.win.isFullScreen());await delay(400);assert(win.chromeHeight()>0);assert(!win._f11Timer);win.win.setFullScreen(false);await until(()=>!win.win.isFullScreen());
 });
 await check('battery pauses decorative animation while keeping page content visible',async()=>{
  powerMonitor.emit('on-battery');const page=await open('nazuna://newtab/');
  await until(async()=>await page.wc.executeJavaScript("document.documentElement.classList.contains('energy-saving')"));
  assert.equal(await page.wc.executeJavaScript("getComputedStyle(document.querySelector('.aurora'),'::before').animationPlayState"),'paused');
  assert.equal(await page.wc.executeJavaScript("document.body.classList.contains('nt-ready')"),true);
  win.closeTab(page.id);powerMonitor.emit('on-ac');
 });
 await check('macOS kernel memory pressure is sampled',async()=>{await power.sampleMemoryPressure();assert(['normal','warning','critical'].includes(power.state.memoryPressure));});
 await check('window disposal releases owned WebContentsViews',async()=>{
  const count=webContents.getAllWebContents().length;const extra=W.createWindow({urls:[origin+'/window']});await until(()=>extra.win.isVisible());const shell=extra.shell;extra.win.close();await until(()=>!W.allWindows().includes(extra)&&shell.isDestroyed());await delay(200);assert(webContents.getAllWebContents().length<=count);
 });
 await check('private cookies/history do not leak into regular session',async()=>{
  const p=W.createWindow({isPrivate:true,urls:[origin+'/private-secret']});await until(()=>p.win.isVisible()&&!p.activeTab().loading);await p.session.cookies.set({url:origin,name:'private-only',value:'secret'});assert.equal((await win.session.cookies.get({name:'private-only'})).length,0);assert.equal(data.searchHistory('private-secret',100).length,0);const ses=p.session;p.win.close();await until(async()=>!(await ses.cookies.get({name:'private-only'})).length);
 });
 await check('HTTPS works with normal certificate validation',async()=>{const t=await open('https://example.com/');assert.equal(await t.wc.executeJavaScript('document.title'),'Example Domain');win.closeTab(t.id);});
 await check('invalid TLS certificate is rejected',async()=>{
  const key=path.join(base,'key.pem'),cert=path.join(base,'cert.pem');execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost'],{stdio:'ignore'});
  tlsServer=https.createServer({key:fs.readFileSync(key),cert:fs.readFileSync(cert)},(_q,r)=>r.end('must not load'));await new Promise(r=>tlsServer.listen(0,'127.0.0.1',r));await assert.rejects(win.session.fetch(`https://127.0.0.1:${tlsServer.address().port}/`));
 });
 await check('Launch Services URL event opens in normal window',async()=>{
  const n=win.tabs.length;app.emit('open-url',{preventDefault(){}},origin+'/os-link');await until(()=>win.tabs.length===n+1);assert.equal(win.activeTab().url,origin+'/os-link');
 });
 await check('system open-file handles local HTML and relative navigation',async()=>{
  const one=path.join(base,'local-one.html'),two=path.join(base,'local-two.html');fs.writeFileSync(one,'<title>Local One</title><a id="next" href="local-two.html">Next</a>');fs.writeFileSync(two,'<title>Local Two</title>');
  app.emit('open-file',{preventDefault(){}},one);const t=win.activeTab();await until(()=>!t.loading&&t.wc?.getURL().startsWith('file:'));
  await t.wc.executeJavaScript("document.getElementById('next').click()");await until(()=>!t.loading&&t.wc?.getURL().endsWith('local-two.html'));assert.equal(await t.wc.executeJavaScript('document.title'),'Local Two');win.closeTab(t.id);
 });
 await win.session.cookies.set({url:origin,name:'nazuna-test',value:'persisted',expirationDate:Date.now()/1000+3600});
 const extra=W.createWindow({urls:[origin+'/window2',origin+'/window3']});await until(()=>extra._kartyGotowe);W.zapamietajSesje();await data.settings.flush();
 fs.writeFileSync(path.join(base,'expected.json'),JSON.stringify({origin,windows:data.settings.get('restoreSessionOkna'),bookmark:origin+'/one'}));
 save();server.close();tlsServer?.close();
 app.once('before-quit',()=>{results.push({name:'Command+Q reaches normal shutdown and persistence',status:'pass'});save();});
 extra.shell.sendInputEvent({type:'keyDown',keyCode:'q',modifiers:['meta']});
})().catch(error=>{results.push({status:'fail',error:error.stack,state:W.allWindows().map(w=>w.tabs.map(t=>({url:t.url,error:t.errorUrl,current:t.wc?.getURL(),loading:t.loading})))});save();console.error(error);app.exit(1)});
setTimeout(()=>{console.error('Integration watchdog timeout');app.exit(2)},120000).unref();
