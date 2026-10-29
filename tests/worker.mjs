// Fixture SQL access exists only in this in-memory test worker, never the Pages bundle.
import {handleRequest} from '../server/api.js';
export default {
  async fetch(request,env){
    if(new URL(request.url).pathname==='/__virtual_fixture_sql'){
      const {sql,args=[]}=await request.json();
      const result=await env.DB.prepare(sql).bind(...args).all();return Response.json(result);
    }
    return handleRequest(request,env);
  }
};
