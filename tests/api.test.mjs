import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,transferTruck} from '../server/engine.js';
import {createFleetApi} from '../server/api.js';
const accounts={a:{userId:'a',companyId:'company-one',role:'admin'},b:{userId:'b',companyId:'company-one',role:'operator'},viewer:{userId:'viewer',companyId:'company-one',role:'viewer'},other:{userId:'other',companyId:'company-two',role:'admin'}};
function setup(){
  const storage=new Map(),audit=[];
  const repository={async load(id){if(!storage.has(id))storage.set(id,{state:initialState(),revision:0});return structuredClone(storage.get(id));},async version(id){return (await this.load(id)).revision;},async commit(id,revision,state,event){if(storage.get(id).revision!==revision)return null;const next={state:structuredClone(state),revision:revision+1};storage.set(id,next);audit.push({...event,companyId:id});return structuredClone(next);}};
  const authenticate=async request=>accounts[request.headers.get('Authorization')?.replace('Bearer ','')]||null;
  return {api:createFleetApi({repository,authenticate}),repository,audit};
}
const req=(user,path='/api/state',payload)=>new Request('https://fleet.test'+path,{method:payload?'POST':'GET',headers:{...(user?{Authorization:'Bearer '+user}:{}),...(payload?{'Content-Type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined});
test('data are shared by two authorized users and isolated from another company',async()=>{
  const {api,audit}=setup();const command={type:'farms.save',payload:{farms:[...initialState().farms,{id:'new-farm',name:'Nova fazenda'}]},expectedRevision:0};
  assert.equal((await api(req('a','/api/commands',command))).status,200);
  const colleague=await (await api(req('b'))).json();assert.equal(colleague.state.farms.length,5);assert.equal(colleague.revision,1);
  const other=await (await api(req('other'))).json();assert.equal(other.state.farms.length,4);assert.equal(other.revision,0);assert.equal(audit[0].actorId,'a');
});
test('anonymous access and viewer writes are denied and responses prevent caching company records',async()=>{
  const {api}=setup();assert.equal((await api(req(null))).status,401);const read=await api(req('viewer'));assert.equal(read.status,200);assert.equal(read.headers.get('Cache-Control'),'private, no-store');
  assert.equal((await api(req('viewer','/api/commands',{type:'farm.remove',payload:{id:'farm4'},expectedRevision:0}))).status,403);
});
test('concurrent edits cannot overwrite the first saved update with an old revision',async()=>{
  const {api}=setup(),command={type:'farm.status',payload:{id:'farm4',active:false},expectedRevision:0};
  assert.equal((await api(req('a','/api/commands',command))).status,200);
  const stale={...command,payload:{id:'farm4',active:true}};assert.equal((await api(req('a','/api/commands',stale))).status,409);
  const read=await (await api(req('b'))).json();assert.equal(read.state.farms[3].active,false);assert.equal(read.revision,1);
});
test('transfer undo checks fiscal activity on the server before removing a destination period',async()=>{
  const {api,repository,audit}=setup(),company='company-one';
  const initial=await repository.load(company);
  initial.state.trucks=[{id:'source',plate:'ABC1D23',driver:'Motorista',carrier:'Transportador',farmId:'farm1',bodyType:'Caçamba',axles:9,monthly:30000,start:'2026-10-01',end:''}];
  transferTruck(initial.state,'source','farm2','2026-10-10','','destination');
  await repository.commit(company,0,initial.state,{action:'fixture',actorId:'a'});
  let checked=0,hasFiscal=true;
  repository.hasTruckFiscalActivity=async(id,truckId)=>{assert.equal(id,company);assert.equal(truckId,'destination');checked++;return hasFiscal;};
  const command={type:'truck.transfer.undo',payload:{id:'destination'},expectedRevision:1};
  const blocked=await api(req('a','/api/commands',command));
  assert.equal(blocked.status,400);
  assert.match((await blocked.json()).error,/CT-e/);
  assert.equal((await repository.load(company)).revision,1);
  hasFiscal=false;
  const accepted=await api(req('a','/api/commands',command));
  assert.equal(accepted.status,200);
  const after=await accepted.json();
  assert.equal(after.state.trucks.length,1);
  assert.equal(after.state.trucks[0].farmId,'farm1');
  assert.equal(after.state.trucks[0].end,'');
  assert.equal(checked,2);
  assert.equal(audit.at(-1).action,'truck.transfer.undo');
});
