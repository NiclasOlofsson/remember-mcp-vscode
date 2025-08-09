#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const readmePath = path.join(__dirname, '..', 'README.md');
const marketplaceReadmePath = path.join(__dirname, '..', 'README_marketplace.md');

if (!fs.existsSync(readmePath)) {
    console.error('README.md not found');
    process.exit(1);
}

const content = fs.readFileSync(readmePath, 'utf8');

// Remove content between marketplace exclude markers
let marketplaceContent = content
    // Remove HTML comment blocks (preserve surrounding newlines)
    .replace(/<!-- MARKETPLACE-EXCLUDE-START -->[\s\S]*?<!-- MARKETPLACE-EXCLUDE-END -->\n?/g, '')
    .replace(/<!-- DEV-ONLY-START -->[\s\S]*?<!-- DEV-ONLY-END -->\n?/g, '')
    .replace(/<!-- GITHUB-ONLY-START -->[\s\S]*?<!-- GITHUB-ONLY-END -->\n?/g, '')
    
    // Remove build badges and dev-specific badges (entire lines)
    .replace(/^.*\[\!\[.*?build.*?\]\(.*?\)\]\(.*?\).*$/gim, '')
    .replace(/^.*\[\!\[.*?CI.*?\]\(.*?\)\]\(.*?\).*$/gim, '')
    .replace(/^.*\[\!\[.*?test.*?\]\(.*?\)\]\(.*?\).*$/gim, '')
    .replace(/^.*\[\!\[.*?Tests.*?\]\(.*?\)\]\(.*?\).*$/gim, '')
    
    // Clean up multiple consecutive newlines (max 2)
    .replace(/\n{3,}/g, '\n\n')
    
    // Trim whitespace from start and end
    .trim();

// Ensure the content ends with a single newline
if (!marketplaceContent.endsWith('\n')) {
    marketplaceContent += '\n';
}

// Write the filtered content to marketplace README
fs.writeFileSync(marketplaceReadmePath, marketplaceContent);

console.log('✅ Generated README_marketplace.md from README.md');
console.log(`📏 Original: ${content.length} chars, Marketplace: ${marketplaceContent.length} chars`);
console.log(`🚀 Ready for packaging with --readme-path README_marketplace.md`);
