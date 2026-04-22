import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { versionInjectionPlugin } from "./vite.config.version-plugin";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(({ mode, command }) => {
  const isProduction = mode === 'production' || (command === 'build' && mode !== 'development');
  
  return {
    plugins: [
      react(),
      versionInjectionPlugin()
    ],

    // Path resolution
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@/shared": path.resolve(__dirname, "./src/shared"),
        "@/core": path.resolve(__dirname, "./src/core"),
        "@/tools": path.resolve(__dirname, "./src/tools"),
        "@/hooks": path.resolve(__dirname, "./src/hooks"),
        "@/styles": path.resolve(__dirname, "./src/component-library/styles"),
        "@/types": path.resolve(__dirname, "./src/shared/types"),
        "@/utils": path.resolve(__dirname, "./src/shared/utils"),
        "@components": path.resolve(__dirname, "./src/component-library/components"),
      },
    },

  css: {
    preprocessorOptions: {
      scss: {
        // SCSS preprocessing options (sourcemap is controlled by build.sourcemap)
      },
    },
    // dev mode enabled, release mode disabled
    devSourcemap: !isProduction,
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1422,
    // Tauri devUrl is fixed to http://localhost:1422.
    // If Vite silently falls back to another port, the desktop webview stays blank.
    strictPort: true,
    host: host || "localhost",
    hmr: {
      protocol: "ws",
      host: host || "localhost",
      port: 1421,
    },
    // Allow access to workspace root for dependencies like monaco-editor
    fs: {
      allow: [
        path.resolve(__dirname, '../../'), // Workspace root
      ],
    },
    watch: {
      // 3. tell Vite to ignore watching `src-tauri` and `apps`
      ignored: ["**/src-tauri/**", "**/apps/**"],
      // Increase polling interval for stability (especially on Windows)
      usePolling: true,
      interval: 100,
    },
  },

  // Optimize dependency pre-building
  optimizeDeps: {
    // Exclude dependencies that need to be dynamically loaded
    exclude: [],
    // Force pre-building dependencies
    // Resolve Vite 7 and React 18 compatibility issues
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'mermaid',
      'mermaid/dist/mermaid.esm.min.mjs',
    ],
  },

  // Build options
  build: {
    // Enable CSS code splitting
    cssCodeSplit: true,
    // The desktop UI intentionally ships large, cacheable editor/diagram chunks
    // (Monaco, Mermaid, Markdown, xterm). Keep warnings focused on accidental
    // mega-bundles after those domains have been split out.
    chunkSizeWarningLimit: 4096,
    // release version disable sourcemap, dev/debug version enable
    sourcemap: !isProduction,
    // Output to the project root directory dist/
    outDir: '../../dist',
    // Empty the output directory
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined;
          }

          if (id.includes('monaco-editor') || id.includes('@monaco-editor')) {
            return 'vendor-monaco';
          }

          if (id.includes('@xterm')) {
            return 'vendor-terminal';
          }

          if (id.includes('mermaid') || id.includes('cytoscape')) {
            return 'vendor-mermaid';
          }

          if (
            id.includes('katex') ||
            id.includes('@tiptap') ||
            id.includes('prosemirror') ||
            id.includes('parse5') ||
            id.includes('dompurify') ||
            id.includes('highlight.js') ||
            id.includes('prismjs') ||
            id.includes('linkifyjs')
          ) {
            return 'vendor-markdown';
          }

          if (id.includes('@tauri-apps')) {
            return 'vendor-tauri';
          }

          return undefined;
        },
      },
    },
  }
  };
});
