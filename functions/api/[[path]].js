import { handleRequest } from '../../server/api.js';
export const onRequest = ({request,env}) => handleRequest(request,env);
