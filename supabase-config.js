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

window.supabaseClient = null;
window.supabaseConfigReady = (async function () {
  if (!isSupabaseConfigured()) {
    console.error("Supabase 配置未通过检查，请确认 SUPABASE_URL 和 SUPABASE_ANON_KEY 已正确填写。", {
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
    });
    return;
  }

  if (typeof window.supabase === "undefined") {
    if (!window.supabaseLoaderPromise) {
      console.error("Supabase SDK 加载器不存在，请确认 supabase-loader.js 已正确加载。");
      return;
    }
    await window.supabaseLoaderPromise;
  }

  if (typeof window.supabase === "undefined") {
    console.error("Supabase SDK 未加载，无法创建客户端。", window.supabase);
    return;
  }

  try {
    window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log("Supabase 客户端已创建。");
  } catch (error) {
    console.error("创建 Supabase 客户端失败：", error);
  }
})();
