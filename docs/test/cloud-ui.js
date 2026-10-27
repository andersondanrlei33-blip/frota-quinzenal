import {createCloudClient} from './cloud-client.js?v=122';
import {APP_ENVIRONMENT,CLOUD_CONFIG,TEST_ACCESS_EMAIL} from './config.js?v=184';
export const cloud=createCloudClient(CLOUD_CONFIG);
export {APP_ENVIRONMENT,TEST_ACCESS_EMAIL};
export function authErrorMessage(error){
  const message=error?.message||'';
  if(/invalid login|invalid credentials/i.test(message))return 'E-mail ou senha inválidos.';
  if(/email not confirmed/i.test(message))return 'Confirme o acesso desta conta antes de entrar.';
  if(error instanceof TypeError)return 'Não foi possível conectar ao servidor. Confira a internet e tente novamente.';
  return message||'Não foi possível concluir a solicitação.';
}


