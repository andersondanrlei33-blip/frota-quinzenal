export async function readLimitedJson(request,maxChars=4000){
  // UTF-8 can use up to three bytes per UTF-16 code unit. Bound bytes before decoding.
  const maxBytes=maxChars*3;
  const declared=Number(request.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>maxBytes)throw Object.assign(Error('Pedido muito grande.'),{status:413});
  const reader=request.body?.getReader();
  if(!reader)return JSON.parse('');
  const decoder=new TextDecoder();
  let text='',bytes=0;
  try{
    while(true){
      const {value,done}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>maxBytes){void reader.cancel().catch(()=>{});throw Object.assign(Error('Pedido muito grande.'),{status:413});}
      text+=decoder.decode(value,{stream:true});
      if(text.length>maxChars){void reader.cancel().catch(()=>{});throw Object.assign(Error('Pedido muito grande.'),{status:413});}
    }
    text+=decoder.decode();
    if(text.length>maxChars)throw Object.assign(Error('Pedido muito grande.'),{status:413});
    return JSON.parse(text);
  }finally{reader.releaseLock();}
}
