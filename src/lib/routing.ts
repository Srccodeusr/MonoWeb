export interface RouteState {
  page: string;
  params: Record<string, any>;
}

export function parseUrlToRoute(pathname: string, search: string): RouteState {
  const searchParams = new URLSearchParams(search);
  const queryObj: Record<string, any> = {};
  searchParams.forEach((val, key) => {
    queryObj[key] = val;
  });

  const pathParts = pathname.split('/').filter(Boolean);

  if (pathParts.length === 0) {
    return { page: 'home', params: queryObj };
  }

  const first = pathParts[0].toLowerCase();

  // Public pages
  if (first === 'home') return { page: 'home', params: queryObj };
  if (first === 'vps') return { page: 'vps', params: queryObj };
  if (first === 'bot') return { page: 'bot', params: queryObj };
  if (first === 'pricing') return { page: 'pricing', params: queryObj };
  if (first === 'status') return { page: 'status', params: queryObj };
  if (first === 'docs') return { page: 'docs', params: queryObj };
  if (first === 'terms' || first === 'tos') return { page: 'terms', params: { ...queryObj, initialSlug: 'terms' } };
  if (first === 'privacy') return { page: 'privacy', params: { ...queryObj, initialSlug: 'privacy' } };
  if (first === 'acceptable-use' || first === 'aup') return { page: 'acceptable-use', params: { ...queryObj, initialSlug: 'acceptable-use' } };
  if (first === 'legal') {
    const slug = pathParts[1] || 'terms';
    return { page: 'legal', params: { ...queryObj, initialSlug: slug } };
  }

  // Auth pages
  if (first === 'login') return { page: 'login', params: queryObj };
  if (first === 'register') return { page: 'register', params: queryObj };

  // Customer pages
  if (first === 'dashboard') return { page: 'dashboard', params: queryObj };
  if (first === 'billing') return { page: 'billing', params: queryObj };
  if (first === 'checkout') return { page: 'checkout', params: queryObj };
  if (first === 'support') return { page: 'support', params: queryObj };
  if (first === 'mail') return { page: 'mail', params: queryObj };
  if (first === 'activity') return { page: 'activity', params: queryObj };
  if (first === 'settings') return { page: 'settings', params: queryObj };

  // Admin pages: /admin, /admin/users, /admin/products, etc.
  if (first === 'admin') {
    if (pathParts.length === 1) return { page: 'admin-dashboard', params: queryObj };
    const sub = pathParts[1].toLowerCase();
    if (sub === 'dashboard') return { page: 'admin-dashboard', params: queryObj };
    if (sub === 'users') return { page: 'admin-users', params: queryObj };
    if (sub === 'products' || sub === 'plans') return { page: 'admin-products', params: queryObj };
    if (sub === 'billing' || sub === 'payments') return { page: 'admin-billing', params: queryObj };
    if (sub === 'coupons') return { page: 'admin-coupons', params: queryObj };
    if (sub === 'announcements') return { page: 'admin-announcements', params: queryObj };
    if (sub === 'ads') return { page: 'admin-ads', params: queryObj };
    if (sub === 'discord' || sub === 'bot') return { page: 'admin-discord', params: queryObj };
    if (sub === 'panel-link' || sub === 'panel' || sub === 'panel-integration') return { page: 'admin-panel-link', params: queryObj };
    if (sub === 'appearance' || sub === 'fonts-themes' || sub === 'theme') return { page: 'admin-appearance', params: queryObj };
    if (sub === 'support') return { page: 'admin-support', params: queryObj };
    if (sub === 'mail') return { page: 'admin-mail', params: queryObj };
    if (sub === 'audit-logs' || sub === 'logs') return { page: 'admin-audit-logs', params: queryObj };
    if (sub === 'api-keys' || sub === 'keys') return { page: 'admin-api-keys', params: queryObj };
    if (sub === 'legal' || sub === 'content' || sub === 'legal-pages') return { page: 'admin-legal', params: queryObj };
    if (sub === 'settings') return { page: 'admin-settings', params: queryObj };
    return { page: 'admin-dashboard', params: queryObj };
  }

  // Default fallback
  return { page: 'home', params: queryObj };
}

export function routeToUrl(page: string, params?: Record<string, any>): string {
  const formatQuery = (pObj?: Record<string, any>, excludeKeys: string[] = []) => {
    if (!pObj) return '';
    const sp = new URLSearchParams();
    Object.entries(pObj).forEach(([k, v]) => {
      if (!excludeKeys.includes(k) && v !== undefined && v !== null && v !== '') {
        sp.set(k, String(v));
      }
    });
    const s = sp.toString();
    return s ? `?${s}` : '';
  };

  switch (page) {
    case 'home': return `/${formatQuery(params)}`;
    case 'vps': return `/vps${formatQuery(params)}`;
    case 'bot': return `/bot${formatQuery(params)}`;
    case 'pricing': return `/pricing${formatQuery(params)}`;
    case 'status': return `/status${formatQuery(params)}`;
    case 'docs': return `/docs${formatQuery(params)}`;
    case 'terms': return `/terms${formatQuery(params)}`;
    case 'privacy': return `/privacy${formatQuery(params)}`;
    case 'acceptable-use': return `/acceptable-use${formatQuery(params)}`;
    case 'legal': return `/legal${params?.initialSlug ? `/${params.initialSlug}` : ''}${formatQuery(params, ['initialSlug'])}`;
    case 'login': return `/login${formatQuery(params)}`;
    case 'register': return `/register${formatQuery(params)}`;

    case 'dashboard': return `/dashboard${formatQuery(params)}`;
    case 'billing': return `/billing${formatQuery(params)}`;
    case 'checkout': return `/checkout${formatQuery(params)}`;
    case 'support': return `/support${formatQuery(params)}`;
    case 'mail': return `/mail${formatQuery(params)}`;
    case 'activity': return `/activity${formatQuery(params)}`;
    case 'settings': return `/settings${formatQuery(params)}`;

    case 'admin-dashboard': return `/admin${formatQuery(params)}`;
    case 'admin-users': return `/admin/users${formatQuery(params)}`;
    case 'admin-products': return `/admin/products${formatQuery(params)}`;
    case 'admin-billing': return `/admin/billing${formatQuery(params)}`;
    case 'admin-coupons': return `/admin/coupons${formatQuery(params)}`;
    case 'admin-announcements': return `/admin/announcements${formatQuery(params)}`;
    case 'admin-ads': return `/admin/ads${formatQuery(params)}`;
    case 'admin-discord': return `/admin/discord${formatQuery(params)}`;
    case 'admin-panel-link': return `/admin/panel-link${formatQuery(params)}`;
    case 'admin-appearance': return `/admin/appearance${formatQuery(params)}`;
    case 'admin-legal': return `/admin/legal${formatQuery(params)}`;
    case 'admin-support': return `/admin/support${formatQuery(params)}`;
    case 'admin-mail': return `/admin/mail${formatQuery(params)}`;
    case 'admin-audit-logs': return `/admin/audit-logs${formatQuery(params)}`;
    case 'admin-api-keys': return `/admin/api-keys${formatQuery(params)}`;
    case 'admin-settings': return `/admin/settings${formatQuery(params)}`;

    default:
      return `/${formatQuery(params)}`;
  }
}
