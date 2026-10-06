import {mkdirSync,copyFileSync,existsSync,writeFileSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=join(root,'vendor/LibRaw-0.22.2/LibRaw-0.22.2');
if(!existsSync(join(source,'bin/libraw.dll')))throw Error('Prepare the official LibRaw 0.22.2 Windows package first.');
const target=join(root,'desktop-dev/components/LibRaw-0.22.2');mkdirSync(target,{recursive:true});
function sameFile(a,b){return existsSync(b)&&readFileSync(a).equals(readFileSync(b));}
for(const name of ['LICENSE.LGPL','LICENSE.CDDL','COPYRIGHT'])copyFileSync(join(source,name),join(target,name));
// UI/service-only updates should not replace identical DLLs while RAW decoding is active.
if(!sameFile(join(source,'bin/libraw.dll'),join(target,'libraw.dll')))copyFileSync(join(source,'bin/libraw.dll'),join(target,'libraw.dll'));
if(process.argv.includes('--force')||!existsSync(join(target,'RawPhoto.exe'))||!sameFile(join(root,'desktop/RawPhoto.cs'),join(target,'RawPhoto.cs')))
  execFileSync(join(process.env.WINDIR??'C:/Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/optimize+','/platform:x64','/target:exe',`/out:${join(target,'RawPhoto.exe')}`,'/r:System.dll','/r:System.Core.dll','/r:System.Web.Extensions.dll',join(root,'desktop/RawPhoto.cs')],{stdio:'inherit'});
copyFileSync(join(root,'desktop/RawPhoto.cs'),join(target,'RawPhoto.cs'));
const notices=join(root,'desktop-dev/third-party');mkdirSync(notices,{recursive:true});
// Official archive includes the exact matching source and build materials, not just binaries.
copyFileSync(join(root,'vendor/LibRaw-0.22.2-Win64.zip'),join(notices,'LibRaw-0.22.2-Win64-with-source.zip'));
copyFileSync(join(root,'docs/THIRD-PARTY.md'),join(notices,'NOTICE.md'));
writeFileSync(join(target,'RawPhoto.exe.config'),'<?xml version="1.0"?><configuration><startup><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.8"/></startup></configuration>');
console.log('Built '+join(target,'RawPhoto.exe'));
