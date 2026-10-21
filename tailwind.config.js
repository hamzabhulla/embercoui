/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Design tokens for NEW code only. Keys are deliberately nested under
      // `brand` (classes: bg-brand-forest, text-brand-ember, ...) so they can
      // never activate class names that already exist in the current UI —
      // Phase 0 must produce zero visual change to the existing site.
      colors: {
        brand: {
          cream: '#F5F0E8',
          forest: '#0D1A0E',
          forestSection: '#1C2B1E',
          ember: '#C17A3A',
          emberHover: '#A66932',
        },
      },
      fontFamily: {
        display: ['"Cormorant Garamond"', 'serif'],
        bodytext: ['Jost', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
