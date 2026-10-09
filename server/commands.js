import {initialState,validateState,validateTruck,validateDiscount,saveClosing,reopenClosing,reopenForInvoice,reopenTruckClosing,discountLocked,period,validDate,today,uid,transferTruck,endActivities,removeFarm,setFarmActive,applyFixedMonthlyRule,overlaps,normalizePaymentDetails} from './engine.js';
import {authorizePortalCommand,requestPayments,cancelRequest,recordRequestedPayment,undoRequestedPayment,protectPortalBackup} from './payment-portal.js';
import {createFunding,attachFundingReceipt,recordFunding,cancelFunding} from './funding.js';

const adminActions=new Set(['farms.save','farm.remove','farm.status','backup.import','examples.load','examples.remove','receipt.settings.save']);
const allowedRoles=new Set(['admin','operator']);
const text=(value,max=100)=>{if(typeof value!=='string'||value.trim().length>max)throw Error('Confira os campos de texto.');return value.trim();};
function requireRecord(list,id,label,key='id'){const record=list.find(item=>item[key]===id);if(!record)throw Error(label+' não encontrado.');return record;}

export function executeCommand(input,command,actor,context={}){
  if(!actor?.userId||!allowedRoles.has(actor.role))throw Error('Você não tem permissão para alterar os registros.');
  if(!command||typeof command.type!=='string'||!command.payload||typeof command.payload!=='object'||Array.isArray(command.payload))throw Error('Comando inválido.');
  if(adminActions.has(command.type)&&actor.role!=='admin')throw Error('Esta ação exige um administrador.');
  authorizePortalCommand(command,actor);
  const state=validateState(input),p=command.payload;
  switch(command.type){
    case 'truck.save':{
      const id=p.id||uid(),prior=state.trucks.find(item=>item.id===id);
      const truck={id,plate:text(p.plate,7),driver:text(p.driver),carrier:text(p.carrier),farmId:text(p.farmId),bodyType:p.bodyType,axles:p.axles,monthly:p.monthly,start:p.start,end:p.end||'',paymentDetails:p.paymentDetails===undefined?prior?.paymentDetails||null:normalizePaymentDetails(p.paymentDetails),...(prior?.sample?{sample:true}:{}),...(prior?.transferIn?{transferIn:prior.transferIn}:{}),...(prior?.transferOut?{transferOut:prior.transferOut}:{}),...(prior?.serviceEnded?{serviceEnded:prior.serviceEnded}:{})};
      validateTruck(truck,state,true);const index=state.trucks.findIndex(item=>item.id===id);if(index<0)state.trucks.push(truck);else state.trucks[index]=truck;break;
    }
    case 'discount.save':{
      const discount={id:p.id||uid(),truckId:text(p.truckId),start:p.start,end:p.end,reason:p.reason,note:text(p.note||'',300),...(p.kind===undefined?{}:{kind:p.kind}),...(p.amount===undefined?{}:{amount:p.amount})};
      validateDiscount(discount,state);const index=state.discounts.findIndex(item=>item.id===discount.id);if(index<0)state.discounts.push(discount);else state.discounts[index]=discount;break;
    }
    case 'discount.remove':{
      const discount=requireRecord(state.discounts,p.id,'Desconto');if(discountLocked(discount,state))throw Error('Reabra a quinzena antes de excluir este desconto.');state.discounts=state.discounts.filter(item=>item.id!==p.id);break;
    }
    case 'discount.reopen':{
      const discount=requireRecord(state.discounts,p.id,'Desconto');
      if(!['edit','delete'].includes(p.operation))throw Error('Escolha editar ou excluir o desconto.');
      const scopes=state.closings.flatMap(closing=>{
        const row=closing.rows.find(item=>item.truckId===discount.truckId);
        return row&&overlaps(closing.period.start,closing.period.end,discount.start,discount.end)?[{period:closing.period,farmId:row.farmId,id:closing.id,rows:closing.rows.filter(item=>item.farmId===row.farmId)}]:[];
      });
      if(scopes.some(scope=>scope.rows.some(row=>row.paid)))throw Error('Revise os pagamentos registrados antes de reabrir este desconto.');
      for(const scope of scopes)reopenClosing(state,scope.period,scope.farmId,scope.id);
      if(p.operation==='delete')state.discounts=state.discounts.filter(item=>item.id!==p.id);break;
    }
    case 'period.close':saveClosing(state,period(p.month,p.half),p.farmId||'');break;
    case 'period.close-complementary':{const selectedPeriod=period(p.month,p.half),farmId=text(p.farmId,100);reopenForInvoice(state,selectedPeriod,farmId);saveClosing(state,selectedPeriod,farmId);break;}
    case 'period.reopen':reopenClosing(state,period(p.month,p.half),p.farmId||'',p.closingId||'');break;
    case 'period.reopen-invoice':reopenForInvoice(state,period(p.month,p.half),p.farmId||'');break;
    case 'period.reopen-truck':reopenTruckClosing(state,period(p.month,p.half),p.closingId,text(p.truckId,100));break;
    case 'receipt.settings.save':{
      const fields={groupName:120,carrierLegalName:160,carrierDocument:24,carrierAddress:240,bankName:100,bankAgency:40,bankAccount:60,recipientName:160,recipientDocument:24,recipientRegistration:40,recipientAddress:240,cityState:100,logisticsSigner:120,authorizationSigner:120};
      const source=p.profile;if(!source||typeof source!=='object'||Array.isArray(source))throw Error('Confira os dados do recibo padrão.');
      const profile={};for(const [key,max] of Object.entries(fields)){const value=source[key]??'';if(typeof value!=='string'||value.trim().length>max)throw Error('Confira o campo '+key+' do recibo.');profile[key]=value.trim();}
      state.settings.receiptProfile=profile;break;
    }
    case 'payment.request':requestPayments(state,p,actor);break;
    case 'payment.cancel':cancelRequest(state,p.requestId,text(p.note||'',300),actor);break;
    case 'payment.record':recordRequestedPayment(state,p,actor,context.receipt);break;
    case 'payment.undo':undoRequestedPayment(state,p,actor);break;
    case 'funding.create':createFunding(state,p,actor);break;
    case 'funding.receipt':attachFundingReceipt(state,p,actor,context.fundingReceipt);break;
    case 'funding.record':recordFunding(state,p,actor);break;
    case 'funding.cancel':cancelFunding(state,p,actor);break;
    case 'truck.transfer':transferTruck(state,p.id,p.toFarmId,p.date,text(p.note||'',300));break;
    case 'truck.end':endActivities(state,p.id,p.date,text(p.note||'',300));break;
    case 'farms.save':{
      if(!Array.isArray(p.farms)||!p.farms.length)throw Error('Cadastre pelo menos uma fazenda.');
      if(state.farms.some(farm=>!p.farms.some(item=>item.id===farm.id)))throw Error('Use Remover ou Inativar para alterar a lista de fazendas.');
      const farms=p.farms.map(item=>({...(state.farms.find(farm=>farm.id===item.id)||{}),id:item.id||uid(),name:text(item.name,80)}));
      if(farms.some(item=>!item.name)||new Set(farms.map(item=>item.name.toLocaleLowerCase('pt-BR'))).size!==farms.length)throw Error('Preencha nomes diferentes para cada fazenda.');state.farms=farms;break;
    }
    case 'farm.remove':removeFarm(state,p.id);break;
    case 'farm.status':setFarmActive(state,p.id,p.active);break;
    case 'backup.import':{
      const restored=applyFixedMonthlyRule(validateState(p.state));protectPortalBackup(state,restored);Object.assign(state,restored);break;
    }
    case 'examples.load':{
      if(state.trucks.length)throw Error('Os exemplos exigem um cadastro de caminhões vazio.');
      const farms=state.farms.filter(farm=>farm.active!==false);if(!farms.length)throw Error('Cadastre ou reative uma fazenda antes de carregar exemplos.');
      const month=period(p.month,1).month,a=uid(),b=uid(),c=uid();
      state.trucks=[{id:a,plate:'TST1A01',driver:'Motorista de exemplo 1',carrier:'Transportadora de exemplo',farmId:farms[0].id,bodyType:'Caçamba',axles:7,monthly:40000,start:month+'-01',end:'',sample:true},{id:b,plate:'TST2B02',driver:'Motorista de exemplo 2',carrier:'Transportadora de exemplo',farmId:farms[0].id,bodyType:'Graneleiro',axles:9,monthly:35000,start:month+'-06',end:'',sample:true},{id:c,plate:'TST3C03',driver:'Motorista de exemplo 3',carrier:'Contratado de exemplo',farmId:(farms[1]||farms[0]).id,bodyType:'Caçamba',axles:9,monthly:42000,start:month+'-01',end:month+'-11',sample:true}];
      state.discounts=[{id:uid(),truckId:a,start:month+'-08',end:month+'-09',reason:'Falta',note:'Exemplo: dois dias de falta.'},{id:uid(),truckId:b,start:month+'-12',end:month+'-12',reason:'Oficina',note:'Exemplo: manutenção.'}];break;
    }
    case 'examples.remove':{
      const ids=new Set(state.trucks.filter(truck=>truck.sample).map(truck=>truck.id));
      if(state.closings.some(closing=>closing.rows.some(row=>ids.has(row.truckId))))throw Error('Reabra os fechamentos dos exemplos antes de removê-los.');
      state.trucks=state.trucks.filter(truck=>!ids.has(truck.id));state.discounts=state.discounts.filter(discount=>!ids.has(discount.truckId));break;
    }
    default:throw Error('Ação não reconhecida.');
  }
  applyFixedMonthlyRule(state);state.updatedAt=new Date().toISOString();validateState(state);
  return {state,audit:{action:command.type,actorId:actor.userId,at:state.updatedAt}};
}

