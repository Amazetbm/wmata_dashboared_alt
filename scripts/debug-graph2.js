const fs = require('fs');
const g = JSON.parse(fs.readFileSync('./graphify-out/graph.json', 'utf8'));
console.log('Graph top-level keys:', Object.keys(g));
if (g.communities) {
  console.log('Communities:', JSON.stringify(g.communities).slice(0, 500));
}
if (g.metadata) {
  console.log('Metadata:', JSON.stringify(g.metadata).slice(0, 300));
}
// Show a full node
const nodes = g.nodes || [];
console.log('\nFull node example:');
console.log(JSON.stringify(nodes[0]).slice(0, 500));
