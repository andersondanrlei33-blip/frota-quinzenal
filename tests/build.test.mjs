import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
test('the deployed assets use the authoritative engine, include cloud modules and contain no persistent browser data storage',()=>{
  execFileSync(process.execPath,[new URL('../scripts/build.mjs',import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, '$1')]);
  const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
  for(const name of ['app.js','engine.js','reports.js','styles.css','cloud-client.js','cloud-ui.js','config.js','index.html'])assert.equal(read('docs/'+name),read('frontend/'+name));
  assert.equal(read('frontend/engine.js'),read('server/engine.js'));
  assert.doesNotMatch(read('docs/app.js')+read('docs/cloud-client.js'),/localStorage|sessionStorage|indexedDB/);
  assert.match(read('docs/index.html'),/app.js\?v=22/);assert.match(read('docs/cloud-ui.js'),/config.js\?v=22/);
});
