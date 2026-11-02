// Copia la web a www/ (la carpeta que Capacitor mete dentro de la app de Android/iOS).
import { cp, rm, mkdir } from 'node:fs/promises';

const FILES = ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'data', 'vendor', 'icons'];
await rm('www', { recursive: true, force: true });
await mkdir('www');
for (const f of FILES) await cp(f, `www/${f}`, { recursive: true });
console.log('Web copiada a www/');
