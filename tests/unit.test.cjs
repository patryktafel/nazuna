'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
test('scriptlet helper collisions cannot recurse through Function.toString', () => {
  const { isolateScriptlets } = require('../src/main/adblockScriptlets');
  const script = `function proxyApplyFn() {}
    proxyApplyFn.nativeToString = Function.prototype.toString;
    Function.prototype.toString = new Proxy(Function.prototype.toString, {
      apply(target, receiver) { return proxyApplyFn.nativeToString.call(receiver); }
    });`;
  const raw = { scripts: [script, script], styles: '.ad{display:none}', active: true };
  const broken = vm.createContext({});
  for (const code of raw.scripts) vm.runInContext(code, broken);
  assert.throws(() => vm.runInContext('Math.abs.toString()', broken), /call stack/);
  const engine = isolateScriptlets({ getCosmeticsFilters: () => raw });
  const result = engine.getCosmeticsFilters({});
  const fixed = vm.createContext({});
  for (const code of result.scripts) vm.runInContext(code, fixed);
  assert.match(vm.runInContext('Math.abs.toString()', fixed), /native code/);
  assert.equal(vm.runInContext('typeof proxyApplyFn', fixed), 'undefined');
  assert.equal(result.styles, raw.styles);
  assert.equal(result.active, true);
});
function load(file, mocks = {}) {
  const filename = path.resolve(__dirname, '..', file);
  const module = { exports: {} };
  const req = createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, require: n => mocks[n] || req(n), process, URL, URLSearchParams, setTimeout, clearTimeout, console, Buffer, __dirname: path.dirname(filename) }, { filename });
  return module.exports;
}
const power = load('src/main/power.js', { electron: { powerMonitor: new EventEmitter() } });
test('extension download targets the actual OS and architecture', () => {
  const extensions = load('src/main/extensions.js', {electron: {}, './data': {}});
  for (const [platform, architecture, os, arch] of [['darwin','arm64','mac','arm64'], ['win32','x64','win','x86-64'], ['linux','x64','linux','x86-64']]) {
    const params = new URL(extensions.downloadUrl('a'.repeat(32), platform, architecture)).searchParams;
    assert.equal(params.get('os'), os);
    assert.equal(params.get('arch'), arch);
    assert.equal(params.get('os_arch'), arch === 'x86-64' ? 'x86_64' : arch);
  }
});
test('macOS cache is not treated as memory pressure', () => {
  assert.equal(power.sleepDelay({memoryPressure:'normal'}, .01, 'darwin'), 1200000);
  assert.equal(power.sleepDelay({memoryPressure:'unknown'}, .01, 'darwin'), 1200000);
  assert.equal(power.sleepDelay({memoryPressure:'critical'}, .9, 'darwin'), 180000);
  assert.equal(power.sleepDelay({memoryPressure:'warning'}, .9, 'darwin'), 600000);
});
test('battery and thermal policies preserve active work but shorten idle threshold', () => {
  assert.equal(power.sleepDelay({onBattery:true}, .9, 'darwin'), 600000);
  assert.equal(power.sleepDelay({thermal:'serious'}, .9, 'darwin'), 600000);
  assert.equal(power.sleepDelay({}, .1, 'win32'), 180000);
});
const safety = require('../src/main/tabSafety');
function fakeTab(run = async () => false) {
  const frame = {executeJavaScript:run};
  return { id:1, lastActiveAt:1, owner:{activeTabId:2,scheduleSync(){}}, wc:{isDestroyed:()=>false,isCurrentlyAudible:()=>false,isBeingCaptured:()=>false,isDevToolsOpened:()=>false,getURL:()=> 'https://example.com',mainFrame:{framesInSubtree:[frame]}}, sleep(){this.sleeping=true;} };
}
test('only inactive and fully inspected tabs can sleep', async () => {
  const tab=fakeTab(); assert.equal(await safety.sleepIfSafe(tab),true); assert.equal(tab.sleeping,true);
});
for (const flag of ['audible','hadAudio','loading','preventSleep']) test(`protect ${flag}`, async () => {
  const tab=fakeTab();tab[flag]=true;assert.equal(await safety.sleepIfSafe(tab),false);
});
test('failed frame inspection keeps the tab alive', async () => {
  const tab=fakeTab(async()=>{throw Error('detached')});assert.equal(await safety.sleepIfSafe(tab),false);
});
test('dirty subframe keeps the tab alive', async () => {
  const tab=fakeTab();tab.wc.mainFrame.framesInSubtree.push({executeJavaScript:async()=>true});assert.equal(await safety.sleepIfSafe(tab),false);
});
test('focus, audio, navigation and preference changes during inspection abort discard', async () => {
  for (const mutate of [t=>t.owner.activeTabId=1,t=>t.audible=true,t=>t.lastActiveAt++,t=>t.wc.getURL=()=> 'https://changed.test']) {
    let resolve;const tab=fakeTab(()=>new Promise(r=>resolve=r));const pending=safety.sleepIfSafe(tab);mutate(tab);resolve(false);assert.equal(await pending,false);
  }
  assert.equal(await safety.sleepIfSafe(fakeTab(),()=>false),false);
});
const urls = load('src/main/urls.js', {'./constants':{SEARCH_ENGINES:{google:{search:'https://search.test/?q=%s'}}},'./data':{settings:{get:()=> 'google'}}});
test('remote pages cannot open privileged schemes', () => {
  for(const url of ['nazuna://settings','na\nzuna://settings','file:///etc/passwd','chrome://settings','javascript:alert(1)','view-source:file:///etc/passwd']) assert.equal(urls.dozwoloneZeStrony(url,'https://example.com'),false);
  assert.equal(urls.dozwoloneZeStrony('https://example.org','https://example.com'),true);
  assert.equal(urls.dozwoloneZeStrony('file:///tmp/test.html','nazuna://newtab'),true);
  assert.equal(urls.dozwoloneZeStrony('file:///tmp/other.html','file:///tmp/test.html'),true);
});
test('store serializes writes and recovers backup after corruption', async () => {
  const {Store}=require('../src/main/store');const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'nazuna-store-'));const file=path.join(dir,'settings.json');
  const store=new Store(file,{}, {kopia:true});store.set('v',1);await store.flush();store.set('v',2);await store.flush();assert.equal(JSON.parse(fs.readFileSync(file)).v,2);
  fs.writeFileSync(file,'broken');assert.equal(new Store(file,{}, {kopia:true}).get('v'),1);
  fs.rmSync(dir,{recursive:true});
});
test('macOS bookmark discovery uses Application Support and preserves nested data', () => {
  if(process.platform!=='darwin') return;
  const os=require('node:os');const home=fs.mkdtempSync(path.join(os.tmpdir(),'nazuna-import-'));
  const profile=path.join(home,'Library/Application Support/Google/Chrome/Default');fs.mkdirSync(profile,{recursive:true});
  fs.writeFileSync(path.join(profile,'Bookmarks'),JSON.stringify({roots:{bookmark_bar:{children:[{type:'url',name:'Fixture',url:'https://example.com/'}]},other:{children:[]}}}));
  const importer=load('src/main/importzakladek.js',{'os':{...os,homedir:()=>home},'./data':{}});
  assert(importer.wykryj().some(p=>p.id==='chrome:Default'));
  fs.rmSync(home,{recursive:true});
});
test('build fallback without castLabs resolves to npm Electron without recursion', () => {
  const config=require('../electron-builder.config');
  assert.equal(config.electronDist,'node_modules/electron/dist');
});

test('permissions distinguish ports without denying valid extension origins', () => {
  assert.equal(urls.permissionOrigin('https://example.com:443/path'), 'https://example.com');
  assert.equal(urls.permissionOrigin('http://example.com:8080/path'), 'http://example.com:8080');
  assert.equal(urls.permissionOrigin('chrome-extension://abcdefghijklmnop/options.html'), 'chrome-extension://abcdefghijklmnop');
  assert.equal(urls.permissionOrigin('nazuna://settings/'), 'nazuna://settings');
  assert.equal(urls.permissionOrigin('file:///tmp/test.html'), '');
  assert.equal(urls.permissionOrigin('data:text/html,test'), '');
});
