/**
 * vault-wire.js
 *
 * 1. Creates vault notes for source files that are missing them
 * 2. Creates vault notes for graph nodes that don't have them
 * 3. Adds [[source_file.ts]] wiki-links to node notes that are missing them
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VAULT = path.join(ROOT, 'vault');
const GRAPH = path.join(ROOT, 'graphify-out', 'graph.json');

const graph = JSON.parse(fs.readFileSync(GRAPH, 'utf8'));
const nodes = graph.nodes || [];

// Sanitize a label into a valid filename (same as graphify uses for most nodes,
// but strip characters that Windows/FS cannot tolerate)
function sanitizeLabel(label) {
  return label
    .replace(/[\\/:*?"<>|\n\r]/g, '_')   // illegal FS chars + newlines
    .replace(/\s{2,}/g, ' ')             // collapse whitespace
    .trim()
    .slice(0, 200);                       // cap length
}

function vaultFile(label) {
  return path.join(VAULT, sanitizeLabel(label) + '.md');
}

// --- STEP 1: Collect all source files referenced in graph ---
const srcFileMap = new Map(); // basename -> full relative path
nodes.forEach(n => {
  if (n.source_file) {
    const base = path.basename(n.source_file);
    if (!srcFileMap.has(base)) {
      srcFileMap.set(base, n.source_file);
    }
  }
});

// --- STEP 2: Create missing source file vault notes ---
let createdFiles = 0;
srcFileMap.forEach((relativePath, base) => {
  const notePath = path.join(VAULT, base + '.md');
  if (fs.existsSync(notePath)) return; // already exists

  const absPath = path.join(ROOT, relativePath);
  const exists = fs.existsSync(absPath);
  const matchNode = nodes.find(n => n.source_file === relativePath);
  const community = (matchNode && matchNode.community_name) || 'Unknown';
  const communityTag = String(community).replace(/\s+/g, '_');

  const content = `---
source_file: "${relativePath}"
type: "code"
community: "${community}"
location: "L1"
tags:
  - graphify/code
  - graphify/EXTRACTED
  - community/${communityTag}
---

# ${base}

${exists ? `> **File:** \`${relativePath}\`` : `> ⚠️ Source file not found at \`${relativePath}\``}

## Connections

#graphify/code #graphify/EXTRACTED #community/${communityTag}
`;

  fs.writeFileSync(notePath, content, 'utf8');
  createdFiles++;
  console.log('Created source file note:', base + '.md');
});

// --- STEP 3: Create missing node vault notes ---
let createdNodes = 0;
nodes.forEach(n => {
  if (!n.source_file) return;
  const notePath = vaultFile(n.label);
  if (fs.existsSync(notePath)) return;

  const srcBase = path.basename(n.source_file);
  const community = n.community_name || 'Unknown';
  const communityTag = String(community).replace(/\s+/g, '_');
  const nodeType = n.type || 'code';
  const location = n.location || 'L1';

  const content = `---
source_file: "${n.source_file}"
type: "${nodeType}"
community: "${community}"
location: "${location}"
tags:
  - graphify/code
  - graphify/EXTRACTED
  - community/${communityTag}
---

# ${n.label}

## Connections
- [[${srcBase}]] - \`defined_in\` [EXTRACTED]

#graphify/code #graphify/EXTRACTED #community/${communityTag}
`;
  fs.writeFileSync(notePath, content, 'utf8');
  createdNodes++;
  if (createdNodes <= 5) console.log('Created node note:', n.label + '.md');
});
if (createdNodes > 5) console.log(`... and ${createdNodes - 5} more node notes`);

// --- STEP 4: Add missing [[source_file.ts]] links to existing node notes ---
let patched = 0;
nodes.forEach(n => {
  if (!n.source_file) return;
  const notePath = vaultFile(n.label);
  if (!fs.existsSync(notePath)) return;

  const content = fs.readFileSync(notePath, 'utf8');
  const srcBase = path.basename(n.source_file);
  const link = `[[${srcBase}]]`;

  // Skip if already present
  if (content.includes(link)) return;

  // Find "## Connections" section and append or add the link
  let updated;
  if (content.includes('## Connections')) {
    // Insert just before the trailing tags line or end
    const tagLine = content.match(/\n#graphify\//);
    if (tagLine) {
      const insertAt = content.lastIndexOf('\n#graphify/');
      updated = content.slice(0, insertAt) +
        `\n- ${link} - \`defined_in\` [EXTRACTED]` +
        content.slice(insertAt);
    } else {
      updated = content + `\n- ${link} - \`defined_in\` [EXTRACTED]\n`;
    }
  } else {
    // Append a connections section before tags
    const tagLine = content.match(/\n#graphify\//);
    if (tagLine) {
      const insertAt = content.lastIndexOf('\n#graphify/');
      updated = content.slice(0, insertAt) +
        `\n\n## Connections\n- ${link} - \`defined_in\` [EXTRACTED]` +
        content.slice(insertAt);
    } else {
      updated = content + `\n\n## Connections\n- ${link} - \`defined_in\` [EXTRACTED]\n`;
    }
  }

  fs.writeFileSync(notePath, updated, 'utf8');
  patched++;
});

console.log('\n=== vault-wire.js complete ===');
console.log('Source file notes created:', createdFiles);
console.log('Node notes created:       ', createdNodes);
console.log('Node notes patched:       ', patched);
