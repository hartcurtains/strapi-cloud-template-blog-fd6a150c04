import { mergeConfig, type UserConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default (config: UserConfig) => {
  return mergeConfig(config, {
    plugins: [nodePolyfills()],
    resolve: {
      alias: {
        '@': '/src',
        // Provide browser-compatible polyfills for Node.js modules
        'path': 'path-browserify',
        'fs': 'memfs',
        'url': 'url',
        'source-map-js': 'source-map-js',
        // Replace sanitize-html with DOMPurify for browser compatibility
        'sanitize-html': 'dompurify',
      },
    },
    define: {
      global: 'globalThis',
    },
    optimizeDeps: {
      exclude: [
        'exceljs',
        'App-JNN26CL4'
      ],
      include: [
        'dompurify',
        'path-browserify',
        'url',
        'source-map-js',
        'memfs'
      ]
    }
  });
};
