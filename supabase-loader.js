(async function () {
  if (window.supabaseLoaderPromise) {
    return;
  }

  async function loadModule(url) {
    try {
      const module = await import(url);
      if (module && typeof module.createClient === "function") {
        return module;
      }
    } catch (error) {
      console.warn(`Supabase 模块从 ${url} 加载失败：`, error);
    }
    return null;
  }

  const primaryUrl = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/supabase.esm.js";
  const fallbackUrl = "https://unpkg.com/@supabase/supabase-js@2/dist/supabase.esm.js";

  window.supabaseLoaderPromise = (async () => {
    let module = await loadModule(primaryUrl);
    if (!module) {
      module = await loadModule(fallbackUrl);
      if (!module) {
        console.error("Supabase SDK 两个 CDN 均加载失败。请检查网络或使用本地脚本文件。");
        return;
      }
      console.log("Supabase SDK 已从备用 CDN 加载。", fallbackUrl);
    } else {
      console.log("Supabase SDK 已从主要 CDN 加载。", primaryUrl);
    }
    window.supabase = module;
  })();
})();
