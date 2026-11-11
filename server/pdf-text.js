export function reconstructPdfPage(sourceItems){
 if(sourceItems.length>20000)throw Error('O PDF tem texto demais para leitura automática. Envie o XML original.');
 const items=sourceItems.filter(item=>typeof item.str==='string'&&item.str.trim()).map(item=>({x:item.transform?.[4],y:item.transform?.[5],text:item.str.trim()}));
 let textLength=0;
 for(const item of items){
  if(!Number.isFinite(item.x)||!Number.isFinite(item.y))throw Error('O PDF contém posições de texto inválidas. Envie o XML original.');
  textLength+=item.text.length;if(textLength>2000000)throw Error('O PDF tem texto demais para leitura automática. Envie o XML original.');
 }
 items.sort((a,b)=>b.y-a.y||a.x-b.x);
 const lines=[];
 for(const item of items){
  // Descending y order means earlier baselines are already outside the tolerance.
  let line=lines.at(-1);if(!line||Math.abs(line.y-item.y)>2)lines.push(line={y:item.y,items:[]});line.items.push(item);
 }
 return lines.map(line=>line.items.sort((a,b)=>a.x-b.x).map(item=>item.text).join(' ')).join('\n');
}
