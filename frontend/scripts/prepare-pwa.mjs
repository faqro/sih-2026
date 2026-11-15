import { copyFile, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = fileURLToPath(new URL('../', import.meta.url));
const publicDirectory = path.join(projectDirectory, 'public');
const outputDirectory = path.join(projectDirectory, 'dist');
await rm(path.join(outputDirectory, 'favicon.ico'), { force: true });

for (const fileName of [
  'UberDaps-v1.jpg',
  'manifest.webmanifest',
  'service-worker.js',
]) {
  await copyFile(
    path.join(publicDirectory, fileName),
    path.join(outputDirectory, fileName),
  );
}

const indexPath = path.join(outputDirectory, 'index.html');
let html = await readFile(indexPath, 'utf8');

html = html.replace(
  /<link\b[^>]*\brel=["'](?:manifest|(?:shortcut )?icon|apple-touch-icon)["'][^>]*>\s*/gi,
  '',
);
html = html.replace(
  /<!-- UberDaps PWA metadata start -->[\s\S]*?<!-- UberDaps PWA metadata end -->\s*/gi,
  '',
);
html = html.replace(
  /<meta\b[^>]*\bname=["']theme-color["'][^>]*>\s*/gi,
  '',
);

const pwaHead = `
<!-- UberDaps PWA metadata start -->
<meta name="theme-color" content="#000000">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<meta name="apple-mobile-web-app-title" content="UberDaps">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" type="image/jpeg" href="/UberDaps-v1.jpg">
<link rel="apple-touch-icon" href="/UberDaps-v1.jpg">
<script>
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/service-worker.js').catch(function (error) {
        console.error('Unable to register the UberDaps service worker.', error);
      });
    });
  }
</script>
<!-- UberDaps PWA metadata end -->
`;

if (!html.includes('</head>')) {
  throw new Error('Expo web export is missing the document head.');
}

html = html.replace('</head>', `${pwaHead}</head>`);
await writeFile(indexPath, html);
