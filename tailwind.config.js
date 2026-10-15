/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        // Texto corrido (descrições, comentários, formulários, botões).
        sans: ['Lato', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        // Títulos e números de destaque.
        display: ['Poppins', 'Lato', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        page: token('page'),
        surface: token('surface'),
        subtle: token('subtle'),
        line: token('line'),
        ink: token('ink'),
        muted: token('muted'),
        brand: token('brand'),
        'brand-strong': token('brand-strong'),
        'brand-soft': token('brand-soft'),
        navy: token('navy'),
        teal: token('teal'),
        'teal-soft': token('teal-soft'),
        success: token('success'),
        warning: token('warning'),
        danger: token('danger'),
      },
      boxShadow: {
        card: '0 1px 2px rgb(16 24 40 / 0.04), 0 8px 24px -12px rgb(16 24 40 / 0.10)',
        float: '0 18px 40px -16px rgb(16 24 40 / 0.22)',
        header: '0 10px 30px -18px rgb(16 24 40 / 0.35)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
    },
  },
  plugins: [],
};
