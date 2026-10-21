const fs = require('fs');
const path = require('path');
const g = JSON.parse(fs.readFileSync('./graphify-out/graph.json', 'utf8'));
const nodes = g.nodes || [];

// Find nodes where community is not a string
const weird = nodes.filter(n => n.source_file && typeof n.community !== 'string' && n.community !== undefined);
console.log('Non-string community nodes:', weird.length);
if (weird.length > 0) console.log('Example:', JSON.stringify(weird[0]).slice(0, 200));

// Check nodes with no community field
const noCommunity = nodes.filter(n => n.source_file && n.community === undefined);
console.log('Nodes with no community field:', noCommunity.length);
if (noCommunity.length > 0) console.log('Example:', JSON.stringify(Object.keys(noCommunity[0])));

// Check srcFileMap and community lookup
const srcFileMap = new Map();
nodes.forEach(n => {
  if (n.source_file) {
    const base = path.basename(n.source_file);
    if (!srcFileMap.has(base)) srcFileMap.set(base, n.source_file);
  }
});

// Find community for each source file (from any node that references it)
let badCommunity = 0;
srcFileMap.forEach((relativePath, base) => {
  const matchNode = nodes.find(n => n.source_file === relativePath);
  const community = matchNode && matchNode.community;
  if (typeof community !== 'string' && community !== undefined && community !== null) {
    badCommunity++;
    if (badCommunity <= 3) console.log('Bad community for', base, ':', typeof community, JSON.stringify(community).slice(0, 100));
  }
});
console.log('Source files with bad community type:', badCommunity);
