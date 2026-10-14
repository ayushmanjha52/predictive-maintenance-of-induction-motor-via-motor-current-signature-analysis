import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

const ROUTES = ["/", "/detection-limit", "/validation", "/about", "/privacy"];
const API_TARGET = "http://127.0.0.1:8000";

/**
 * Fills __SITE_URL__ in index.html, injects a Content-Security-Policy for
 * production builds, and emits sitemap.xml and robots.txt for the deploy URL.
 * Set VITE_SITE_URL (and VITE_API_BASE if the API lives on another origin)
 * before `npm run build`.
 */
function siteMeta(siteUrl: string, apiBase: string): Plugin {
  const apiOrigin = /^https?:\/\//.test(apiBase) ? new URL(apiBase).origin : "";
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${apiOrigin ? " " + apiOrigin : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src 'none'",
  ].join("; ");
  return {
    name: "motorscope-site-meta",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        let out = html.replaceAll("__SITE_URL__", siteUrl);
        if (!ctx.server) {
          out = out.replace(
            "<meta charset=\"UTF-8\" />",
            `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
          );
        }
        return out;
      },
    },
    generateBundle() {
      const today = new Date().toISOString().slice(0, 10);
      const urls = ROUTES.map(
        (r) => `  <url><loc>${siteUrl}${r}</loc><lastmod>${today}</lastmod></url>`,
      ).join("\n");
      this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      });
      this.emitFile({
        type: "asset",
        fileName: "robots.txt",
        source: `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const siteUrl = (env.VITE_SITE_URL || "http://localhost:4173").replace(/\/+$/, "");
  const apiBase = env.VITE_API_BASE || "/api";
  const proxy = {
    "/api": { target: API_TARGET, changeOrigin: true, rewrite: (p: string) => p.replace(/^\/api/, "") },
  };
  return {
    plugins: [react(), tailwindcss(), siteMeta(siteUrl, apiBase)],
    server: { port: 5173, strictPort: true, proxy },
    preview: { port: 4173, strictPort: true, proxy },
    build: {
      target: "es2022",
      sourcemap: false,
      rollupOptions: {
        output: {
          // Vendor code in long-cacheable chunks; the chart library loads only with results.
          manualChunks(id: string) {
            if (!id.includes("node_modules")) return undefined;
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|cookie|set-cookie-parser)[\\/]/.test(id))
              return "react";
            if (/[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) return "motion";
            return undefined;
          },
        },
      },
    },
  };
});
