// project/src/pages/api/admin/update-passwords.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../types/supabase';

// ----- REQUIRED ENV VARS (server-only) -----
// NEXT_PUBLIC_SUPABASE_URL           -> e.g. https://xxxx.supabase.co
// SUPABASE_ANON_KEY                  -> anon/public key (server can use it to read caller JWT)
// SUPABASE_SERVICE_ROLE_KEY          -> service role key (NEVER expose to client)
// STORE_EMAIL_DOMAIN                 -> e.g. yourdomain.com
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.SUPABASE_ANON_KEY!; // server can safely use anon key
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const STORE_EMAIL_DOMAIN = process.env.STORE_EMAIL_DOMAIN || 'yourdomain.com';

type Payload = {
  franchiseId?: string; // "FR-003" or "003"
  newPassword?: string;
};

type AuthUser = {
  id: string;
  email?: string | null;
};

function normalizeFranchiseId(input: string): { formatted: string; alias: string } {
  const numeric = (input || '').replace(/[^0-9]/g, '').padStart(3, '0');
  const formatted = `FR-${numeric}`;
  const alias = `fr-${numeric}`;
  return { formatted, alias };
}

function isCentralAdminEmail(email?: string | null) {
  return !!email && email.includes('+fr-central');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Allow only POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Parse body
  const { franchiseId, newPassword } = (req.body || {}) as Payload;
  if (!franchiseId || !newPassword) {
    return res.status(400).json({ error: 'franchiseId and newPassword are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  // ----- AuthN: verify caller's Supabase user via Authorization: Bearer <JWT> -----
  const authHeader = req.headers.authorization || '';
  const jwt = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7) : '';

  if (!jwt) {
    return res.status(401).json({ error: 'Unauthorized (missing bearer token)' });
  }

  // Client bound to caller (to read who is invoking)
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const { data: userInfo, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userInfo?.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const callerEmail = userInfo.user.email ?? '';

  // ----- AuthZ: restrict to central admin only -----
  if (!isCentralAdminEmail(callerEmail)) {
    return res.status(403).json({ error: 'Forbidden (central admin only)' });
  }

  // ----- Admin client for privileged operations -----
  const supabaseAdmin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    // Normalize franchise
    const { formatted, alias } = normalizeFranchiseId(franchiseId);
    const storeEmail = `store.${alias}@${STORE_EMAIL_DOMAIN}`;

    // 1) MAIN user via profiles.franchise_id
    const { data: profileRow, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('id, email, franchise_id')
      .eq('franchise_id', formatted)
      .single();

    if (profileErr || !profileRow?.id) {
      return res.status(404).json({ error: `Main user profile not found for ${formatted}` });
    }
    const mainUserId = profileRow.id as string;

    // 2) STORE user via auth.users by email (service role key required)
    const { data: storeUserRow, error: storeUserErr } = await supabaseAdmin
      // IMPORTANT: querying auth schema requires service role
      .schema('auth')
      .from<AuthUser>('users')
      .select('id, email')
      .eq('email', storeEmail)
      .single();

    if (storeUserErr || !storeUserRow?.id) {
      return res.status(404).json({ error: `Store user not found for email ${storeEmail}` });
    }
    const storeUserId = storeUserRow.id;

    // 3) Update passwords (admin API)
    {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(mainUserId, {
        password: newPassword,
      });
      if (error) return res.status(500).json({ error: `Failed to update main user: ${error.message}` });
    }
    {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(storeUserId, {
        password: newPassword,
      });
      if (error) return res.status(500).json({ error: `Failed to update store user: ${error.message}` });
    }

    // 4) (Optional) Audit log into public.password_change_audit
    try {
      const ua = (req.headers['user-agent'] as string) || '';
      const ip =
        (req.headers['x-forwarded-for'] as string) ||
        (req.socket?.remoteAddress as string) ||
        '';

      await supabaseAdmin.from('password_change_audit').insert({
        performed_by: userInfo.user.id,
        performed_email: callerEmail,
        franchise_id: formatted,
        main_user_id: mainUserId,
        store_user_id: storeUserId,
        user_agent: ua,
        ip_address: ip,
      });
    } catch (auditErr) {
      // Don't fail the whole request if audit insert fails
      console.warn('Audit insert failed:', auditErr);
    }

    return res.status(200).json({
      success: true,
      message: `Passwords updated for ${formatted}`,
      updated: {
        franchiseId: formatted,
        mainUserId,
        storeUserId,
        storeEmail,
      },
    });
  } catch (err: any) {
    console.error('Password change error:', err);
    return res.status(500).json({
      error: err?.message || 'Failed to update passwords',
    });
  }
}
