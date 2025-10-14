module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  env: {
    es2021: true,
    node: true,
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: [
    'dist/',
    'coverage/',
    'build/',
    '*.config.cjs',
    '*.config.js',
    '*.config.ts',
    '**/node_modules/',
    '**/*.d.ts',
    'examples/python-openai-agents/**',
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
    ],
    '@typescript-eslint/consistent-type-imports': [
      'error',
      { prefer: 'type-imports', disallowTypeAnnotations: false }
    ],
  },
  overrides: [
    {
      files: ['web/**/*.{ts,tsx}'],
      env: {
        browser: true,
      },
      plugins: ['react', 'react-hooks'],
      extends: ['plugin:react/recommended', 'plugin:react-hooks/recommended'],
      settings: {
        react: {
          version: 'detect',
        },
      },
      rules: {
        'react/react-in-jsx-scope': 'off',
        'react/jsx-uses-react': 'off',
      },
    },
    {
      files: ['**/*.test.{ts,tsx}'],
      env: {
        jest: true,
      },
    },
    {
      files: ['api/**/*.ts', 'packages/**/*.ts'],
      env: {
        node: true,
      },
    },
  ],
};
