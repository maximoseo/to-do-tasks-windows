// Single source of truth for the app shell config.
// The Windows app is a trusted shell around the production web app.
module.exports = {
  APP_VERSION: '1.0.0',
  APP_NAME: 'Maximo ToDo',
  PROD_ORIGIN: 'https://to-do-tasks.maximo-seo.ai',
  DASHBOARD_PATH: '/dashboard?app=windows&appVersion=1.0.0',
  LOGIN_PATH: '/login?app=windows',
  // Only navigation to these hosts is allowed (security boundary).
  ALLOWED_HOSTS: ['to-do-tasks.maximo-seo.ai', 'wtpczvyupmavzrxisvcm.supabase.co'],
};
