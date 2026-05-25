(function () {
  if (window.supabaseLoaderPromise) {
    return;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => resolve(src);
      script.onerror = () => reject(new Error(`Script load failed: ${src}`));
      document.head.appendChild(script);
    });
  }

  const primaryUrl = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.106.1/dist/umd/supabase.min.js";
  const fallbackUrl = "https://unpkg.com/@supabase/supabase-js@2/dist/supabase.min.js";

  window.supabaseLoaderPromise = loadScript(primaryUrl)
    .then((src) => {
      console.log("Supabase SDK 已从主要 CDN 加载。", src);
    })
    .catch((primaryError) => {
      console.warn("主要 Supabase CDN 加载失败，尝试备用 CDN。", primaryError);
      return loadScript(fallbackUrl)
        .then((src) => {
          console.log("Supabase SDK 已从备用 CDN 加载。", src);
        })
        .catch((fallbackError) => {
          console.error("Supabase SDK 两个 CDN 均加载失败。请检查网络或使用本地脚本文件。", fallbackError);
          throw fallbackError;
        });
    });
})();
