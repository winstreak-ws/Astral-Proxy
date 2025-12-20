const itemNames: Record<number, string> = {
  // Swords
    268: 'minecraft:wooden_sword',
    272: 'minecraft:stone_sword',
    276: 'minecraft:diamond_sword',
    283: 'minecraft:golden_sword',
    267: 'minecraft:iron_sword',
    // Pickaxes
    278: 'minecraft:diamond_pickaxe',
    285: 'minecraft:golden_pickaxe',
    257: 'minecraft:iron_pickaxe',
    274: 'minecraft:stone_pickaxe',
    270: 'minecraft:wooden_pickaxe',
    // Leggings
    304: 'minecraft:chainmail_leggings',
    312: 'minecraft:diamond_leggings',
    316: 'minecraft:golden_leggings',
    308: 'minecraft:iron_leggings',
    300: 'minecraft:leather_leggings',
    // Boots
    305: 'minecraft:chainmail_boots',
    313: 'minecraft:diamond_boots',
    317: 'minecraft:golden_boots',
    309: 'minecraft:iron_boots',
    301: 'minecraft:leather_boots',
    // Bows
    261: 'minecraft:bow',
    // Consumables
    322: 'minecraft:golden_apple',
    373: 'minecraft:potion'

};

export function getItemNameFromId(blockId: number): string | undefined {
  return itemNames[blockId];
}

