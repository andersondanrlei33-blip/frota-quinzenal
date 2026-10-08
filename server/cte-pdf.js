if(!globalThis.DOMMatrix){
 globalThis.DOMMatrix=class TextOnlyDOMMatrix{
  constructor(values){const matrix=Array.isArray(values)?values:[1,0,0,1,0,0];[this.a,this.b,this.c,this.d,this.e,this.f]=matrix.map(Number);this.a??=1;this.b??=0;this.c??=0;this.d??=1;this.e??=0;this.f??=0;this.is2D=true;}
 };
}
const pdfjs=await import('npm:pdfjs-dist@5.6.205/legacy/build/pdf.mjs');

export async function extractCtePdfText(bytes){
 const task=pdfjs.getDocument({data:bytes,disableWorker:true,disableFontFace:true,useSystemFonts:true,isEvalSupported:false,verbosity:0});
 let document;
 try{
  document=await task.promise;
  if(document.numPages>10)throw Error('O PDF tem páginas demais para um DACTE. Envie somente o documento do CT-e.');
  const pages=[];
  for(let pageNumber=1;pageNumber<=document.numPages;pageNumber++){
   const page=await document.getPage(pageNumber),content=await page.getTextContent();
   const items=content.items.filter(item=>typeof item.str==='string'&&item.str.trim()).map(item=>({x:item.transform[4],y:item.transform[5],text:item.str.trim()})).sort((a,b)=>b.y-a.y||a.x-b.x);
   const lines=[];
   for(const item of items){let line=lines.find(candidate=>Math.abs(candidate.y-item.y)<=2);if(!line)lines.push(line={y:item.y,items:[]});line.items.push(item);}
   pages.push(lines.sort((a,b)=>b.y-a.y).map(line=>line.items.sort((a,b)=>a.x-b.x).map(item=>item.text).join(' ')).join('\n'));
  }
  return pages.join('\n');
 }finally{
  if(document)await document.destroy();else await task.destroy();
 }
}
