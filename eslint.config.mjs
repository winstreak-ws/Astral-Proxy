import { common, typescript, prettier, node } from 'eslint-config-neon';

export default [
	{
		ignores: ['**/dist/*', '**/public/*, **/data/*', '**/*.yaml', '**/*.yml'],
		files: ['**/*.ts', '**/*.tsx'],
	},
	...node,
	...common,
	...typescript,
	...prettier,
	{
		languageOptions: {
			ecmaVersion: 2_020,
			sourceType: 'module',

			parserOptions: {
				project: ['./tsconfig.eslint.json'],
			},
		},

		rules: {
			'import/extensions': 0,
			'@typescript-eslint/unbound-method': 0,
			'id-length': 0,
		},
	},
];
