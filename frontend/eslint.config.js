export default [
  {
    files: ['src/**/*.js', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        window: 'readonly', document: 'readonly', localStorage: 'readonly',
        sessionStorage: 'readonly', navigator: 'readonly', console: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly',
        requestAnimationFrame: 'readonly', performance: 'readonly',
        location: 'readonly', crypto: 'readonly', history: 'readonly',
        import: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none' }],
      'no-undef': 'warn',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-debugger': 'error',
    },
  },
  { ignores: ['dist/**', 'node_modules/**', 'src/lib/**'] },
];
