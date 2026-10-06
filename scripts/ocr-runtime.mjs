import {readFileSync,writeFileSync,copyFileSync,cpSync,existsSync,mkdirSync,readdirSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
// Copy only the CLI's actual PE import closure, excluding training tools and installers.
function imports(file){const b=readFileSync(file),pe=b.readUInt32LE(0x3c),opt=pe+24,count=b.readUInt16LE(pe+6),sections=opt+b.readUInt16LE(pe+20),directory=opt+(b.readUInt16LE(opt)===0x20b?112:96),rva=b.readUInt32LE(directory+8);
  const offset=r=>{for(let i=0;i<count;i++){const p=sections+i*40,base=b.readUInt32LE(p+12),size=Math.max(b.readUInt32LE(p+8),b.readUInt32LE(p+16));if(r>=base&&r<base+size)return b.readUInt32LE(p+20)+r-base;}throw Error('Invalid PE section');};
  if(!rva)return [];const names=[];for(let p=offset(rva);b.readUInt32LE(p+12);p+=20){const at=offset(b.readUInt32LE(p+12));names.push(b.toString('ascii',at,b.indexOf(0,at)));}return names;
}
export function copyOcrRuntime(root,output){
  const vendor=join(root,'vendor/Tesseract-5.5.3'),archive=join(root,'vendor/integrations-download/tesseract-5.5.3.exe');
  const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
  if(!existsSync(archive)||hash(archive)!=='bee9e3434bd94fd65387d9be28cd467a41f61b1275383b55b0f59a1331270ae4')throw Error('Verified Tesseract 5.5.3 package required');
  const target=join(output,'components/Tesseract-5.5.3');mkdirSync(join(target,'tessdata'),{recursive:true});
  const files=new Map(readdirSync(vendor).map(n=>[n.toLowerCase(),n])),copied=new Set();
  function copy(name){name=files.get(name.toLowerCase());if(!name||copied.has(name))return;copied.add(name);const path=join(vendor,name);copyFileSync(path,join(target,name));for(const dependency of imports(path))copy(dependency);}
  copy('tesseract.exe');
  const models={};for(const language of ['eng','chi_sim','osd']){const name=language+'.traineddata',path=join(vendor,'tessdata',name);models[language]=hash(path);copyFileSync(path,join(target,'tessdata',name));}
  cpSync(join(vendor,'doc'),join(target,'doc'),{recursive:true});
  const legal=join(output,'third-party/Tesseract-5.5.3');mkdirSync(legal,{recursive:true});
  cpSync(join(vendor,'doc'),join(legal,'doc'),{recursive:true});
  for(const file of ['LICENSE-models','LICENSE-leptonica'])if(existsSync(join(vendor,file)))copyFileSync(join(vendor,file),join(legal,file));
  writeFileSync(join(target,'version.json'),JSON.stringify({version:'5.5.3',source:'https://github.com/tesseract-ocr/tesseract/releases/tag/5.5.3',modelSource:'https://github.com/tesseract-ocr/tessdata_fast/tree/87416418657359cb625c412a48b6e1d6d41c29bd',models,files:[...copied]},null,2));
  console.log(`Tesseract runtime: ${copied.size} binaries, 3 language models`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');copyOcrRuntime(root,join(root,'desktop-dev'));}
