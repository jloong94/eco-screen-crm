const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const required = ['index.html', 'src/app.js', 'src/styles.css'];
const failures = [];

for (const file of required) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) failures.push(`Missing ${file}`);
  const text = fs.readFileSync(full, 'utf8');
  if (text.includes('\t')) failures.push(`${file} contains tabs`);
  if (/\bconsole\.log\(/.test(text)) failures.push(`${file} contains console.log`);
}

const app = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
for (const token of ['boss1', 'SO', 'crm_stable_sync', 'moveBackToFollowUp', 'RESTORE', 'DELETE']) {
  if (!app.includes(token)) failures.push(`Expected token not found: ${token}`);
}

if (failures.length) {
  process.stderr.write(failures.join('\n') + '\n');
  process.exit(1);
}

process.stdout.write('Lint passed\n');
