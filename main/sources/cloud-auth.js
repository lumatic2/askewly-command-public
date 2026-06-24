'use strict';

const fs = require('fs');
const http = require('http');
const { URL } = require('url');
const { createClient } = require('@supabase/supabase-js');

function createJsonStorage(filePath) {
  function readStore() {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return {};
    }
  }

  function writeStore(store) {
    fs.mkdirSync(require('path').dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8');
  }

  return {
    getItem(key) {
      return readStore()[key] || null;
    },
    setItem(key, value) {
      const store = readStore();
      store[key] = value;
      writeStore(store);
    },
    removeItem(key) {
      const store = readStore();
      delete store[key];
      writeStore(store);
    }
  };
}

function createAuthClient(config = {}, storagePath) {
  const supabaseUrl = String(config.supabaseUrl || process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const anonKey = String(config.anonKey || process.env.SUPABASE_ANON_KEY || '').trim();
  if (!supabaseUrl || !anonKey) {
    throw new Error('Desktop cloud auth requires SUPABASE_URL and SUPABASE_ANON_KEY');
  }

  return createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: 'pkce',
      persistSession: true,
      storage: createJsonStorage(storagePath)
    }
  });
}

async function refreshDesktopCloudSession(config = {}, storagePath) {
  const supabase = createAuthClient(config, storagePath);
  const { data: existing, error: getError } = await supabase.auth.getSession();
  if (getError) throw getError;
  if (!existing.session) return null;

  const expiresAt = Number(existing.session.expires_at || 0);
  const shouldRefresh = !expiresAt || expiresAt * 1000 - Date.now() < 120000;
  if (!shouldRefresh) return existing.session;

  const { data, error } = await supabase.auth.refreshSession();
  if (error) throw error;
  return data.session || existing.session;
}

async function signOutDesktopCloud(config = {}, storagePath) {
  const supabase = createAuthClient(config, storagePath);
  await supabase.auth.signOut();
}

async function startDesktopOAuth(config = {}, options = {}) {
  const provider = options.provider || 'google';
  const port = Number(options.port || getEnv('AUTH_PORT') || 8082);
  const redirectTo = `http://localhost:${port}/auth`;
  const supabase = createAuthClient(config, options.storagePath);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true
    }
  });
  if (error) throw error;
  if (!data?.url) throw new Error('Supabase OAuth did not return a provider URL');

  return waitForOAuthCallback({
    port,
    openExternal: options.openExternal,
    timeoutMs: options.timeoutMs || 300000,
    onCode: async (code) => {
      const result = await supabase.auth.exchangeCodeForSession(code);
      if (result.error) throw result.error;
      return result.data.session;
    },
    url: data.url
  });
}

function getEnv(name) {
  return process.env[`ASKEWLY_COMMAND_${name}`] || process.env[`WORKSPACE_PULSE_${name}`] || '';
}

function waitForOAuthCallback({ port, openExternal, timeoutMs, onCode, url }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close(() => callback());
    };

    const server = http.createServer(async (req, res) => {
      try {
        const requestUrl = new URL(req.url || '/', `http://localhost:${port}`);
        if (requestUrl.pathname !== '/auth') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const error = requestUrl.searchParams.get('error') || requestUrl.searchParams.get('error_description');
        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(`Askewly Command sign-in failed: ${error}`);
          finish(() => reject(new Error(error)));
          return;
        }

        const code = requestUrl.searchParams.get('code');
        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Askewly Command sign-in failed: missing code');
          finish(() => reject(new Error('OAuth callback missing code')));
          return;
        }

        const session = await onCode(code);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><title>Askewly Command</title><p>Askewly Command sign-in complete. You can close this tab.</p>');
        finish(() => resolve(session));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Askewly Command sign-in failed: ${error.message || error}`);
        finish(() => reject(error));
      }
    });

    server.on('error', reject);
    server.listen(port, '127.0.0.1', async () => {
      timer = setTimeout(() => {
        finish(() => reject(new Error('Desktop cloud sign-in timed out')));
      }, timeoutMs);
      try {
        await openExternal(url);
      } catch (error) {
        finish(() => reject(error));
      }
    });
  });
}

module.exports = {
  refreshDesktopCloudSession,
  signOutDesktopCloud,
  startDesktopOAuth
};
