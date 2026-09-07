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
    // Railway serves this behind its own edge router; the service hostname
    // isn't fixed, so accept whatever host Railway forwards.
    allowedHosts: true,
  },
})