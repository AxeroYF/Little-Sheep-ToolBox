// Refresh the shared local application resources without closing native windows.
import {build} from 'esbuild';
import {mkdirSync,copyFileSync,cpSync,existsSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {copyImageRuntime} from './image-runtime.mjs';
import {execFileSync} from 'node:child_process';
import {copyOcrRuntime} from './ocr-runtime.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=join(root,'desktop-dev');
const backup=join(root,'runtime','app-before-'+new Date().toISOString().replace(/[:.]/g,'-'));
if(!existsSync(join(root,'dist/index.html')))throw new Error('Run npm run build first');
mkdirSync(join(backup,'app'),{recursive:true});
copyFileSync(join(output,'app/server.cjs'),join(backup,'app/server.cjs'));
cpSync(join(output,'app/dist'),join(backup,'app/dist'),{recursive:true});
cpSync(join(output,'app/config'),join(backup,'app/config'),{recursive:true});
const staged=join(backup,'new-server.cjs');
await build({entryPoints:[join(root,'server/index.ts')],outfile:staged,bundle:true,platform:'node',format:'cjs',target:'node22',external:['better-sqlite3','sharp']});
copyImageRuntime(root,output);
copyOcrRuntime(root,output);
execFileSync(process.execPath,[join(root,'scripts/build-raw-host.mjs')],{stdio:'inherit'});
execFileSync(process.execPath,[join(root,'scripts/build-computer-host.mjs'),'--probe-only'],{stdio:'inherit'});
execFileSync(process.execPath,[join(root,'scripts/build-managed-hosts.mjs')],{stdio:'inherit'});
// Retain old hashed assets for windows that already loaded the earlier version.
cpSync(join(root,'dist'),join(output,'app/dist'),{recursive:true});
copyFileSync(staged,join(output,'app/server.cjs'));
cpSync(join(root,'config'),join(output,'app/config'),{recursive:true});
copyFileSync(join(root,'docs/THIRD-PARTY.md'),join(output,'third-party/NOTICE.md'));
console.log(JSON.stringify({updated:output,backup,hosts:'updated; existing windows keep running, reopen to load the update'}));
