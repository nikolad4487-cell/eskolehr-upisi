import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const functionsRoot = join(root, 'supabase', 'functions');
const outputRoot = join(root, 'supabase', 'functions-editor');
const functionNames = [
  'send-admissions-pin',
  'verify-admissions-pin',
  'list-school-admission-pins',
];

const shared = await readFile(
  join(functionsRoot, '_shared', 'admissions-pin.ts'),
  'utf8',
);

function removeSharedImport(source) {
  return source.replace(
    /import\s*\{[\s\S]*?\}\s*from\s*['"]\.\.\/_shared\/admissions-pin\.ts['"];\s*/,
    '',
  );
}

for (const functionName of functionNames) {
  const source = await readFile(
    join(functionsRoot, functionName, 'index.ts'),
    'utf8',
  );
  const outputDirectory = join(outputRoot, functionName);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    join(outputDirectory, 'index.ts'),
    `${shared.trim()}\n\n${removeSharedImport(source).trim()}\n`,
    'utf8',
  );
}

console.log(`Created ${functionNames.length} standalone Edge Function files.`);
