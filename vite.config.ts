import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

interface PackageJson {
  version: string;
}

const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as PackageJson;

export default defineConfig({
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    VitePWA({
      registerType: "prompt",
      includeAssets: [
        "icons/icon-192.png",
        "icons/icon-512.png",
        "icons/apple-touch-icon.png",
      ],
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        runtimeCaching: [],
      },
      manifest: {
        name: "Valutazione VRU — Tutela Utenti Vulnerabili",
        short_name: "Valutazione VRU",
        description:
          "Scheda offline su smartphone per valutazione istruttore e autovalutazione cieca allievo sulla tutela degli utenti vulnerabili della strada.",
        lang: "it",
        display: "standalone",
        orientation: "portrait",
        start_url: ".",
        scope: ".",
        theme_color: "#0f3d5e",
        background_color: "#f4f6f8",
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any maskable",
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
    }),
  ],
});
