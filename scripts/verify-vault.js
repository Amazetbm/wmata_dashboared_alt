const fs = require('fs');
const path = require('path');
const g = JSON.parse(fs.readFileSync('./graphify-out/graph.json', 'utf8'));
const nodes = g.nodes || [];
const VAULT = './vault/';

function sanitize(label) {
  return label.replace(/[\\/:*?"<>|\n\r]/g, '_').replace(/\s{2,}/g, ' ').trim().slice(0, 200);
}

let noNote = 0;
let noLink = 0;
let ok = 0;
nodes.filter(n => n.source_file).forEach(n => {
  const notePath = VAULT + sanitize(n.label) + '.md';
  if (!fs.existsSync(notePath)) { noNote++; return; }
  const content = fs.readFileSync(notePath, 'utf8');
  const srcBase = path.basename(n.source_file);
  if (content.includes('[[' + srcBase + ']]')) {
    ok++;
  } else {
    noLink++;
    if (noLink <= 3) console.log('Missing link:', n.label, '->', srcBase);
  }
});
console.log('OK (has source link):', ok);
console.log('No vault note:', noNote);
console.log('Note exists but missing link:', noLink);
