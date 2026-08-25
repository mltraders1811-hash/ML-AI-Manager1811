import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#166534",
          light: "#DCFCE7",
          dark: "#14532D",
        },
        overdue: "#B91C1C",
      },
    },
  },
  plugins: [],
};

export default config;
