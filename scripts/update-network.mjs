// Update shared app resources and the network helper without touching running hosts.
import {build} from 'esbuild';
import {mkdirSync,copyFileSync,cpSync,existsSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=join(root,'desktop-dev');
const backup=join(root,'runtime','network-before-'+new Date().toISOString().replace(/[:.]/g,'-'));
if(!existsSync(join(root,'dist/index.html')))throw new Error('Run npm run build first');
mkdirSync(backup,{recursive:true});
for(const path of ['app/server.cjs','NetworkProbe.exe'])if(existsSync(join(output,path))){mkdirSync(dirname(join(backup,path)),{recursive:true});copyFileSync(join(output,path),join(backup,path));}
cpSync(join(output,'app/dist'),join(backup,'app/dist'),{recursive:true});
const probe=join(root,'runtime/NetworkProbe-new.exe');
execFileSync(join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/optimize+','/platform:x64','/target:exe','/r:System.dll','/r:System.Core.dll','/r:System.Web.Extensions.dll','/out:'+probe,join(root,'desktop/NetworkProbe.cs')],{stdio:'inherit'});
await build({entryPoints:[join(root,'server/index.ts')],outfile:join(output,'app/server.cjs'),bundle:true,platform:'node',format:'cjs',target:'node22',external:['better-sqlite3']});
// Keep old hashed assets so already-open windows can finish loading their version.
cpSync(join(root,'dist'),join(output,'app/dist'),{recursive:true});
copyFileSync(probe,join(output,'NetworkProbe.exe'));
console.log(JSON.stringify({updated:output,backup,hosts:'unchanged'}));
