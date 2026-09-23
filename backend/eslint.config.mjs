import parser from '@typescript-eslint/parser';
import plugin from '@typescript-eslint/eslint-plugin';
export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  {
    files: ['src/**/*.ts', 'prisma/**/*.ts'],
    languageOptions: { parser, parserOptions: { sourceType: 'module', ecmaVersion: 2022 } },
    plugins: { '@typescript-eslint': plugin },
    rules: {
      'no-debugger': 'error',
      'no-duplicate-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
];
