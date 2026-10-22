import {initialState,validateState,validateTruck,validateDiscount,saveClosing,closingPreview,splitClosingsByFarm,reopenClosing,reopenForInvoice,reopenTruckClosing,discountLocked,period,validDate,today,uid,transferTruck,undoTransfer,endActivities,removeFarm,setFarmActive,applyFixedMonthlyRule,overlaps,normalizePaymentDetails,paymentDetailsMissing,validatePaymentDetails,allocateInvoiceNumber} from './engine.js';
import {authorizePortalCommand,requestPayments,cancelRequest,recordRequestedPayment,recordRequestedPaymentBatch,undoRequestedPayment,protectPortalBackup} from './payment-portal.js';
import {createFunding,attachFundingReceipt,recordFunding,cancelFunding} from './funding.js';

const adminActions=new Set(['farms.save','farm.remove','farm.status','backup.import','receipt.settings.save']);
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
      const id=p.id||uid(),prior=state.trucks.find(item=>item.id===id),farmId=text(p.farmId),paymentAccountId=text(p.paymentAccountId||'',100),account=paymentAccountId?requireRecord(state.paymentAccounts,paymentAccountId,'Conta de pagamento'):null;
      if(prior?.paymentAccountId&&prior.paymentAccountId!==paymentAccountId)throw Error('Esta placa já pertence a uma conta de pagamento. Edite o vínculo atual para liberá-la antes de alterar a conta.');
      let paymentDetails=account?structuredClone(account.details):p.paymentDetails===undefined?prior?.paymentDetails||null:normalizePaymentDetails(p.paymentDetails),linkedAccountId=paymentAccountId;
      if(!linkedAccountId&&paymentDetails&&!paymentDetailsMissing(paymentDetails).length){validatePaymentDetails(paymentDetails,true);linkedAccountId=uid();const generatedName=('Conta de '+paymentDetails.holder).slice(0,80);state.paymentAccounts.push({id:linkedAccountId,name:text(p.paymentAccountName||generatedName,80),details:structuredClone(paymentDetails)});}
      const truck={id,plate:text(p.plate,7),driver:text(p.driver),carrier:text(p.carrier),farmId,bodyType:p.bodyType,axles:p.axles,monthly:p.monthly,start:p.start,end:p.end||'',cteAllFarms:p.cteAllFarms===true,paymentAccountId:linkedAccountId,paymentDetails,...(prior?.sample?{sample:true}:{}),...(prior?.transferIn?{transferIn:prior.transferIn}:{}),...(prior?.transferOut?{transferOut:prior.transferOut}:{}),...(prior?.serviceEnded?{serviceEnded:prior.serviceEnded}:{})};
      validateTruck(truck,state,true);const index=state.trucks.findIndex(item=>item.id===id);if(index<0)state.trucks.push(truck);else state.trucks[index]=truck;break;
    }
    case 'payment-account.save':{
      const id=text(p.id||uid(),100),name=text(p.name,80),details=normalizePaymentDetails(p.details),truckIds=[...new Set(p.truckIds||[])];
      if(!details||!name)throw Error('Informe um nome e os dados da conta de pagamento.');validatePaymentDetails(details,true);
      if(!Array.isArray(p.truckIds)||p.truckIds.length>500)throw Error('Confira as placas selecionadas para esta conta.');
      const trucks=truckIds.map(truckId=>requireRecord(state.trucks,truckId,'Caminhão'));if(trucks.some(truck=>truck.transferOut))throw Error('Selecione o cadastro atual de cada placa, após a transferência.');
      const existing=state.paymentAccounts.find(account=>account.id===id),alreadyLinked=trucks.find(truck=>truck.paymentAccountId&&truck.paymentAccountId!==id);if(alreadyLinked)throw Error(`A placa ${alreadyLinked.plate} já está vinculada a outra conta. Edite o vínculo atual para liberá-la antes de criar outro.`);const account={id,name,details};if(existing){Object.assign(existing,account);delete existing.farmId;}else state.paymentAccounts.push(account);
      for(const truck of state.trucks)if(truck.paymentAccountId===id&&!truckIds.includes(truck.id)&&!truck.transferOut)truck.paymentAccountId='';for(const truck of trucks){truck.paymentAccountId=id;truck.paymentDetails=structuredClone(details);}break;
    }
    case 'payment-account.remove':{
      const account=requireRecord(state.paymentAccounts,p.id,'Conta de pagamento');if(state.trucks.some(truck=>truck.paymentAccountId===account.id&&!truck.transferOut))throw Error('Desvincule as placas atuais desta conta antes de excluí-la.');for(const truck of state.trucks)if(truck.paymentAccountId===account.id)truck.paymentAccountId='';state.paymentAccounts=state.paymentAccounts.filter(item=>item.id!==account.id);break;
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
    case 'period.close':{
      const selectedPeriod=period(p.month,p.half);
      if(p.farmId)saveClosing(state,selectedPeriod,p.farmId);
      else{const preview=closingPreview(state,selectedPeriod),farmIds=[...new Set(preview.rows.map(row=>row.farmId))];if(!farmIds.length)throw Error('Não há caminhões pendentes para fechar nesta quinzena.');for(const farmId of farmIds)saveClosing(state,selectedPeriod,farmId);}
      break;
    }
    case 'invoice.split-by-farm':splitClosingsByFarm(state);break;
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
    case 'payment.record-batch':recordRequestedPaymentBatch(state,p,actor,context.receipt);break;
    case 'payment.undo':undoRequestedPayment(state,p,actor);break;
    case 'funding.create':createFunding(state,p,actor);break;
    case 'funding.receipt':attachFundingReceipt(state,p,actor,context.fundingReceipt);break;
    case 'funding.record':recordFunding(state,p,actor);break;
    case 'funding.cancel':cancelFunding(state,p,actor);break;
    case 'truck.transfer':transferTruck(state,p.id,p.toFarmId,p.date,text(p.note||'',300));break;
    case 'truck.transfer.undo':{
      if(context.transferUndoFiscalClear!==true)throw Error('Não foi possível confirmar se há solicitações de CT-e ou documentos no destino.');
      undoTransfer(state,text(p.id,100));break;
    }
    case 'truck.end':endActivities(state,p.id,p.date,text(p.note||'',300));break;
    case 'farms.save':{
      if(!Array.isArray(p.farms)||!p.farms.length)throw Error('Cadastre pelo menos uma fazenda.');
      if(state.farms.some(farm=>!p.farms.some(item=>item.id===farm.id)))throw Error('Use Remover ou Inativar para alterar a lista de fazendas.');
      const profileFields={legalName:120,stateRegistration:30,address:180,contactName:100,contactPhone:30};
      const farms=p.farms.map(item=>{
        const existing=state.farms.find(farm=>farm.id===item.id)||{};
        const sourceCpf=Object.hasOwn(item,'cpf')?item.cpf:existing.cpf||'';
        const sourceCnpj=Object.hasOwn(item,'cnpj')?item.cnpj:existing.cnpj||'';
        const cnpjDigits=String(sourceCnpj||'').replace(/\D/g,'');
        const cpf=text(sourceCpf||(cnpjDigits.length===11?sourceCnpj:''),14);
        const cnpj=cnpjDigits.length===14?text(sourceCnpj,24):'';
        if(cnpjDigits&&![11,14].includes(cnpjDigits.length))throw Error('Informe um CNPJ válido para o titular da fazenda.');
        const farm={...existing,id:item.id||uid(),name:text(item.name,80),cpf,...Object.fromEntries(Object.entries(profileFields).map(([key,max])=>[key,text(item[key]||'',max)]))};
        if(cnpj)farm.cnpj=cnpj;else delete farm.cnpj;
        return farm;
      });
      const normalizeStateRegistration=value=>String(value||'').toLocaleUpperCase('pt-BR').replace(/[\s./-]/g,'');
      for(const farm of farms){
        const registration=normalizeStateRegistration(farm.stateRegistration);
        if(!registration||['ISENTO','NAOCONTRIBUINTE'].includes(registration))continue;
        const previous=state.farms.find(saved=>saved.id===farm.id),previousRegistration=normalizeStateRegistration(previous?.stateRegistration);
        if(registration===previousRegistration)continue;
        const other=farms.find(saved=>saved.id!==farm.id&&normalizeStateRegistration(saved.stateRegistration)===registration);
        if(other)throw Error(`A inscrição estadual já está cadastrada para ${other.name}. Confira o cadastro das fazendas.`);
      }
      if(farms.some(item=>!item.name)||new Set(farms.map(item=>item.name.toLocaleLowerCase('pt-BR'))).size!==farms.length)throw Error('Preencha nomes diferentes para cada fazenda.');state.farms=farms;break;
    }
    case 'farm.remove':removeFarm(state,p.id);break;
    case 'farm.status':setFarmActive(state,p.id,p.active);break;
    case 'backup.import':{
      const restored=applyFixedMonthlyRule(validateState(p.state));protectPortalBackup(state,restored);
      const previousById=new Map(state.closings.map(closing=>[closing.id,closing]));restored.nextInvoiceNumber=Math.max(state.nextInvoiceNumber||1,restored.nextInvoiceNumber||1);
      for(const closing of restored.closings){const previous=previousById.get(closing.id);if(previous)closing.invoiceNumber=previous.invoiceNumber;else closing.invoiceNumber=allocateInvoiceNumber(restored);}
      Object.assign(state,restored);break;
    }
    default:throw Error('Ação não reconhecida.');
  }
  applyFixedMonthlyRule(state);state.updatedAt=new Date().toISOString();validateState(state);
  return {state,audit:{action:command.type,actorId:actor.userId,at:state.updatedAt}};
}



