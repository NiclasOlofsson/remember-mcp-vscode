/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Niclas Olofsson. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as esbuild from 'esbuild';
import * as path from 'path';
import * as fs from 'fs';

// Plugin to handle VS Code API external
const vscodeExternalPlugin: esbuild.Plugin = {
	name: 'vscode-external',
	setup(build) {
		build.onResolve({ filter: /^vscode$/ }, () => ({
			path: 'vscode',
			external: true,
		}));
	},
};

// Plugin for development shimming (for tests)
const vscodeShimPlugin: esbuild.Plugin = {
	name: 'vscode-shim',
	setup(build) {
		if (build.initialOptions.define?.NODE_ENV === '"test"') {
			build.onResolve({ filter: /^vscode$/ }, () => ({
				path: path.resolve(__dirname, 'src/test/suite/vscode-shim.ts'),
			}));
		}
	},
};

const isDev = process.argv.includes('--dev');
const isWatch = process.argv.includes('--watch');

async function main() {
	const contexts: esbuild.BuildContext[] = [];

	try {
		// Main extension build
		const extensionContext = await esbuild.context({
			entryPoints: ['src/extension.ts'],
			bundle: true,
			outfile: 'dist/extension.js',
			external: ['vscode'],
			format: 'cjs',
			platform: 'node',
			target: 'node18',
			sourcemap: isDev,
			minify: !isDev,
			keepNames: true,
			plugins: [vscodeExternalPlugin],
			define: {
				NODE_ENV: isDev ? '"development"' : '"production"',
			},
			logLevel: 'info',
		});

		contexts.push(extensionContext);

		if (isWatch) {
			// Watch mode
			console.log('🔍 Watching for changes...');
			await Promise.all(contexts.map(ctx => ctx.watch()));
		} else {
			// Build once
			console.log('🔨 Building...');
			await Promise.all(contexts.map(ctx => ctx.rebuild()));
			await Promise.all(contexts.map(ctx => ctx.dispose()));
			console.log('✅ Build complete');
		}
	} catch (error) {
		console.error('❌ Build failed:', error);
		await Promise.all(contexts.map(ctx => ctx.dispose()));
		process.exit(1);
	}
}

// Handle process termination gracefully
process.on('SIGINT', async () => {
	console.log('\n🛑 Build terminated');
	process.exit(0);
});

main().catch(console.error);
