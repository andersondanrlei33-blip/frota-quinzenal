import {reconstructPdfPage} from './pdf-text.js';
if(!globalThis.DOMMatrix){
 globalThis.DOMMatrix=class TextOnlyDOMMatrix{
  constructor(values){const matrix=Array.isArray(values)?values:[1,0,0,1,0,0];[this.a,this.b,this.c,this.d,this.e,this.f]=matrix.map(Number);this.a??=1;this.b??=0;this.c??=0;this.d??=1;this.e??=0;this.f??=0;this.is2D=true;}
 };
}
const pdfjs=await import('npm:pdfjs-dist@6.4.299/legacy/build/pdf.mjs');

export async function extractCtePdfText(bytes){
 const task=pdfjs.getDocument({data:bytes,disableWorker:true,disableFontFace:true,useSystemFonts:true,isEvalSupported:false,verbosity:0});
 let document;
 try{
  document=await task.promise;
  if(document.numPages>10)throw Error('O PDF tem páginas demais para um DACTE. Envie somente o documento do CT-e.');
  const pages=[];let itemCount=0,textLength=0;
  for(let pageNumber=1;pageNumber<=document.numPages;pageNumber++){
   const page=await document.getPage(pageNumber),content=await page.getTextContent();
   itemCount+=content.items.length;
   if(itemCount>50000)throw Error('O PDF tem texto demais para leitura automática. Envie o XML original.');
   const text=reconstructPdfPage(content.items);textLength+=text.length;
   if(textLength>2000000)throw Error('O PDF tem texto demais para leitura automática. Envie o XML original.');
   pages.push(text);
  }
  return pages.join('\n');
 }finally{
  await task.destroy();
 }
}
