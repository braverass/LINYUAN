/**
 * Builds SECTION-INDEX.md: a non-destructive table of contents for the large
 * Canon files registered in SOURCE_REGISTRY.yaml (top-level "# " sections with
 * line ranges and sizes). It never modifies or splits the Canon files.
 *
 *   npm run index:sections          write SECTION-INDEX.md
 *   npm run index:sections -- --check   fail if SECTION-INDEX.md is stale
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN_BYTES = 30 * 1024;
const OUT = path.join(ROOT, 'SECTION-INDEX.md');

interface Source {
  path: string;
  routing_hint?: string;
}

interface Section {
  title: string;
  start: number;
  end: number;
  bytes: number;
}

function sections(text: string): { sections: Section[]; lines: number } {
  const lines = text.split('\n');
  const heads: { title: string; start: number }[] = [];
  let fence = false;
  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    if (/^(```|~~~)/.test(line)) fence = !fence;
    if (!fence && /^# \S/.test(line)) {
      heads.push({ title: line.slice(2).trim(), start: i + 1 });
    }
  });
  const out: Section[] = heads.map((h, idx) => {
    let end = idx + 1 < heads.length ? heads[idx + 1]!.start - 1 : lines.length;
    // Trim bundle separators ("---", "## NN-name") and blank lines that belong to the next file.
    while (end > h.start && /^(\s*|---\s*|## \d\d-.*)$/.test(lines[end - 1]!.replace(/\r$/, ''))) end--;
    const bytes = Buffer.byteLength(lines.slice(h.start - 1, end).join('\n'), 'utf8');
    return { ...h, end, bytes };
  });
  return { sections: out, lines: lines.length };
}

function size(bytes: number): string {
  return bytes >= 1024 * 1024
    ? (bytes / 1024 / 1024).toFixed(1) + ' MB'
    : Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

async function build(): Promise<string> {
  const registry = parse(await readFile(path.join(ROOT, 'SOURCE_REGISTRY.yaml'), 'utf8')) as {
    sources: Record<string, Source>;
  };
  const out: string[] = [
    '# SECTION-INDEX · 大文件章节目录',
    '',
    '> 自动生成（`npm run index:sections`），请勿手改。不修改、不拆分任何 Canon 文件，仅提供目录。',
    '>',
    '> 用法：聊天模型无法通读大文件时，先看这里选出相关章节，再**按行号范围**或**按标题搜索**读取该章节。',
    '> 行号是 1 起算的物理行号；“大小”为该章节的 UTF-8 字节数。文件路径与 semantic ID 的唯一来源仍是 `SOURCE_REGISTRY.yaml`。',
    '',
  ];
  for (const [id, src] of Object.entries(registry.sources)) {
    const text = await readFile(path.join(ROOT, src.path), 'utf8');
    if (Buffer.byteLength(text, 'utf8') < MIN_BYTES) continue;
    const { sections: secs, lines } = sections(text);
    if (secs.length < 2) continue;
    out.push(`## \`${id}\` — ${src.path}`, '');
    out.push(`共 ${lines} 行，${size(Buffer.byteLength(text, 'utf8'))}，${secs.length} 个章节。`, '');
    out.push('| 行号范围 | 大小 | 章节 |', '|---|---|---|');
    for (const s of secs) {
      out.push(`| ${s.start}–${s.end} | ${size(s.bytes)} | ${s.title.replace(/\|/g, '\\|')} |`);
    }
    out.push('');
  }
  return out.join('\n');
}

const next = await build();
if (process.argv.includes('--check')) {
  const current = await readFile(OUT, 'utf8').catch(() => '');
  if (current !== next) {
    console.error('SECTION-INDEX.md is stale. Run: npm run index:sections');
    process.exit(1);
  }
  console.log('SECTION-INDEX.md is up to date.');
} else {
  await writeFile(OUT, next, 'utf8');
  console.log('Wrote ' + path.relative(ROOT, OUT));
}
