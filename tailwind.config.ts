import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#17211b",
        leaf: "#1f7a5a",
        mint: "#eaf7f0",
        line: "#d9e5dd",
      },
      boxShadow: {
        soft: "0 16px 40px rgba(23, 33, 27, 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
