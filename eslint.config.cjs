module.exports = [
  ...require('eslint-plugin-vue').configs['flat/essential'],
  {
    files: ['web/**/*.js', 'web/**/*.mjs', 'web/**/*.vue'],
    languageOptions: {
      globals: Object.fromEntries(
        [
          'fetch',
          'EventSource',
          'URL',
          'URLSearchParams',
          'setTimeout',
          'clearTimeout',
        ].map((name) => [name, 'readonly']),
      ),
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'error',
      'vue/multi-word-component-names': 'off',
    },
  },
  {
    files: ['src/**/*.cjs', 'test/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: Object.fromEntries(
        [
          'AbortSignal',
          'AbortController',
          'Buffer',
          'URL',
          'URLSearchParams',
          'Response',
          'fetch',
          'process',
          'global',
          'structuredClone',
          'setTimeout',
          'clearTimeout',
          'setInterval',
          'clearInterval',
          '__dirname',
          'console',
        ].map((name) => [name, 'readonly']),
      ),
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-unreachable': 'error',
      'no-constant-condition': 'error',
    },
  },
];
