import { world, system, BlockPermutation, Vector3, Player, PlayerJoinAfterEvent, PlayerSpawnAfterEvent, PlayerDimensionChangeAfterEvent } from '@minecraft/server';

interface BlockPermutationWithState extends BlockPermutation {
    getState<ValueType extends (number | string | boolean) = any>(stateProperty: string): ValueType;
}

type DimensionId = 'overworld' | 'nether' | 'the_end';

interface Location extends Vector3 {
    dimension: DimensionId;
}

type LocationSlug = `${DimensionId}:${number},${number},${number}`;
type ChunkSlug = `${DimensionId}:${number},${number}`;

const advancedNoteBlockRegistry: Record<LocationSlug, null> = {};
const tickableChunks: Record<ChunkSlug, null> = {};
const playerLatestChunk: Record<string, ChunkSlug> = {};

system.runTimeout(() => {
    for (const player of world.getAllPlayers()) {
        playerLatestChunk[player.id] = getPlayerChunkTag(player);
    }
});

world.afterEvents.playerSpawn.subscribe((event) => {
    const { player } = event;
    
    updatePlayerChunk(player);
    console.log(JSON.stringify({ message: 'Players now online', list: playerLatestChunk }, null, 4))
});

world.afterEvents.playerDimensionChange.subscribe((event) => {
    const { player } = event;
    
    updatePlayerChunk(player);
});

world.afterEvents.playerLeave.subscribe((event) => {
    if (event.playerId in playerLatestChunk) {
        delete playerLatestChunk[event.playerId];
    }
    
    console.log(JSON.stringify({ message: 'Players now online', list: Object.keys(playerLatestChunk) }))
});

world.afterEvents.playerPlaceBlock.subscribe((event) => {
    if (!event.block.permutation.matches('expandednotes:advanced_note_block')) {
        return;
    }
    
    advancedNoteBlockRegistry[`${event.block.dimension.id}:${event.block.location.x},${event.block.location.y},${event.block.location.z}`] = null;
    
    const permutation = event.block.permutation as BlockPermutationWithState;
    
    world.getDimension('overworld')
        .runCommand(`say pitch set to ${permutation.getState('expandednotes:pitch')} at ${event.block.x}, ${event.block.y}, ${event.block.z}`);
});

world.afterEvents.playerBreakBlock.subscribe((event) => {
    if (!event.block.permutation.matches('expandednotes:advanced_note_block')) {
        return;
    }
    
    delete advancedNoteBlockRegistry[`${event.block.dimension.id}:${event.block.location.x},${event.block.location.y},${event.block.location.z}`];
});

system.runInterval(() => {
    const players = world.getAllPlayers();
    
    for (const player of players) {
        const dimension = player.dimension.id;
        const currentChunkTag = getPlayerChunkTag(player);
        
        if (playerLatestChunk[player.id] == currentChunkTag) continue;
        
        playerLatestChunk[player.id] = currentChunkTag;
    }
    console.log(JSON.stringify(playerLatestChunk, null, 4));
}, 30);

function updatePlayerChunk(player: Player) {
    playerLatestChunk[player.id] = getPlayerChunkTag(player);
}

function getPlayerChunkTag(player: Player): ChunkSlug {
    const currentChunk = getChunkOrigin(player.location.x, player.location.z, player.dimension.id as DimensionId);
    
    return `${currentChunk.dimension}:${currentChunk.x},${currentChunk.z}`;
}

function getChunkOrigin(x: number, z: number, dimension: DimensionId = 'overworld') {
    return {
        x: Math.floor(x) - (Math.floor(x) % 16) - (x < 0 ? 15 : 0),
        z: Math.floor(z) - (Math.floor(z) % 16) - (z < 0 ? 15 : 0),
        y: world.getDimension(dimension).heightRange.min,
        dimension,
    };
}

// for now, aims for diamond in a 4-chunk distance from the center
function getTickableAreas(x: number, z: number, dimension: DimensionId = 'overworld') {
    const tickingAreas: Location[] = [];
    
    let xOffset = x;
    let zOffset = z + 4;
    
    while (zOffset >= z - 4) {
        tickingAreas.push({
            x: xOffset * 16,
            y: world.getDimension(dimension).heightRange.min,
            z: zOffset * 16,
            dimension,
        });
        
        if (zOffset == 4 || zOffset == -4) {
            xOffset = -1;
            zOffset--;
        }
        else if ((zOffset == 3 || zOffset == -3) && xOffset == 1) {
            xOffset = -2;
            zOffset--;
        }
        else if ((zOffset == 2 || zOffset == -2) && xOffset == 2) {
            xOffset = -3;
            zOffset--;
        }
        else if ((zOffset == 1 || zOffset == -1) && xOffset == 3) {
            xOffset = -4;
            zOffset--;
        }
        else if (zOffset == 0 && xOffset == 4) {
            xOffset
        }
        else {
            xOffset++;
        }
    }
    
    return tickingAreas;
}

function isChunkTickable(x: number, z: number, dimension: DimensionId = 'overworld') {
    try {
        world.getDimension(dimension).getBlock({ x, y: 0, z });
        return true;
    }
    catch {
        return false;
    }
}

function discoverAdvancedNoteBlocksInChunk(x: number, z: number, dimensionId: DimensionId = 'overworld') {
    const dimension = world.getDimension(dimensionId);
    const chunkOrigin = getChunkOrigin(x, z, dimensionId);
    
    x = chunkOrigin.x;
    z = chunkOrigin.z;
    
    if (`${dimensionId}:${chunkOrigin.x},${chunkOrigin.z}` in tickableChunks) {
        // work already done
        return;
    }
    
    for (let currentY = dimension.heightRange.min; currentY < dimension.heightRange.max; currentY++)
    for (let currentX = x; currentX < x + 16; currentX++)
    for (let currentZ = z; currentZ < z + 16; currentZ++) {
        try {
            const block = dimension.getBlock({ x: currentX, y: currentY, z: currentZ });
            
            if (block.permutation.matches('expandednotes:advanced_note_block')) {
                advancedNoteBlockRegistry[`${dimensionId}:${currentX},${currentY},${currentZ}`] = null;
            }
        }
        catch (e) {
            // likely only happens if I'm targeting a block that's out of bounds
            console.log(e);
        }
    }
}
