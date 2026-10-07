import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
test('the deployed assets use the authoritative engine and store only the tab session in the browser',()=>{
  execFileSync(process.execPath,[new URL('../scripts/build.mjs',import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, '$1')]);
  const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
  for(const name of ['app.js','engine.js','reports.js','styles.css','cloud-client.js','cloud-ui.js','config.js','index.html'])assert.equal(read('docs/'+name),read('frontend/'+name));
  assert.equal(read('frontend/engine.js'),read('server/engine.js'));
  assert.doesNotMatch(read('docs/app.js'),/localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(read('docs/cloud-client.js'),/localStorage|indexedDB/);
  assert.match(read('docs/cloud-client.js'),/sessionStorage/);
  const version=read('docs/index.html').match(/app\.js\?v=(\d+)/)?.[1];assert.ok(version);
  assert.match(read('docs/cloud-ui.js'),new RegExp('config\\.js\\?v='+version+'\\b'));
});
