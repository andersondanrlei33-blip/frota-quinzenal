// Read-only checks. No response bodies, user tokens, or business records are logged.
const environment = process.argv.find(arg => arg.startsWith('--environment='))?.split('=')[1] || 'test';
if (!['test', 'production'].includes(environment)) throw Error('Choose test or production.');
globalThis.location = {search: environment === 'test' ? '?ambiente=teste' : ''};
const {APP_ENVIRONMENT, CLOUD_CONFIG} = await import('../frontend/config.js');
if (APP_ENVIRONMENT !== environment) throw Error('Environment configuration does not match.');

const tables = [
  'fleet_companies', 'fleet_members', 'fleet_records', 'fleet_audit',
  'fleet_invitations', 'fleet_receipts', 'fleet_funding_receipts',
  'fleet_cte_documents', 'fleet_cte_requests', 'fleet_cte_report_preferences',
  'fleet_cte_billing_invoices', 'fleet_cte_billing_invoice_items'
];
const routes = ['/api/state', '/api/version', '/api/team', '/api/ctes',
  '/api/cte-requests', '/api/cte-billing-invoices'];
const cases = [
  ...tables.map(table => ({label: `anonymous table ${table}`,
    path: `/rest/v1/${table}?select=${table === 'fleet_companies' ? 'id' : table === 'fleet_cte_billing_invoice_items' ? 'invoice_id' : 'company_id'}&limit=1`})),
  ...routes.map(path => ({label: `anonymous route ${path}`,
    path: `/functions/v1/${CLOUD_CONFIG.functionName}${path}`})),
  {label: 'anonymous state RPC',
    path: '/rest/v1/rpc/fleet_load_state?p_company=00000000-0000-0000-0000-000000000000'},
  {label: 'invalid user token',
    path: `/functions/v1/${CLOUD_CONFIG.functionName}/api/state`,
    authorization: 'Bearer invalid-security-check-token'}
];

let failed = 0;
for (const check of cases) {
  await new Promise(resolve => setTimeout(resolve, 650));
  try {
    const response = await fetch(new URL(check.path, CLOUD_CONFIG.url), {
      headers: {apikey: CLOUD_CONFIG.publishableKey,
        ...(check.authorization ? {Authorization: check.authorization} : {})},
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000)
    });
    await response.body?.cancel();
    const denied = [401, 403].includes(response.status);
    if (!denied) failed++;
    console.log(`${denied ? 'PASS' : 'FAIL'} ${check.label}: HTTP ${response.status}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${check.label}: ${error.name}`);
  }
}
console.log(`${cases.length - failed}/${cases.length} access checks passed in ${environment}.`);
if (failed) process.exitCode = 1;
