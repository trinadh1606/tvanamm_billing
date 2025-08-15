/// <reference lib="deno.ns" />
// supabase/functions/update-passwords/index.ts
// Supabase Edge Function (Deno) to update BOTH main & store user passwords
// for a given franchiseId, restricted to central admin callers.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Payload = {
  franchiseId?: string; // accepts "FR-003" or "003"
  newPassword?: string;
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function normalizeFranchiseId(input: string): { formatted: string; alias: string } {
  const numeric = (input || "").replace(/[^0-9]/g, "").padStart(3, "0");
  const formatted = `FR-${numeric}`;
  const alias = `fr-${numeric}`;
  return { formatted, alias };
}

function isCentralAdminEmail(email?: string | null) {
  // Current rule per your setup; you can harden to a role-based check later.
  return !!email && email.includes("+fr-central");
}

Deno.serve(async (req) => {
  try {
    // Preflight CORS
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: CORS_HEADERS });
    }

    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: CORS_HEADERS,
      });
    }

    // Environment
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const STORE_EMAIL_DOMAIN = Deno.env.get("STORE_EMAIL_DOMAIN") || "yourdomain.com";

    // Client bound to the caller (to identify who invokes)
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });

    // Admin client (service role) for privileged ops
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Identify caller
    const { data: userInfo, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userInfo?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: CORS_HEADERS,
      });
    }

    const callerEmail = userInfo.user.email ?? "";
    if (!isCentralAdminEmail(callerEmail)) {
      return new Response(JSON.stringify({ error: "Forbidden (central admin only)" }), {
        status: 403,
        headers: CORS_HEADERS,
      });
    }

    // Parse input
    const { franchiseId, newPassword } = (await req.json()) as Payload;
    if (!franchiseId || !newPassword) {
      return new Response(JSON.stringify({ error: "franchiseId and newPassword are required" }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }
    if (newPassword.length < 8) {
      return new Response(JSON.stringify({ error: "Password must be at least 8 characters" }), {
        status: 400,
        headers: CORS_HEADERS,
      });
    }

    const { formatted, alias } = normalizeFranchiseId(franchiseId);
    const storeEmail = `store.${alias}@${STORE_EMAIL_DOMAIN}`;

    // 1) MAIN user via profiles.franchise_id (you insert this on registration)
    const { data: profileRow, error: profileErr } = await adminClient
      .from("profiles")
      .select("id, email, franchise_id")
      .eq("franchise_id", formatted)
      .single();

    if (profileErr || !profileRow?.id) {
      return new Response(JSON.stringify({ error: `Main user profile not found for ${formatted}` }), {
        status: 404,
        headers: CORS_HEADERS,
      });
    }
    const mainUserId: string = profileRow.id;

    // 2) STORE user via auth.users by email
    const { data: storeUserRow, error: storeUserErr } = await adminClient
      .schema("auth")
      .from("users")
      .select("id,email")
      .eq("email", storeEmail)
      .single();

    if (storeUserErr || !storeUserRow?.id) {
      return new Response(JSON.stringify({ error: `Store user not found for email ${storeEmail}` }), {
        status: 404,
        headers: CORS_HEADERS,
      });
    }
    const storeUserId: string = storeUserRow.id;

    // 3) Update passwords (admin API)
    {
      const { error } = await adminClient.auth.admin.updateUserById(mainUserId, {
        password: newPassword,
      });
      if (error) {
        return new Response(JSON.stringify({ error: `Failed to update main user: ${error.message}` }), {
          status: 500,
          headers: CORS_HEADERS,
        });
      }
    }
    {
      const { error } = await adminClient.auth.admin.updateUserById(storeUserId, {
        password: newPassword,
      });
      if (error) {
        return new Response(JSON.stringify({ error: `Failed to update store user: ${error.message}` }), {
          status: 500,
          headers: CORS_HEADERS,
        });
      }
    }

    // 4) Audit log
    const ua = req.headers.get("user-agent") || "";
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "";

    const { error: auditErr } = await adminClient.from("password_change_audit").insert({
      performed_by: userInfo.user.id,
      performed_email: callerEmail,
      franchise_id: formatted,
      main_user_id: mainUserId,
      store_user_id: storeUserId,
      user_agent: ua,
      ip_address: ip,
    });
    if (auditErr) console.warn("Audit insert failed:", auditErr);

    return new Response(
      JSON.stringify({
        ok: true,
        message: `Passwords updated for ${formatted}`,
        updated: { franchiseId: formatted, mainUserId, storeUserId, storeEmail },
    }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: "Unexpected error" }), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
});
