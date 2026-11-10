'use strict';
const {spawnSync}=require('node:child_process');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const base=fs.mkdtempSync(path.join(os.tmpdir(),'nazuna-integration-'));
for(const phase of ['1','2']) {
 const r=spawnSync(process.execPath,['tools/run-electron-test.js','tests/integration.cjs'],{stdio:'inherit',env:{...process.env,NAZUNA_TEST_ROOT:base,NAZUNA_TEST_PHASE:phase},timeout:150000});
 if(r.status!==0){process.exitCode=r.status||1;break;}
}
