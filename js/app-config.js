/**
 * ScanSheet - Runtime Environment & API URL Resolver
 *
 * Keeps web / Vercel deployments using relative same-origin `/api/*` paths,
 * while resolving API calls from the locally bundled Capacitor Android app
 * to the deployed Vercel HTTPS URL.
 *
 * SECURITY: Never put SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, or private API
 * secrets in this file. Only public HTTPS endpoint URLs belong here.
 */

export const AppConfig = {
  /**
   * Deployed Vercel HTTPS URL (without trailing slash).
   * Replace this placeholder or set the VERCEL_API_URL environment/repository
   * variable before running `npm run cap:prepare` or the GitHub Actions APK build.
   */
  VERCEL_API_BASE_URL: 'https://YOUR_VERCEL_APP.vercel.app',

  /**
   * Optional direct OCR endpoint override (full HTTPS URL, e.g. https://ocr.example.com/api/scan).
   * Usually supplied dynamically by Vercel's GET /api/config `ocrServerUrl` field.
   */
  OCR_API_URL: '',

  isConfiguredUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim();
    if (!trimmed) return false;
    if (trimmed.includes('YOUR_VERCEL_APP') || trimmed.includes('your-scansheet')) {
      return false;
    }
    return /^https?:\/\/[^/\s]+/i.test(trimmed);
  },

  normalizeBaseUrl(url) {
    return String(url || '').trim().replace(/\/+$/, '');
  },

  isCapacitorNative() {
    if (typeof window === 'undefined') return false;
    try {
      if (typeof window.Capacitor?.isNativePlatform === 'function') {
        return Boolean(window.Capacitor.isNativePlatform());
      }
      const protocol = window.location?.protocol || '';
      if (protocol === 'capacitor:' || protocol === 'file:') {
        return true;
      }
      const origin = window.location?.origin || '';
      return Boolean(window.Capacitor) && (origin === 'https://localhost' || origin === 'http://localhost');
    } catch (_) {
      return false;
    }
  },

  getVercelApiBaseUrl() {
    let candidate = '';
    if (typeof window !== 'undefined') {
      candidate = window.__ENV__?.VERCEL_API_BASE_URL || window.SCANSHEET_API_BASE_URL || '';
      if (!this.isConfiguredUrl(candidate)) {
        try {
          candidate = localStorage.getItem('scansheet_vercel_api_url') || '';
        } catch (_) {}
      }
    }
    if (!this.isConfiguredUrl(candidate)) {
      candidate = this.VERCEL_API_BASE_URL;
    }
    if (!this.isConfiguredUrl(candidate)) {
      return '';
    }
    return this.normalizeBaseUrl(candidate);
  },

  getOcrApiUrl() {
    let candidate = '';
    if (typeof window !== 'undefined') {
      candidate = window.PADDLE_OCR_API_URL || window.__ENV__?.OCR_API_URL || '';
      if (!this.isConfiguredUrl(candidate)) {
        try {
          candidate = localStorage.getItem('scansheet_ocr_api_url') || '';
        } catch (_) {}
      }
    }
    if (!this.isConfiguredUrl(candidate)) {
      candidate = this.OCR_API_URL;
    }
    if (!this.isConfiguredUrl(candidate)) {
      return '';
    }
    return this.normalizeBaseUrl(candidate);
  },

  /**
   * Resolves an API path like `/api/config` or `/api/scan`.
   * - Web / local server: returns relative `/api/...`
   * - Capacitor Android: returns full `https://<vercel-domain>/api/...`, or `null` if unconfigured
   */
  resolveApiUrl(apiPath) {
    const cleanPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
    if (!this.isCapacitorNative()) {
      return cleanPath;
    }
    const baseUrl = this.getVercelApiBaseUrl();
    if (!baseUrl) {
      return null;
    }
    return `${baseUrl}${cleanPath}`;
  },

  getPasswordResetRedirectUrl() {
    if (this.isCapacitorNative()) {
      const baseUrl = this.getVercelApiBaseUrl();
      if (baseUrl) return `${baseUrl}/`;
    }
    if (typeof window !== 'undefined' && window.location) {
      return `${window.location.origin}${window.location.pathname}`;
    }
    return undefined;
  }
};

