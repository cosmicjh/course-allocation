import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {provisionCredential,passwordMatches,publicParameters,randomToken} from '../server/crypto.js';
import {stretchPassword} from '../shared/password.js';
test('client-stretched proof is verified with a separate server pepper and role',async()=>{
  const pepper=randomToken(),stored=await provisionCredential('virtual-password',pepper,'access');
  const parameters=publicParameters({password_hash:stored,epoch:1}),proof=await stretchPassword('virtual-password',parameters);
  assert.ok(await passwordMatches(proof,stored,pepper,'access'));
  assert.equal(await passwordMatches('virtual-password',stored,pepper,'access'),false);
  assert.equal(await passwordMatches(stored.split('$')[3],stored,pepper,'access'),false);
  assert.equal(await passwordMatches(proof,stored,randomToken(),'access'),false);
  assert.equal(await passwordMatches(proof,stored,pepper,'admin'),false);
});
test('production Functions bundle does not perform the slow password KDF',async()=>{
  const built=await build({entryPoints:['functions/api/[[path]].js'],bundle:true,format:'esm',platform:'browser',write:false});
  assert.doesNotMatch(built.outputFiles[0].text,/deriveBits/);
});
