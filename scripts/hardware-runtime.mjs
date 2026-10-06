import {copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, writeFileSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
export function copyHardwareRuntime(root, output) {
  const vendor=join(root,'vendor/LibreHardwareMonitor-0.9.6'),source=join(root,'vendor/integrations-download/LibreHardwareMonitor-0.9.6-source.zip');
  const archive=join(root,'vendor/integrations-download/LibreHardwareMonitor-0.9.6.zip');
  if(!existsSync(archive)||createHash('sha256').update(readFileSync(archive)).digest('hex')!=='086d9f1b5a99e643edc2cfaaac16051685b551e4c5ac0b32a57c58c0e529c001')throw Error('Verified LibreHardwareMonitor 0.9.6 package required');
  const target=join(output,'components/hardware');mkdirSync(target,{recursive:true});
  const excluded=new Set(['Aga.Controls.dll','Microsoft.Win32.TaskScheduler.dll','OxyPlot.dll','OxyPlot.WindowsForms.dll']);
  for(const name of readdirSync(vendor))if(name.endsWith('.dll')&&!excluded.has(name))copyFileSync(join(vendor,name),join(target,name));
  copyFileSync(join(root,'desktop/HardwareTelemetry.cs'),join(target,'HardwareTelemetry.cs'));
  const legal=join(output,'third-party/LibreHardwareMonitor-0.9.6');mkdirSync(legal,{recursive:true});
  copyFileSync(source,join(legal,'source.zip'));
  const upstream=join(root,'vendor/integrations-download/lhm-source/LibreHardwareMonitor-0.9.6');
  copyFileSync(join(upstream,'LICENSE'),join(legal,'LICENSE'));
  if(existsSync(join(upstream,'Licenses')))cpSync(join(upstream,'Licenses'),join(legal,'Licenses'),{recursive:true});
  writeFileSync(join(target,'version.json'),JSON.stringify({version:'0.9.6',source:'https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/tree/v0.9.6',mode:'read-only, no driver installer'},null,2));
}
