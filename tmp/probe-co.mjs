const { getCompanyOverviewData } = await import('../server/services/company-overview-service.ts');
try {
  const t0 = Date.now();
  const data = await getCompanyOverviewData();
  console.log('OK in', Date.now()-t0, 'ms; keys=', Object.keys(data));
} catch (e) {
  console.error('FAIL:', e?.message);
  console.error(e?.stack?.split('\n').slice(0,15).join('\n'));
}
process.exit(0);
