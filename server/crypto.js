import {stretchPassword,newSalt} from '../shared/password.js';
const encoder = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
export const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export async function digest(value) { return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value))); }
export function validHash(value) { return /^pbkdf2-hmac-sha256\$100000\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(value || ''); }
export function publicParameters(credential){return {algorithm:'PBKDF2-SHA-256',iterations:100000,salt:credential.password_hash.split('$')[2],epoch:credential.epoch};}
export async function credentialFromProof(proof,salt,kind,pepper){
  if(!/^[a-f0-9]{64}$/.test(proof)||!/^[a-f0-9]{32}$/.test(salt)||!/^[a-f0-9]{64}$/.test(pepper))throw new Error('Invalid credential material');
  const key=await crypto.subtle.importKey('raw',encoder.encode(pepper),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const verifier=hex(await crypto.subtle.sign('HMAC',key,encoder.encode(kind+':'+salt+':'+proof)));
  return `pbkdf2-hmac-sha256$100000$${salt}$${verifier}`;
}
// Provisioning runs only in local setup/CLI/tests, never in a Functions request.
export async function provisionCredential(password,pepper,kind='access'){
  const salt=newSalt();return credentialFromProof(await stretchPassword(password,{salt}),salt,kind,pepper);
}
export async function passwordMatches(proof,stored,pepper,kind) {
  if (typeof proof!=='string'||!/^[a-f0-9]{64}$/.test(proof)||!validHash(stored))return false;
  const actual=await credentialFromProof(proof,stored.split('$')[2],kind,pepper);
  let difference = actual.length ^ stored.length;
  for (let i=0;i<stored.length;i++) difference |= actual.charCodeAt(i) ^ stored.charCodeAt(i);
  return difference === 0;
}
