import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../../types/supabase';

type Payload = {
  franchiseId?: string;
  newPassword?: string;
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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { franchiseId, newPassword } = (req.body || {}) as Payload;
  
  if (!franchiseId || !newPassword) {
    return res.status(400).json({ error: 'franchiseId and newPassword are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const authHeader = req.headers.authorization || '';
  const jwt = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7) : '';

  if (!jwt) {
    return res.status(401).json({ error: 'Unauthorized (missing bearer token)' });
  }

  try {
    // 1. Move Env Vars INSIDE the try block so missing vars get caught properly
    // Added fallbacks in case you are injecting Vite env vars into this server
    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const STORE_EMAIL_DOMAIN = process.env.STORE_EMAIL_DOMAIN || 'yourdomain.com';

    if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('Server configuration error: Missing Supabase environment variables');
    }

    // 2. Initialize clients securely inside the try block
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });

    const { data: userInfo, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userInfo?.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const callerEmail = userInfo.user.email ?? '';

    if (!isCentralAdminEmail(callerEmail)) {
      return res.status(403).json({ error: 'Forbidden (central admin only)' });
    }

    const supabaseAdmin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { formatted, alias } = normalizeFranchiseId(franchiseId);
    const storeEmail = `store.${alias}@${STORE_EMAIL_DOMAIN}`;

    // 3. Find Main User via profiles
    const { data: profileRow, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('id, email, franchise_id')
      .eq('franchise_id', formatted)
      .single();

    if (profileErr || !profileRow?.id) {
      return res.status(404).json({ error: `Main user profile not found for ${formatted}` });
    }
    const mainUserId = profileRow.id as string;

    // 4. FIX: Use Admin API to find the store user instead of querying auth.users
    const { data: listData, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
    if (listErr) {
      throw new Error(`Failed to list users: ${listErr.message}`);
    }
    
    const storeUser = listData.users.find((u: any) => u.email === storeEmail);
    if (!storeUser) {
      return res.status(404).json({ error: `Store user not found for email ${storeEmail}` });
    }
    const storeUserId = storeUser.id;

    // 5. Update passwords
    const { error: mainUpdateErr } = await supabaseAdmin.auth.admin.updateUserById(mainUserId, {
      password: newPassword,
    });
    if (mainUpdateErr) throw new Error(`Failed to update main user: ${mainUpdateErr.message}`);

    const { error: storeUpdateErr } = await supabaseAdmin.auth.admin.updateUserById(storeUserId, {
      password: newPassword,
    });
    if (storeUpdateErr) throw new Error(`Failed to update store user: ${storeUpdateErr.message}`);

    return res.status(200).json({
      success: true,
      message: `Passwords updated successfully for ${formatted}`,
    });

  } catch (err: any) {
    console.error('Password change error:', err);
    // Now any crashes will be safely returned as readable JSON to your frontend
    return res.status(500).json({
      error: err?.message || 'An unexpected server error occurred',
    });
  }
}