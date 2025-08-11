# Build System Migration Guide

This guide walks through migrating from Webpack to esbuild for dramatically improved build performance.

## Installation

Install the new dependencies:

```bash
npm install --save-dev esbuild tsx npm-run-all @stylistic/eslint-plugin eslint-plugin-header eslint-plugin-import eslint-plugin-jsdoc eslint-import-resolver-typescript vitest @vitest/coverage-v8 husky lint-staged
```

## Remove Old Dependencies

```bash
npm uninstall webpack webpack-cli ts-loader
```

## New Build Scripts

### Development Build
```bash
npm run compile
```

### Watch Mode (Parallel TypeCheck + Build)
```bash
npm run watch
```

### Production Build
```bash
npm run build
```

### Testing
```bash
# Run unit tests
npm run test:unit

# Watch unit tests
npm run test:watch

# Run integration tests (existing)
npm test
```

### Linting
```bash
# Lint all files
npm run lint

# Lint staged files (for pre-commit)
npm run lint-staged
```

## Performance Improvements

### Expected Build Speed Improvements:
- **Development builds:** 5-10x faster (from ~2-5s to ~0.2-0.5s)
- **Watch mode rebuilds:** Near-instantaneous (~50-100ms)
- **TypeScript compilation:** Parallel with build process
- **Memory usage:** Lower memory footprint

### Benchmark Comparison:
- **Webpack 5:** ~2-5s for typical builds
- **esbuild:** ~0.1-0.5s for same builds
- **Watch mode:** Webpack ~500ms+ vs esbuild ~50-100ms

## New Features

### Enhanced Linting
- Comprehensive ESLint rules based on Microsoft standards
- Import path restrictions and architectural constraints
- Stylistic consistency enforcement
- Header copyright enforcement

### Modern Testing
- Vitest for fast unit testing
- Better VS Code API mocking
- Coverage reporting
- Parallel test execution

### Developer Experience
- Parallel processes (build + typecheck)
- Better error reporting
- Source map support for debugging
- Incremental builds

## Migration Checklist

- [ ] Install new dependencies
- [ ] Remove old dependencies  
- [ ] Test build scripts work correctly
- [ ] Verify extension bundles and loads properly
- [ ] Update CI/CD pipelines to use new scripts
- [ ] Train team on new commands

## Troubleshooting

### Common Issues:

1. **TypeScript errors in build:**
   - Run `npm run typecheck` to see full TypeScript errors
   - esbuild only transpiles, doesn't type-check

2. **Import resolution issues:**
   - Check that all imports use correct file extensions
   - Verify tsconfig.json paths are correct

3. **VS Code API not found:**
   - Ensure 'vscode' is properly externalized in build config
   - Check that @types/vscode version matches engine requirement

## Performance Monitoring

To measure the improvement:

1. **Before migration:** Time the current `npm run compile` command
2. **After migration:** Time the new `npm run compile` command  
3. **Watch mode:** Compare rebuild times when files change

Expected results: 10-100x improvement in build speeds.

## Rollback Plan

If issues arise, you can temporarily rollback:

1. Keep the old `webpack.config.js` file
2. Reinstall webpack dependencies
3. Revert package.json scripts
4. Use `git checkout HEAD~1 package.json` to restore previous state

The new build system is designed to be a drop-in replacement with identical output.
