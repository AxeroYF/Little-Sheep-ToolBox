// Public development account; local overrides and existing databases remain private.
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes,scryptSync} from 'node:crypto';
export const defaultAccount={username:'小羊',displayName:'小羊',salt:'4eaa8bc6f5fd2cbdd0f5b71705b98580',passwordHash:'5697642a35eb15630d3f6e618cb49293753526ac7b4d8798c2e0ef44bcd797e5ee2fc6343086d0be51134c7bb3de895e96091e28747b4c4ef8d7a1de9e7900a4'};
export type InitialAccount=typeof defaultAccount;
export function initialAccount(root:string,password?:string):InitialAccount {
  if(password!==undefined){
    if(password.length<8||password.length>128)throw new Error('WORKBOX_INITIAL_PASSWORD must contain 8–128 characters');
    const salt=randomBytes(16).toString('hex');
    return {...defaultAccount,salt,passwordHash:scryptSync(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024}).toString('hex')};
  }
  const file=resolve(root,'config/account.local.json');
  if(!existsSync(file))return defaultAccount;
  const local=JSON.parse(readFileSync(file,'utf8'));
  if(typeof local.salt!=='string'||!/^[a-f0-9]{16,128}$/i.test(local.salt)||typeof local.passwordHash!=='string'||!/^[a-f0-9]{128}$/i.test(local.passwordHash))throw new Error('Invalid local account configuration');
  return {...defaultAccount,salt:local.salt,passwordHash:local.passwordHash};
}
