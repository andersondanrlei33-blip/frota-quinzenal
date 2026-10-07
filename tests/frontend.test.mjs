import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {initialState,period} from '../server/engine.js';
import {createFleetApi} from '../server/api.js';

const raw=name=>fs.readFileSync(new URL('../frontend/'+name,import.meta.url),'utf8').replace(/^import .*?;\r?\n/gm,'').replace(/^export /gm,'');
const code=[raw('engine.js'),raw('reports.js'),raw('cloud-client.js'),"const CLOUD_CONFIG={url:'https://example.supabase.co',publishableKey:'public-test-key'};",raw('cloud-ui.js'),raw('app.js')].join('\n');
function domNode(){const classes=new Set();return {innerHTML:'',textContent:'',value:'',disabled:false,open:false,id:'',dataset:{},attributes:{},classList:{add:(...items)=>items.forEach(item=>classes.add(item)),remove:(...items)=>items.forEach(item=>classes.delete(item)),toggle:(item,enabled)=>enabled?classes.add(item):classes.delete(item),contains:item=>classes.has(item)},setAttribute(key,value){this.attributes[key]=value;},addEventListener(){},scrollIntoView(){},focus(){},setSelectionRange(){},showModal(){this.open=true;},close(){this.open=false;},insertAdjacentHTML(position,html){this.innerHTML+=html;}};}
async function boot(role='admin',activation=false){
  const nodes=new Map(),handlers=new Map(),get=selector=>{if(!nodes.has(selector))nodes.set(selector,domNode());return nodes.get(selector);};
  const document={body:domNode(),visibilityState:'visible',querySelector:get,querySelectorAll:()=>[],addEventListener(type,fn){if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(fn);}};get('#modal').querySelector=get;
  let stored={state:initialState(),revision:0,company:{id:'company-one',name:'Empresa de teste'}};
  const repository={async load(){return structuredClone(stored);},async version(){return stored.revision;},async commit(company,revision,state){if(revision!==stored.revision)return null;stored={...stored,state:structuredClone(state),revision:revision+1};return structuredClone(stored);}};
  const api=createFleetApi({repository,authenticate:async request=>request.headers.get('Authorization')?{userId:'test-user',companyId:'company-one',email:'user@example.test',role}:null});
  const calls=[];
  const fetch=async(url,options)=>{calls.push({url,options});if(url.endsWith('/fleet-access')){const body=JSON.parse(options.body);return Response.json(body.action==='inspect'?{firstAccess:true,email:'',companyName:'Frota'}:{companyId:'company-one',role:'admin'});}if(url.includes('/auth/v1/token'))return Response.json({access_token:'fake-jwt',refresh_token:'fake-refresh',expires_in:3600});if(url.includes('/auth/v1/logout'))return Response.json({});if(url.endsWith('/api/team'))return Response.json({members:[]});if(url.endsWith('/api/team/invite'))return Response.json({email:'staff@example.test',role:'viewer',ticket:'b'.repeat(64)});return api(new Request(url,options));};
  class FormData {constructor(form){this.values=form.data;}get(name){return this.values.get(name);}has(name){return this.values.has(name);}}
  const sandbox=vm.createContext({document,window:{addEventListener(){},scrollTo(){},print(){}},location:{origin:'https://fleet.test',pathname:'/',hash:activation?'#activate='+'a'.repeat(64):'#overview'},localStorage:{getItem(){throw Error('Browser data storage is forbidden');},setItem(){throw Error('Browser data storage is forbidden');}},Intl,URL,Blob,Request,Response,FormData,crypto,structuredClone,fetch,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,console});
  vm.runInContext(code,sandbox,{timeout:1000});await new Promise(resolve=>setImmediate(resolve));
  const emit=async(type,event)=>{for(const handler of handlers.get(type)||[])await handler(event);};
  const submit=async(id,data,dataset={})=>{const error=domNode(),button=domNode(),form={id,dataset,data:new Map(Object.entries(data)),querySelector:selector=>selector==='[type="submit"]'?button:error};await emit('submit',{target:form,preventDefault(){}});return error.textContent;};
  const action=async(name,id='',extra={})=>emit('click',{target:{closest:()=>({disabled:false,dataset:{action:name,id,...extra}})}});
  return {get,submit,action,calls,run:source=>vm.runInContext(source,sandbox),state:()=>structuredClone(stored)};
}
test('the online interface requires login, saves truck and payment commands on the server and survives a data reload',async()=>{
  const app=await boot();assert.match(app.get('#main').innerHTML,/Entrar no sistema/);
  assert.equal(await app.submit('access-form',{email:'user@example.test',password:'a-long-test-password'}),'');assert.match(app.get('#main').innerHTML,/Visão geral/);
  const today=app.run('today()'),month=today.slice(0,7);app.run(`currentMonth='${month}';currentHalf=1;`);
  assert.equal(await app.submit('truck-form',{plate:'ABC1D23',driver:'Motorista',carrier:'Transportador',farmId:'farm1',bodyType:'Caçamba',axles:'9',monthly:'30.000,00',start:month+'-01',end:''}),'');
  const id=app.state().state.trucks[0].id;assert.equal(app.state().state.trucks.length,1);
  app.get('#closing-farm').value='farm1';await app.action('confirm-close');const closing=app.state().state.closings[0];assert.equal(closing.rows[0].net,15000);
  assert.equal(await app.submit('payment-form',{date:today,note:'Teste'},{id}),'');assert.equal(app.state().state.closings[0].rows[0].paid.date,today);
  await app.action('cloud-refresh');assert.equal(app.run('state.closings[0].rows[0].paid.date'),today);
  await app.action('cloud-logout');assert.match(app.get('#main').innerHTML,/Entrar no sistema/);assert.equal(app.run('state.trucks.length'),0);
  assert.ok(app.calls.filter(call=>call.url.includes('/api/commands')).every(call=>call.options.cache==='no-store'));
});
test('a failed online write never changes the authoritative record or displays a saved confirmation',async()=>{
  const app=await boot('viewer');await app.submit('access-form',{email:'viewer@example.test',password:'a-long-test-password'});
  const today=app.run('today()');const error=await app.submit('truck-form',{plate:'ABC1D23',driver:'Motorista',carrier:'Transportador',farmId:'farm1',bodyType:'Caçamba',axles:'9',monthly:'30.000,00',start:today,end:''});
  assert.match(error,/consulta/);assert.equal(app.state().state.trucks.length,0);assert.doesNotMatch(app.get('#toast').textContent,/Cadastro salvo/);
});
test('first access collects company credentials and an administrator can generate a staff link',async()=>{
  const app=await boot('admin',true);assert.match(app.get('#main').innerHTML,/Configurar seu acesso/);assert.match(app.get('#main').innerHTML,/Nome da empresa/);assert.match(app.get('#main').innerHTML,/minlength="6"/);assert.match(app.get('#main').innerHTML,/pelo menos 6 caracteres/);
  assert.equal(await app.submit('access-form',{companyName:'Minha empresa',email:'user@example.test',password:'aB3!xY'}),'');
  const registration=app.calls.find(call=>call.url.endsWith('/fleet-access')&&JSON.parse(call.options.body).action==='register');assert.ok(registration);assert.equal(JSON.parse(registration.options.body).companyName,'Minha empresa');assert.equal(app.run('inviteTicket'),null);
  app.run("location.hash='#settings';render();");assert.match(app.get('#main').innerHTML,/Equipe e acesso/);
  assert.equal(await app.submit('invite-form',{email:'staff@example.test',role:'viewer'}),'');assert.match(app.get('#invite-result').innerHTML,/staff@example.test/);assert.match(app.get('#invite-result').innerHTML,/#activate=/);
});
