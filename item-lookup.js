const path = require('path');
const mcData = require('minecraft-data')('1.20.1');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const fetch = require('node-fetch');

const FONT_PATH = path.join(__dirname, 'Minecraftia.ttf');
GlobalFonts.registerFromPath(FONT_PATH, 'Minecraftia');

const BG_PATH = path.join(__dirname, 'crafting_bg.png');
let cachedBgImage = null;

const textureCache = new Map();
const ALL_ITEMS = Object.values(mcData.items);

function autocompleteItems(query) {
  const q = (query || '').trim().toLowerCase();
  let matches = ALL_ITEMS;

  if (q) {
    matches = ALL_ITEMS.filter(item =>
      item.name.toLowerCase().includes(q) ||
      (item.displayName && item.displayName.toLowerCase().includes(q))
    );
  }

  if (q) {
    matches.sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(q) || a.displayName.toLowerCase().startsWith(q);
      const bStarts = b.name.toLowerCase().startsWith(q) || b.displayName.toLowerCase().startsWith(q);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return a.displayName.localeCompare(b.displayName);
    });
  }

  return matches.slice(0, 25).map(item => ({
    name: `${item.displayName} (${item.name})`.slice(0, 100),
    value: item.name
  }));
}

function getItemData(itemNameOrId) {
  const searchStr = String(itemNameOrId || '').trim().toLowerCase().replace(/^minecraft:/, '');
  
  let item = mcData.itemsByName[searchStr];
  if (!item) {
    item = ALL_ITEMS.find(i => String(i.id) === searchStr || i.displayName.toLowerCase() === searchStr);
  }
  if (!item) return null;

  const recipes = mcData.recipes[item.id] || null;
  return { item, recipes };
}

async function getItemImage3D(itemObj) {
  if (!itemObj) return null;
  const key = itemObj.name;
  if (textureCache.has(key)) return textureCache.get(key);

  const displayName = itemObj.displayName || itemObj.name;
  const urls = [
    `https://minecraft.wiki/w/Special:FilePath/${encodeURIComponent(displayName.replace(/ /g, '_'))}.png`,
    `https://raw.githubusercontent.com/PrismarineJS/minecraft-assets/master/data/1.20.1/items/${itemObj.name}.png`,
    `https://raw.githubusercontent.com/PrismarineJS/minecraft-assets/master/data/1.20.1/blocks/${itemObj.name}.png`
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const buffer = await res.buffer();
        const img = await loadImage(buffer);
        textureCache.set(key, img);
        return img;
      }
    } catch (e) {}
  }

  textureCache.set(key, null);
  return null;
}

async function renderRecipeCanvas(recipe, resultItem) {
  if (!cachedBgImage) {
    cachedBgImage = await loadImage(BG_PATH);
  }

  const bg = cachedBgImage;
  const scale = 3;
  const canvas = createCanvas(bg.width * scale, bg.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  ctx.drawImage(bg, 0, 0, bg.width * scale, bg.height * scale);

  const grid = [
    [null, null, null],
    [null, null, null],
    [null, null, null]
  ];

  if (recipe.inShape) {
    for (let r = 0; r < recipe.inShape.length; r++) {
      for (let c = 0; c < recipe.inShape[r].length; c++) {
        grid[r][c] = recipe.inShape[r][c];
      }
    }
  } else if (recipe.ingredients) {
    let index = 0;
    for (const id of recipe.ingredients) {
      if (id !== null && id !== undefined) {
        const r = Math.floor(index / 3);
        const c = index % 3;
        if (r < 3) grid[r][c] = id;
        index++;
      }
    }
  }

  const inputSlotW = 32;
  const inputSlotH = 32;
  const inputColX = [6, 42, 78];
  const inputRowY = [5, 41, 77];
  const itemDim = 28;

  const outSlotX = 186;
  const outSlotY = 33;
  const outSlotW = 48;
  const outSlotH = 48;
  const outItemDim = 34;

  function centerIn(slotX, slotY, slotW, slotH, itemW, itemH) {
    return {
      x: Math.floor(slotX + (slotW - itemW) / 2),
      y: Math.floor(slotY + (slotH - itemH) / 2)
    };
  }

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const id = grid[r][c];
      if (id !== null && id !== undefined) {
        const itemObj = mcData.items[id] || mcData.blocks[id];
        if (itemObj) {
          const img = await getItemImage3D(itemObj);
          if (img) {
            const pos = centerIn(inputColX[c], inputRowY[r], inputSlotW, inputSlotH, itemDim, itemDim);
            ctx.drawImage(img, pos.x * scale, pos.y * scale, itemDim * scale, itemDim * scale);
          }
        }
      }
    }
  }

  const resultImg = await getItemImage3D(resultItem);
  if (resultImg) {
    const pos = centerIn(outSlotX, outSlotY, outSlotW, outSlotH, outItemDim, outItemDim);
    ctx.drawImage(resultImg, pos.x * scale, pos.y * scale, outItemDim * scale, outItemDim * scale);
  }

  const resultCount = recipe.result?.count || 1;
  if (resultCount > 1) {
    const textX = (outSlotX + outSlotW - 4) * scale;
    const textY = (outSlotY + outSlotH + 1) * scale;
    ctx.font = Math.round(16 * scale) + 'px Minecraftia';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = '#3f3f3f';
    ctx.fillText(`${resultCount}`, textX + 2 * scale, textY + 2 * scale);

    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${resultCount}`, textX, textY);
  }

  return canvas.toBuffer('image/png');
}

module.exports = {
  autocompleteItems,
  getItemData,
  getItemImage: getItemImage3D,
  renderRecipeCanvas
};
