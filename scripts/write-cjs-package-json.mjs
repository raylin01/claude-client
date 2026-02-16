import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const cjsDir = join(process.cwd(), 'dist', 'cjs');
await mkdir(cjsDir, { recursive: true });
await writeFile(join(cjsDir, 'package.json'), '{"type":"commonjs"}\n', 'utf8');
