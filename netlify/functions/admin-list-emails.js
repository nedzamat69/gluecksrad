const { createClient } = require("@supabase/supabase-js");

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type, authorization",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(payload)
  };
}

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function header(event, name) {
  const headers = event && event.headers ? event.headers : {};
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || "";
}

exports.handler = async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "content-type, authorization",
        "Access-Control-Allow-Methods": "GET, OPTIONS"
      }
    };
  }

  if (event.httpMethod !== "GET") {
    return json(405, { ok: false, message: "Method Not Allowed" });
  }

  const authHeader = String(header(event, "authorization") || "");
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token || !process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return json(401, { ok: false, message: "Unauthorized" });
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return json(500, { ok: false, message: "Serverfehler" });
  }

  const { data, error } = await supabase
    .from("email_claims")
    .select("email,created_at")
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) {
    return json(500, { ok: false, message: "Serverfehler" });
  }

  return json(200, { ok: true, data: data || [] });
};
