import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // Bind on all interfaces so other devices on your LAN can open the game at
    // http://<your-lan-ip>:5173.
    host: '0.0.0.0',
    // `true` lets the dev server accept any Host header (LAN IPs, *.e2b.app,
    // localhost). This is a local dev server, so accepting LAN hostnames is
    // exactly what we want; production serves the static build instead.
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  build: {
    // Strip any stray console.* / debugger from production bundles (#10).
    // Our own logging already routes through modules/debug.js, but this is a
    // belt-and-braces drop for third-party noise too.
    // (console.error is preserved via modules/debug.js which we do NOT drop
    //  selectively - see note below.)
    rollupOptions: {
      input: {
        main: 'index.html',
        game: 'game.html',
      },
    },
    chunkSizeWarningLimit: 2600,
  },
  esbuild: {
    // Drop debugger statements in production; console is gated by debug.js.
    drop: ['debugger'],
  },
  // Ensure the ammo.js .wasm (if any) and other assets are served with correct
  // MIME types in dev. Vite serves .wasm as application/wasm by default (#26).
  assetsInclude: ['**/*.wasm'],
});
