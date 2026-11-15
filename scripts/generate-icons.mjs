// Generate the app's own code-native icon without external raster dependencies.
import { deflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
function crc32(buffer) { let c = 0xffffffff; for (const byte of buffer) { c ^= byte; for (let i=0;i<8;i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const t = Buffer.from(type); const size = Buffer.alloc(4); size.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t,data]))); return Buffer.concat([size,t,data,crc]); }
for (const size of [192,512]) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const px = x / size * 192, py = y / size * 192;
    const p = (px>=58 && px<=79 && py>=49 && py<=145) || (px>=72 && px<=106 && ((py>=49 && py<=71)||(py>=101&&py<=123))) || (px>=103 && px<=143 && Math.hypot((px-104)/1.0,(py-86)/1.0)<38 && !(Math.hypot(px-104,py-86)<16));
    const dot = Math.hypot(px-141,py-143) < 10;
    const col = dot ? [216,237,157] : p ? [255,253,247] : [71,119,93];
    const offset = y * (size*4+1)+1+x*4; raw.set([...col,255],offset);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size,0); header.writeUInt32BE(size,4); header[8]=8; header[9]=6;
  await writeFile(new URL(`../public/icon-${size}.png`,import.meta.url),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
}
console.log('PWA icons generated: 192px, 512px');
