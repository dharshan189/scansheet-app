/**
 * ScanSheet - Supabase Client & Configuration Layer
 * Connects securely to Supabase PostgreSQL & Auth using environment variables.
 * Enforces native persistent sessions, automatic token refresh, and URL recovery detection.
 */

import { AppConfig } from './app-config.js';

class SupabaseService {
  constructor() {
    this.client = null;
    this.config = {
      url: null,
      anonKey: null
    };
    this.initPromise = null;
  }

  /**
   * Initialize Supabase client
   * Resolves credentials from /api/config (via full HTTPS Vercel URL on Capacitor),
   * window.__ENV__, or localStorage overrides. Never stores secret/service-role keys.
   */
  async init() {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        // 1. Check window.__ENV__ or global overrides
        let url = window.__ENV__?.SUPABASE_URL || window.SUPABASE_URL || null;
        let anonKey = window.__ENV__?.SUPABASE_ANON_KEY || window.SUPABASE_ANON_KEY || null;

        // 2. Fetch public config from Vercel / backend /api/config
        const configEndpoint = AppConfig.resolveApiUrl('/api/config');
        if (configEndpoint && (!url || !anonKey || !window.PADDLE_OCR_API_URL)) {
          try {
            const resp = await fetch(configEndpoint, { cache: 'no-store' });
            if (resp.ok) {
              const contentType = resp.headers.get('content-type') || '';
              if (contentType.includes('application/json')) {
                const data = await resp.json();
                url = data.supabaseUrl || url;
                anonKey = data.supabaseAnonKey || anonKey;
                if (data.ocrServerUrl && !window.PADDLE_OCR_API_URL) {
                  const trimmed = data.ocrServerUrl.replace(/\/+$/, '');
                  window.PADDLE_OCR_API_URL = trimmed.endsWith('/api/scan') || trimmed.endsWith('/api/ocr')
                    ? trimmed
                    : `${trimmed}/api/scan`;
                }
                if (url && anonKey) {
                  try {
                    localStorage.setItem('scansheet_supabase_config', JSON.stringify({
                      url,
                      anonKey,
                      ocrServerUrl: data.ocrServerUrl || ''
                    }));
                  } catch (_) {}
                }
              }
            }
          } catch (netErr) {
            // Backend config not reachable (e.g. offline or static host without serverless function)
          }
        }

        // 3. Check for cached / developer localStorage configuration fallback
        if (!url || !anonKey || !window.PADDLE_OCR_API_URL) {
          try {
            const localCfg = localStorage.getItem('scansheet_supabase_config');
            if (localCfg) {
              const parsed = JSON.parse(localCfg);
              url = url || parsed.url || null;
              anonKey = anonKey || parsed.anonKey || null;
              if (parsed.ocrServerUrl && !window.PADDLE_OCR_API_URL) {
                const trimmed = parsed.ocrServerUrl.replace(/\/+$/, '');
                window.PADDLE_OCR_API_URL = trimmed.endsWith('/api/scan') || trimmed.endsWith('/api/ocr')
                  ? trimmed
                  : `${trimmed}/api/scan`;
              }
            }
          } catch (_) {}
        }

        if (url && anonKey && typeof window !== 'undefined' && window.supabase?.createClient) {
          this.config = { url, anonKey };
          this.client = window.supabase.createClient(url, anonKey, {
            auth: {
              persistSession: true,
              autoRefreshToken: true,
              detectSessionInUrl: true,
              storage: window.localStorage
            }
          });
          console.log('[Supabase] Initialized successfully with persistent session management.');
        } else {
          if (!url || !anonKey) {
            console.info('[Supabase] Environment credentials not set. Running in local/offline fallback mode.');
          }
        }
      } catch (err) {
        console.warn('[Supabase] Initialization error:', err);
      }
      return this.client;
    })();

    return this.initPromise;
  }

  /**
   * Set custom Supabase client (e.g., during testing or dynamic reconfiguration)
   */
  setClient(client, config = {}) {
    this.client = client;
    if (config.url) this.config.url = config.url;
    if (config.anonKey) this.config.anonKey = config.anonKey;
  }

  /**
   * Get active Supabase client instance
   * @returns {Object|null}
   */
  getClient() {
    return this.client;
  }

  /**
   * Check if Supabase client is configured and active
   * @returns {boolean}
   */
  isConfigured() {
    return this.client !== null;
  }
}

export const SupabaseConfig = new SupabaseService();
