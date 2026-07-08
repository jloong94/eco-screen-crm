const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'src'), { recursive: true });

for (const file of ['index.html', 'src/app.js', 'src/styles.css']) {
  fs.copyFileSync(path.join(root, file), path.join(dist, file));
}

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
if (!html.includes('Eco Screen CRM Stable')) {
  throw new Error('Build verification failed');
}

process.stdout.write(`Build completed: ${dist}\n`);
