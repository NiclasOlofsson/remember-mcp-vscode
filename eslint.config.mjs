/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Niclas Olofsson. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import typescriptEslint from "@typescript-eslint/eslint-plugin";
import stylisticEslint from '@stylistic/eslint-plugin';
import tsParser from "@typescript-eslint/parser";
import importEslint from 'eslint-plugin-import';
import jsdocEslint from 'eslint-plugin-jsdoc';

export default [
	// Global ignores
	{
		ignores: [
			'dist/**',
			'out/**',
			'node_modules/**',
			'temp_auto/**',
			'temp_summary/**',
			'**/*.d.ts',
			'scripts/**',
			'.vscode/**',
			'media/**',
		],
	},
	// Base configuration for all TypeScript files
	{
		files: ['**/*.ts', '**/*.tsx'],
		languageOptions: {
			parser: tsParser,
			ecmaVersion: 2022,
			sourceType: 'module',
		},
		plugins: {
			'@typescript-eslint': typescriptEslint,
			'@stylistic': stylisticEslint,
			'import': importEslint,
			'jsdoc': jsdocEslint,
		},
		settings: {
			'import/resolver': {
				typescript: {
					extensions: ['.ts', '.tsx'],
				},
			},
		},
		rules: {
			// TypeScript rules
			'@typescript-eslint/naming-convention': [
				'error',
				{
					selector: 'class',
					format: ['PascalCase'],
				},
				{
					selector: 'interface',
					format: ['PascalCase'],
				},
				{
					selector: 'enum',
					format: ['PascalCase'],
				},
			],
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ 
					argsIgnorePattern: '^_',
					destructuredArrayIgnorePattern: '^_'
				},
			],
			'@typescript-eslint/explicit-function-return-type': 'off',
			'@typescript-eslint/explicit-module-boundary-types': 'off',
			'@typescript-eslint/no-explicit-any': 'off',

			// Stylistic rules
			'@stylistic/indent': ['error', 'tab'],
			'@stylistic/quotes': ['error', 'single'],
			'@stylistic/semi': ['error', 'always'],
			'@stylistic/member-delimiter-style': 'error',

			// Core ESLint rules
			'curly': 'error',
			'eqeqeq': 'error',
			'prefer-const': ['error', { destructuring: 'all' }],
			'no-buffer-constructor': 'error',
			'no-caller': 'error',
			'no-case-declarations': 'error',
			'no-debugger': 'error',
			'no-duplicate-case': 'error',
			'no-duplicate-imports': 'error',
			'no-eval': 'error',
			'no-extra-semi': 'error',
			'no-new-wrappers': 'error',
			'no-redeclare': 'off', // Handled by TypeScript
			'no-sparse-arrays': 'error',
			'no-throw-literal': 'error',
			'no-unsafe-finally': 'error',
			'no-unused-labels': 'error',
			'no-var': 'error',

			// Import rules
			'import/no-unresolved': 'error',
			'import/named': 'error',
			'import/default': 'error',
			'import/namespace': 'error',
			'import/no-restricted-paths': [
				'error',
				{
					zones: [
						{
							target: './src/test',
							from: './src/extension',
							except: ['./types'],
						},
					],
				},
			],

			// JSDoc rules
			'jsdoc/no-types': 'error',

			// Header rule
			// 'header/header': [
			// 	'error',
			// 	'block',
			// 	[
			// 		'---------------------------------------------------------------------------------------------',
			// 		' *  Copyright (c) Niclas Olofsson. All rights reserved.',
			// 		' *  Licensed under the MIT License.',
			// 		' *--------------------------------------------------------------------------------------------',
			// 	],
			// ],
		},
	},
	// Configuration for test files
	{
		files: ['**/*.test.ts', '**/*.spec.ts', '**/test/**/*.ts'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'no-unused-expressions': 'off', // For chai assertions
		},
	},
	// Configuration for JavaScript files
	{
		files: ['**/*.js', '**/*.mjs'],
		rules: {
			'jsdoc/no-types': 'off',
			'@typescript-eslint/no-var-requires': 'off',
		},
	},
];
