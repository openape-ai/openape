/* Baut data.js in die drei Varianten ein, damit jede Datei allein funktioniert
   (Safari laedt unter file:// keine benachbarten Skripte nach).  Aufruf: node build.mjs */
import { readFileSync, writeFileSync } from 'node:fs';

const daten = readFileSync(new URL('./data.js', import.meta.url), 'utf8');
const marker = /<script id="crm-data">[\s\S]*?<\/script>/;

for (const datei of ['variante-a-klassik.html', 'variante-b-fokus.html', 'variante-c-atelier.html']) {
  const url = new URL(`./${datei}`, import.meta.url);
  const html = readFileSync(url, 'utf8');
  if (!marker.test(html)) throw new Error(`Marker <script id="crm-data"> fehlt in ${datei}`);
  writeFileSync(url, html.replace(marker,
    `<script id="crm-data">\n/* AUTOMATISCH EINGEBETTET AUS data.js – dort aendern, dann "node build.mjs" */\n${daten}\n</script>`));
  console.log(`${datei}: data.js eingebettet (${Math.round(daten.length / 1024)} KB)`);
}
