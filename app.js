// app.js - UI glue. Imports nothing; uses window.NESFlix and window.gifuct.

'use strict';

const $ = (id) => document.getElementById(id);

let pendingGifBuffer = null;
let pendingFileName  = null;
let templateBytes    = null;   // fetched once, on demand

$('gifInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  pendingFileName = file.name;
  $('filename').textContent = file.name;
  pendingGifBuffer = await file.arrayBuffer();
  $('convertBtn').disabled = false;
  hideStatus();
});

$('convertBtn').addEventListener('click', async () => {
  if (!pendingGifBuffer) return;
  const deleteFirstTile = $('deleteFirstTile').checked;

  showStatus();
  setMessage('converting...');
  $('stats').innerHTML = '';
  $('download').innerHTML = '';

  // yield to the browser so the message paints before we churn through pixels
  await new Promise(r => setTimeout(r, 0));

  let result;
  try {
    const t0 = performance.now();
    result = window.NESFlix.convertGifToChr(pendingGifBuffer, { deleteFirstTile });
    const elapsed = (performance.now() - t0).toFixed(0);

    setStats({
      'frames':    `${result.frameCount} / ${window.NESFlix.MAX_FRAMES}`,
      'colors':    `${result.colorCount} in frame 0`,
      'CHR bytes': result.chr.length.toLocaleString(),
      'elapsed':   `${elapsed} ms`,
    });
  } catch (err) {
    setMessage(err.message, 'fail');
    return;
  }

  setMessage('packaging ROM...');
  await new Promise(r => setTimeout(r, 0));

  try {
    if (!templateBytes) {
      const resp = await fetch('assets/template.bin');
      if (!resp.ok) throw new Error(`could not fetch template.bin (${resp.status})`);
      templateBytes = await resp.arrayBuffer();
    }
    const nes = window.NESFlix.buildNesRom(templateBytes, result.chr.buffer);
    setMessage('done.', 'ok');

    const blob = new Blob([nes], { type: 'application/octet-stream' });
    const url  = URL.createObjectURL(blob);
    const stem = pendingFileName.replace(/\.gif$/i, '');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${stem}.nes`;
    a.textContent = `download ${stem}.nes (${nes.length.toLocaleString()} bytes)`;
    a.className = 'download-link';
    $('download').innerHTML = '';
    $('download').appendChild(a);
  } catch (err) {
    setMessage(err.message, 'fail');
  }
});

function showStatus() { $('status').classList.remove('hidden'); }
function hideStatus() { $('status').classList.add('hidden'); }

function setMessage(text, kind) {
  const el = $('message');
  el.textContent = text;
  el.className = kind || '';
}

function setStats(map) {
  const items = Object.entries(map)
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('stats').innerHTML = items;
}
