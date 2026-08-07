/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // Branding (from the spec): Taviraj (display) + Fustat (body)
        display: ['"Taviraj"', "ui-serif", "Georgia", "serif"],
        body: ['"Fustat"', "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      colors: {
        // Design tokens used throughout the blueprint (e.g. bg-card, text-foreground)
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Optional: tokens referenced in the blueprint via arbitrary values
        sidebar: {
          ring: "hsl(var(--sidebar-ring))",
        },
        // Brand colors explicitly listed in the blueprint's Media Kit page
        brand: {
          indigo: "#3730a3",
          blue: "#2563eb",
          amber: "#f59e0b",
          slateDark: "#0f172a",
          white: "#ffffff",
        },
      },
      backgroundImage: {
        // Named gradients seen across the blueprint (usable via: bg-gradient-menorca / bg-gradient-decelera)
        "gradient-menorca":
          "linear-gradient(135deg, #2d3852 0%, rgba(31, 208, 239, 0.80) 100%)",
        "gradient-decelera":
          "linear-gradient(135deg, #3730a3 0%, #2563eb 55%, #1d4ed8 100%)",
      },
    },
  },
  plugins: [],
};

