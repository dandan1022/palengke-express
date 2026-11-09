const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'products');
const PHOTOS = {
  tomato: 'https://upload.wikimedia.org/wikipedia/commons/e/ee/Fresh_tomatoes.jpg',
  pechay: 'https://upload.wikimedia.org/wikipedia/commons/6/61/Bokchoy.jpg',
  carrot: 'https://upload.wikimedia.org/wikipedia/commons/4/4a/CARROT.jpg',
  eggplant: 'https://upload.wikimedia.org/wikipedia/commons/2/27/Philippine_Eggplant.jpg',
  pork: 'https://upload.wikimedia.org/wikipedia/commons/6/6b/Pork_Shoulder%2C_Coppa_Cut_%286853905869%29.jpg',
  chicken: 'https://upload.wikimedia.org/wikipedia/commons/d/d1/Raw_chicken.jpg',
  tilapia: 'https://upload.wikimedia.org/wikipedia/commons/c/c1/Fresh_Tilapia.jpg',
  shrimp: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Raw_Shrimp.jpg',
  mango: 'https://upload.wikimedia.org/wikipedia/commons/6/64/Mango_fruit.jpg',
  banana: 'https://upload.wikimedia.org/wikipedia/commons/f/f5/Banana_fruit.jpeg',
  rice: 'https://upload.wikimedia.org/wikipedia/commons/d/da/Rice_grains.jpg',
  eggs: 'https://upload.wikimedia.org/wikipedia/commons/0/0e/Chicken_eggs.jpg'
};

async function download(name, url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'PalengkeExpress/1.0 educational-project',
      'Accept': 'image/*,*/*;q=0.8'
    }
  });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const type = (res.headers.get('content-type') || '').toLowerCase();
  if (!type.startsWith('image/')) throw new Error(`${name}: not an image (${type})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 5000) throw new Error(`${name}: downloaded file too small`);
  fs.writeFileSync(path.join(OUT, `${name}.jpg`), buf);
  console.log(`Downloaded ${name}.jpg (${Math.round(buf.length / 1024)} KB)`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, url] of Object.entries(PHOTOS)) {
    try { await download(name, url); }
    catch (err) { console.error(`FAILED ${err.message}`); process.exitCode = 1; }
  }
  console.log(`\nPhotos folder: ${OUT}`);
})();
