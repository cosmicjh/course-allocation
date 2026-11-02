import {GITHUB_ORIGIN} from '../shared/deployment.js';

export function allowedOrigin(request){
  const origin=request.headers.get('Origin');
  return !origin||origin===new URL(request.url).origin||origin===GITHUB_ORIGIN;
}
export function corsHeaders(request){
  const headers={Vary:'Origin'};
  if(request.headers.get('Origin')===GITHUB_ORIGIN){
    headers['Access-Control-Allow-Origin']=GITHUB_ORIGIN;
    headers['Access-Control-Expose-Headers']='Server-Timing, X-D1-Rows-Read, X-D1-Rows-Written, Retry-After';
  }
  return headers;
}
export function preflight(request){
  const method=request.headers.get('Access-Control-Request-Method');
  const headers=(request.headers.get('Access-Control-Request-Headers')||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
  if(!request.headers.has('Origin')||!allowedOrigin(request)||!['GET','POST','PUT'].includes(method)||headers.some(h=>!['authorization','content-type'].includes(h)))
    return new Response(null,{status:403,headers:{Vary:'Origin','Cache-Control':'no-store'}});
  return new Response(null,{status:204,headers:{...corsHeaders(request),'Access-Control-Allow-Methods':'GET, POST, PUT','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'3600','Cache-Control':'no-store'}});
}
