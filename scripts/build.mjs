import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
fs.copyFileSync(path.join(root,'server/engine.js'),path.join(root,'frontend/engine.js'));
const names=['index.html','app.js','engine.js','reports.js','styles.css','cloud-client.js','cloud-ui.js','config.js'];
fs.mkdirSync(path.join(root,'docs'),{recursive:true});
for(const name of names)fs.copyFileSync(path.join(root,'frontend',name),path.join(root,'docs',name));
fs.writeFileSync(path.join(root,'docs/.nojekyll'),'');
console.log('Site online preparado em docs/.');
