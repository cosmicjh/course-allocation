export const GITHUB_ORIGIN='https://cosmicjh.github.io';
export const GITHUB_SITE=GITHUB_ORIGIN+'/course-allocation/';
export const CLOUDFLARE_API='https://course-allocation.pages.dev/api';

export function resolveApiBase(base,href){
  const page=new URL(href),api=new URL(base||'/api',page);
  const trustedExternal=page.origin===GITHUB_ORIGIN&&api.href===CLOUDFLARE_API;
  if(api.username||api.password||api.search||api.hash||(api.origin!==page.origin&&!trustedExternal))
    throw new Error('허용되지 않은 API 주소입니다.');
  return api.href;
}
