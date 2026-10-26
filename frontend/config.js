const environments={
  production:{url:"https://cktgwqkhdqvjvesefssm.supabase.co",publishableKey:"sb_publishable_EIltWlEqSzO4WmdZrrA0uA_855MS2v0",functionName:'fleet-api'},
  test:{url:"https://slkxujlrqebzzwdoptla.supabase.co",publishableKey:"sb_publishable_5BKjv7H4KoTs99B9Xc13ag_D3WITUiZ",functionName:'fleet-api'}
};
export const APP_ENVIRONMENT=new URLSearchParams(globalThis.location?.search||'').get('ambiente')==='teste'?'test':'production';
export const TEST_ACCESS_EMAIL='andersondanrlei33@gmail.com';
export const CLOUD_CONFIG=environments[APP_ENVIRONMENT];
if(typeof document!=='undefined')document.documentElement.dataset.environment=APP_ENVIRONMENT;
