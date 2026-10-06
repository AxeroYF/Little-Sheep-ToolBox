import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {scryptSync} from 'node:crypto';
import {defaultAccount,initialAccount} from '../server/default-account';

test('public bootstrap, private hash override and explicit environment password stay separate',()=>{
  const root=mkdtempSync(join(tmpdir(),'workbox-account-'));
  try{
    mkdirSync(join(root,'config'));
    assert.deepEqual(initialAccount(root),defaultAccount);
    const local=initialAccount(root,'PrivateFixtureOnly!');
    writeFileSync(join(root,'config/account.local.json'),JSON.stringify({salt:local.salt,passwordHash:local.passwordHash}));
    assert.deepEqual(initialAccount(root),local);
    const override=initialAccount(root,'TemporaryTestPassword!');
    assert.equal(override.passwordHash,scryptSync('TemporaryTestPassword!',override.salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024}).toString('hex'));
    assert.notEqual(override.passwordHash,local.passwordHash);
    assert.throws(()=>initialAccount(root,'short'));
    writeFileSync(join(root,'config/account.local.json'),JSON.stringify({password:'must-not-be-accepted'}));
    assert.throws(()=>initialAccount(root));
  }finally{rmSync(root,{recursive:true,force:true});}
});
