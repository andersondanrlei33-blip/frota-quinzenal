import test from 'node:test';
import assert from 'node:assert/strict';
import {passwordValue} from '../server/supabase-adapter.js';
test('new passwords accept six characters and reject fewer characters and oversized byte values',()=>{
  assert.equal(passwordValue('aB3!xY'),'aB3!xY');
  assert.equal(passwordValue('abcdefghijkl'),'abcdefghijkl');
  for(const value of ['','12345',null,123456])assert.throws(()=>passwordValue(value),/6 caracteres/);
  assert.equal(passwordValue('a'.repeat(72)).length,72);
  assert.throws(()=>passwordValue('a'.repeat(73)),/limite/);
  assert.throws(()=>passwordValue('ç'.repeat(37)),/limite/);
});
