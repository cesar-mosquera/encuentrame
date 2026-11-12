import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const sentryUploadConfigured = Boolean(env.SENTRY_ORG && env.SENTRY_PROJECT && env.SENTRY_AUTH_TOKEN)

  return {
    plugins: [
      react(),
      ...(sentryUploadConfigured
        ? [sentryVitePlugin({
            org: env.SENTRY_ORG,
            project: env.SENTRY_PROJECT,
            authToken: env.SENTRY_AUTH_TOKEN,
            sourcemaps: {
              filesToDeleteAfterUpload: ['./dist/**/*.map'],
            },
          })]
        : []),
    ],
    server: {
      watch: {
        ignored: ['**/.gradle_home/**']
      }
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.js'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html'],
        reportsDirectory: './coverage',
        include: ['src/**/*.{js,jsx}'],
        exclude: ['src/test/**', 'src/**/*.test.{js,jsx}', 'src/main.jsx'],
      },
    },
    build: {
      sourcemap: sentryUploadConfigured ? 'hidden' : false,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
              return 'vendor'
            }
            if (id.includes('node_modules/leaflet')) {
              return 'leaflet'
            }
            if (id.includes('node_modules/lucide-react')) {
              return 'lucide'
            }
            if (id.includes('node_modules/@supabase')) {
              return 'supabase'
            }
          }
        },
      },
    },
  }
})
