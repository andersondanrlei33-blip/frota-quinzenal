import test from 'node:test';
import assert from 'node:assert/strict';
import {readLimitedJson} from '../server/request-body.js';

test('bounded reader accepts valid JSON split across UTF-8 chunks',async()=>{
  const bytes=new TextEncoder().encode('{"note":"café"}');
  const request=new Request('https://example.test/',{method:'POST',duplex:'half',body:new ReadableStream({
    start(controller){controller.enqueue(bytes.subarray(0,13));controller.enqueue(bytes.subarray(13));controller.close();}
  })});
  assert.deepEqual(await readLimitedJson(request),{note:'café'});
});

test('bounded reader cancels an oversized streaming body',async()=>{
  let cancelled=false;
  const request=new Request('https://example.test/',{method:'POST',duplex:'half',body:new ReadableStream({
    pull(controller){controller.enqueue(new TextEncoder().encode('{"a":"'+ 'x'.repeat(5000)));},
    cancel(){cancelled=true;}
  })});
  await assert.rejects(readLimitedJson(request),error=>error.status===413);
  assert.equal(cancelled,true);
});

test('bounded reader rejects a declared oversized body before reading it',async()=>{
  let pulled=false;
  const request={headers:new Headers({'content-length':'12001'}),get body(){pulled=true;throw Error('Body was read');}};
  await assert.rejects(readLimitedJson(request),error=>error.status===413);
  assert.equal(pulled,false);
});
