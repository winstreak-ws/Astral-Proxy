import { promises as fs } from 'node:fs';
import path from 'node:path';

async function listTsFiles(root) {
  const out = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && p.endsWith('.ts') && !p.endsWith('.d.ts')) out.push(p);
    }
  }
  await walk(root);
  return out;
}

async function genManifest({ globRoot, manifestPath }) {
  const files = await listTsFiles(globRoot);
  files.sort();
  const lines = ['// AUTO-GENERATED. Do not edit.', ''];

  const vars = [];
  for (let i = 0; i < files.length; i++) {
    const abs = files[i];
    let relFromManifest = path.relative(path.dirname(manifestPath), abs)
      .replace(/\\/g, '/')
      .replace(/\.ts$/, '');

    if (!relFromManifest.startsWith('.')) {
      relFromManifest = './' + relFromManifest;
    }

    const varName = `m${i}`;
    lines.push(`import ${varName} from '${relFromManifest}.js';`);
    vars.push(varName);
  }

  lines.push('', `export const MANIFEST = [${vars.join(', ')}];`, '');
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, lines.join('\n'), 'utf8');
  console.log(`Generated ${manifestPath} with ${files.length} entries`);
}

const root = process.cwd();

await genManifest({
  globRoot: path.join(root, 'src', 'commands', 'impl'),
  manifestPath: path.join(root, 'src', 'commands', '_manifest.ts')
});

await genManifest({
  globRoot: path.join(root, 'src', 'mods', 'impl'),
  manifestPath: path.join(root, 'src', 'mods', '_manifest.ts')
});
