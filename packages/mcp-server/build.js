// Bundles the MCP server into one file Node runs directly (Node 22 can't run the TS sources).
import { build } from 'esbuild';

await build({
  entryPoints: ['src/cli.ts'],
  outfile: 'build/third-wheel-mcp.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // `ws` is CommonJS and requires Node built-ins: give the ESM bundle a real `require`.
  banner: {
    js: "import { createRequire as __twRequire } from 'node:module'; const require = __twRequire(import.meta.url);",
  },
  // Optional native speed-ups of `ws`; it works without them.
  external: ['bufferutil', 'utf-8-validate'],
  logLevel: 'warning',
});
