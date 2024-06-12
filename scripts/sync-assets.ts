import { URL, fileURLToPath } from 'node:url';
import { basename, dirname, join } from 'node:path';
import { mkdir, readdir, copyFile, watch, stat, rm, FileChangeInfo } from 'node:fs/promises';
import { Dirent, Stats, existsSync } from 'node:fs';

const __dirname = fileURLToPath(new URL(dirname(import.meta.url)));

const __root = join(__dirname, '..');
const __src = join(__root, 'src');
const __dist = join(__root, 'dist');
const __backup = join(__root, 'node_modules', '.backup');

const registry: Record<string, true> = {};

for (const item of await readdir(__src, { withFileTypes: true, recursive: true })) {
    if (item.isFile() && !item.name.endsWith('.ts')) {
        registry[join(item.path, item.name)] = true;
        await copyToDist(item);
    }
}

let renameTimeout: NodeJS.Timeout = null;
for await (const item of watch(__src, { recursive: true })) {
    if (!item.filename) continue;
    
    console.log(item.eventType, item.filename);
    
    const srcPath = join(__src, item.filename!);
    const distPath = join(__dist, item.filename!);
    
    if (srcPath.endsWith('.ts')) continue;
    
    if (item.eventType == 'rename') {
        if (existsSync(distPath) && !existsSync(srcPath)) {
            if ((await stat(distPath)).isDirectory()) {
                await rm(distPath, { recursive: true, force: true });
                continue;
            }
            
            delete registry[srcPath];
            await removeFromDist(distPath);
            
            renameTimeout = setTimeout(async () => {
                for (const i of await readdir(__src, { withFileTypes: true, recursive: true })) {
                    const entryName = join(i.path, i.name);
                    
                    if (!(entryName in registry)) {
                        await copyToDist(i);
                    }
                }
            }, 100);
        }
        else if (!existsSync(distPath) && existsSync(srcPath)) {
            if (renameTimeout) {
                clearTimeout(renameTimeout);
                renameTimeout = null;
            }
            
            const stats = await stat(srcPath);
            
            if (stats.isDirectory()) continue;
            
            await copyToDist(statsToDirent(stats, item));
        }
        
    }
    else if (item.eventType == 'change') {
        const stats = await stat(srcPath);
        
        if (stats.isDirectory()) continue;
        
        await copyToDist(statsToDirent(stats, item));
    }
}

async function copyToDist(item: Dirent) {
    const currentPath = join(item.path, item.name);
    const pathFromSrc = item.path.slice(__src.length);
    const pathInDist = join(__dist, pathFromSrc);
    const finalPath = join(pathInDist, item.name);
    
    if (!existsSync(pathInDist)) {
        await mkdir(pathInDist, { recursive: true });
    }
    
    let backupLocation = '';
    
    if (existsSync(finalPath)) {
        const newStats = await stat(currentPath);
        const currentStats = await stat(finalPath);
        
        if (newStats.mtime == currentStats.mtime) {
            return;
        }
        
        if (!existsSync(join(__backup, pathFromSrc))) {
            await mkdir(join(__backup, pathFromSrc), { recursive: true });
        }
        
        backupLocation = join(__backup, pathFromSrc, item.name);
        
        await copyFile(finalPath, backupLocation);
    }
    
    try {
        await copyFile(currentPath, finalPath);
        
        if (backupLocation) {
            await rm(backupLocation, { force: true });
        }
    }
    catch (e) {
        console.error(`Couldn\'t copy file ${item.name} from path ${pathFromSrc} to path ${pathInDist}:`, e);
        
        if (backupLocation) {
            await copyFile(backupLocation, finalPath);
            await rm(backupLocation, { force: true });
        }
    }
}

function statsToDirent(stats: Stats, item: FileChangeInfo<string>) {
    return new Proxy<Dirent>(stats as unknown as Dirent, {
        get(target, property) {
            if (property == 'name') {
                return basename(item.filename!);
            }
            
            if (property == 'path') {
                return join(__src, dirname(item.filename!));
            }
            
            return target[property];
        },
    })
}

async function removeFromDist(itemPath: string) {
    if (!itemPath.startsWith(__dist)) {
        console.warn(`Attempted to delete from dist ${itemPath} when the path doesn't point to the dist directory`);
        return;
    }
    if (!existsSync(itemPath)) return;
    
    await rm(itemPath);
    
    const dir = dirname(itemPath);
    
    if (dir == __dist) return;
    
    const items = await readdir(dir);
    
    if (!items.length) {
        await rm(dir, { recursive: true, force: true });
    }
}
