import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  server: {
    host: true,
  },
  preview: {
    host: true,
    allowedHosts: ["decelera-menorca-2026-production.up.railway.app"],
  },
})