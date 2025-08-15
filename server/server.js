// server/server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

function normalizeFranchiseIdFlexible(input) {
  let raw = String(input || '').trim();
  raw = raw.replace(/^\s*FR[-_\s]?/i, '');
  const alnum = raw.replace(/[^A-Za-z0-9]/g, '');
  if (!alnum) return null;

  const isDigitsOnly = /^[0-9]+$/.test(alnum);
  const core = isDigitsOnly ? alnum.padStart(3, '0') : alnum.toUpperCase();

  const formatted = `FR-${core}`;
  const alias = isDigitsOnly ? `fr-${alnum.padStart(3, '0')}` : `fr-${alnum.toLowerCase()}`;
  return { formatted, alias, isDigitsOnly, raw: alnum };
}

function isCentralAdminEmail(email) {
  return !!email && email.includes('+fr-central');
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORE_EMAIL_DOMAIN = process.env.STORE_EMAIL_DOMAIN || 'yourdomain.com';
const AUTO_FIX_PROFILE_MAPPING = (process.env.AUTO_FIX_PROFILE_MAPPING || 'true').toLowerCase() === 'true';

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY');
}

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, mode: 'alphanumeric+preferAliasMain+fallback+adminListUsers', ts: Date.now() });
});

async function getCallerUser(req) {
  const authHeader = req.headers.authorization || '';
  const jwt = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7) : '';
  if (!jwt) return { error: 'Unauthorized (missing bearer token)' };

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const { data: userInfo, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userInfo?.user) return { error: 'Unauthorized' };

  const email = userInfo.user.email || '';
  if (!isCentralAdminEmail(email)) return { error: 'Forbidden (central admin only)' };

  return { user: userInfo.user, email };
}

async function listUsersPaged(admin, { maxPages = 10, perPage = 1000 } = {}) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users || [];
    out.push(...users);
    if (!users.length || users.length < perPage) break;
  }
  return out;
}

async function findUserByExactEmail(admin, email) {
  const users = await listUsersPaged(admin);
  return users.find(u => (u.email || '').toLowerCase() === email.toLowerCase()) || null;
}

async function findUserByEmailPrefix(admin, prefix) {
  const users = await listUsersPaged(admin);
  const lowered = prefix.toLowerCase();
  return users.find(u => (u.email || '').toLowerCase().startsWith(lowered)) || null;
}

async function findUserByPlusAlias(admin, alias) {
  const users = await listUsersPaged(admin);
  const needle = `+${alias}@`.toLowerCase();
  return users.find(u => (u.email || '').toLowerCase().includes(needle)) || null;
}

app.post('/api/admin/update-passwords', async (req, res) => {
  try {
    const authz = await getCallerUser(req);
    if (authz.error) return res.status(authz.error.startsWith('Unauthorized') ? 401 : 403).json({ error: authz.error });

    const { franchiseId, newPassword } = req.body || {};
    if (!franchiseId || !newPassword) return res.status(400).json({ error: 'franchiseId and newPassword are required' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const norm = normalizeFranchiseIdFlexible(franchiseId);
    if (!norm) return res.status(400).json({ error: 'Franchise ID must contain letters or digits' });
    const { formatted, alias } = norm;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // ---- MAIN user: prefer alias email (+alias) first
    let mainUserId = null;
    let mainEmail = null;
    const aliasMain = await findUserByPlusAlias(admin, alias);

    if (aliasMain) {
      mainUserId = aliasMain.id;
      mainEmail = aliasMain.email || null;
    } else {
      // fallback via profiles.franchise_id
      const { data: profileRow, error: profileErr } = await admin
        .from('profiles')
        .select('id, email, franchise_id')
        .eq('franchise_id', formatted)
        .limit(1)
        .maybeSingle();

      if (profileErr) console.warn('profiles lookup error:', profileErr);
      if (profileRow?.id) {
        mainUserId = profileRow.id;
        mainEmail = profileRow.email || null;
      }
    }

    // Optional: best-effort auto-fix mapping in profiles if mismatch
    if (AUTO_FIX_PROFILE_MAPPING && aliasMain && mainUserId && mainUserId !== aliasMain.id) {
      try {
        await admin
          .from('profiles')
          .update({ id: aliasMain.id, email: aliasMain.email || mainEmail || null })
          .eq('franchise_id', formatted);
        mainUserId = aliasMain.id;
        mainEmail = aliasMain.email || mainEmail;
      } catch (fixErr) {
        console.warn('profiles auto-fix failed:', fixErr);
      }
    }

    // ---- STORE user: exact domain then wildcard domain
    const exactStoreEmail = `store.${alias}@${STORE_EMAIL_DOMAIN}`;
    let storeUser = await findUserByExactEmail(admin, exactStoreEmail);
    if (!storeUser) {
      storeUser = await findUserByEmailPrefix(admin, `store.${alias}@`);
    }
    if (!storeUser) {
      return res.status(404).json({
        error: 'Store user not found.',
        hint: `Tried exact ${exactStoreEmail} and wildcard store.${alias}@ (any domain). Check STORE_EMAIL_DOMAIN or store email pattern.`,
      });
    }

    // ---- Update passwords
    if (mainUserId) {
      const r1 = await admin.auth.admin.updateUserById(mainUserId, { password: newPassword });
      if (r1.error) return res.status(500).json({ error: `Failed to update main user: ${r1.error.message}` });
    } else {
      console.warn(`Main user not found for ${formatted}. Skipping main update.`);
    }

    const r2 = await admin.auth.admin.updateUserById(storeUser.id, { password: newPassword });
    if (r2.error) return res.status(500).json({ error: `Failed to update store user: ${r2.error.message}` });

    // ---- Audit (best effort)
    try {
      const ua = req.headers['user-agent'] || '';
      const ip = req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '';
      await admin.from('password_change_audit').insert({
        performed_by: authz.user.id,
        performed_email: authz.email,
        franchise_id: formatted,
        main_user_id: mainUserId,
        store_user_id: storeUser.id,
        user_agent: ua,
        ip_address: ip,
      });
    } catch (auditErr) {
      console.warn('Audit insert failed:', auditErr);
    }

    return res.status(200).json({
      success: true,
      message: `Passwords updated for ${formatted}${mainUserId ? '' : ' (main user not found; store updated)'} `,
      updated: {
        franchiseId: formatted,
        mainUserId: mainUserId || null,
        mainEmail: mainEmail || null,
        storeUserId: storeUser.id,
        storeEmail: storeUser.email,
      },
    });
  } catch (err) {
    console.error('Password change error:', err);
    return res.status(500).json({ error: (err && err.message) || 'Failed to update passwords' });
  }
});

const PORT = Number(process.env.PORT) || 8080;
app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`));
