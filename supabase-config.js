const SUPABASE_URL = "https://ssotodlcclgbpdwgchlk.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNzb3RvZGxjY2xnYnBkd2djaGxrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MDkwMTUsImV4cCI6MjA5NTI4NTAxNX0.Ta9LLFgRp7vZ0gzmOFBvozTJZ27ItzHc_J356YbxzvE";
const SUPABASE_TABLE = "shared_plans";
const SHARED_PLAN_ID = "family_shared_plan";

function isSupabaseConfigured() {
  return (
    typeof SUPABASE_URL === "string" &&
    typeof SUPABASE_ANON_KEY === "string" &&
    SUPABASE_URL.includes("supabase.co") &&
    !SUPABASE_URL.includes("YOUR_PROJECT_ID") &&
    !SUPABASE_ANON_KEY.includes("YOUR_ANON_PUBLIC_KEY")
  );
}

let supabaseClient = null;
if (typeof supabase === "undefined") {
  console.error("Supabase SDK 未加载，请检查 CDN 是否可访问。", window.supabase);
} else if (isSupabaseConfigured()) {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  console.log("Supabase SDK 已加载，Supabase 客户端已创建。");
} else {
  console.error("Supabase 配置未通过检查，请确认 SUPABASE_URL 和 SUPABASE_ANON_KEY 已正确填写。");
}
