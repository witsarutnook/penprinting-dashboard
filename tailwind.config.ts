import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Penprinting brand accent — same as penprinting-web + calc
        accent: {
          DEFAULT: '#c8553d',
          dark: '#a3432f',
          light: '#e07a64',
        },
      },
      fontFamily: {
        sans: ['var(--font-anuphan)', 'var(--font-inter)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
export default config;
