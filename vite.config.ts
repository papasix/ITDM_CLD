import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import type { ProxyOptions } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: env.VITE_API_TARGET || 'https://localhost:8080/ords/itdm',
          changeOrigin: true,
          secure: false, // Disable SSL verification due to upstream certificate issues
          rewrite: p => p.replace(/^\/api/, ''),
          configure: (proxy: any) => {
            // remove Origin to avoid 403 from upstream
            proxy.on('proxyReq', (proxyReq: any) => {
              try { 
                proxyReq.removeHeader('origin');
              } catch (error) {
                // Error handling for origin header removal
              }
            });
          }
        } satisfies ProxyOptions
      }
    }
  }
})