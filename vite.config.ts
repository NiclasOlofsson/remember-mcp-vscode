/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Niclas Olofsson. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
	test: {
		include: ['**/*.test.ts', '**/*.spec.ts'],
		exclude: [
			'**/node_modules/**',
			'**/dist/**',
			'**/out/**',
			'**/temp_auto/**',
			'**/temp_summary/**',
		],
		environment: 'node',
		globals: true,
		alias: {
			// Mock VS Code API for unit tests
			'vscode': path.resolve(__dirname, 'src/test/mocks/vscode-mock.ts'),
		},
		coverage: {
			reporter: ['text', 'json', 'html'],
			exclude: [
				'node_modules/',
				'src/test/',
				'temp_auto/',
				'temp_summary/',
			],
		},
	},
	resolve: {
		alias: {
			'vscode': path.resolve(__dirname, 'src/test/mocks/vscode-mock.ts'),
		},
	},
});
