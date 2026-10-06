import {cpSync,existsSync,mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';

// Keep native libraries dynamically linked, with their original notices and licenses.
export function copyImageRuntime(root, output) {
  const copied=new Set();
  function copy(name, optional=false) {
    if(copied.has(name)) return;
    const source=join(root,'node_modules',name),manifest=join(source,'package.json');
    if(!existsSync(manifest)) {if(optional)return;throw Error('Missing image dependency: '+name);}
    const pkg=JSON.parse(readFileSync(manifest,'utf8'));
    if(pkg.os && !pkg.os.includes('win32')) return;
    if(pkg.cpu && !pkg.cpu.includes('x64')) return;
    copied.add(name);
    const target=join(output,'app/node_modules',name);mkdirSync(target,{recursive:true});
    cpSync(source,target,{recursive:true});
    for(const dep of Object.keys(pkg.dependencies??{})) copy(dep);
    for(const dep of Object.keys(pkg.optionalDependencies??{})) copy(dep,true);
  }
  copy('sharp');
  if(!copied.has('@img/sharp-win32-x64')) throw Error('Windows x64 sharp runtime is missing');
  return [...copied];
}
