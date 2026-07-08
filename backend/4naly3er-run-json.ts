import fs from 'fs';
import path from 'path';
import compileAndBuildAST from './src/compile';
import issues from './src/issues';
import { InputType, Instance } from './src/types';
import { recursiveExploration, lineFromIndex } from './src/utils';

const rawPath = process.argv[2] ?? 'contracts/';
const basePath = rawPath.endsWith('/') ? rawPath : rawPath + '/';
// Optional: relative path of the single file to analyse (passed by the backend for per-contract runs)
const targetFile: string | null = process.argv[3] ?? null;

// Foundry bare-name imports → npm scoped equivalents.
// Contracts installed via `forge install` use paths like "openzeppelin-contracts/token/ERC20/IERC20.sol"
// while npm installs use "@openzeppelin/contracts/token/ERC20/IERC20.sol".
// Both resolve to the same physical file through our node_modules symlinks, but solc treats them
// as distinct compilation units and raises duplicate-declaration errors.
// We rewrite all Foundry-style imports to npm-style before compilation so only one canonical
// path exists for each file.
const IMPORT_REMAPPINGS: [RegExp, string][] = [
  [/(?<=['"])openzeppelin-contracts-upgradeable\//g, '@openzeppelin/contracts-upgradeable/'],
  [/(?<=['"])openzeppelin-contracts\//g, '@openzeppelin/contracts/'],
];

function normalizeImports(content: string): string {
  let out = content;
  for (const [pattern, replacement] of IMPORT_REMAPPINGS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function normalizeAllSolFiles(dir: string): void {
  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      normalizeAllSolFiles(full);
    } else if (stat.isFile() && entry.endsWith('.sol')) {
      const original = fs.readFileSync(full, 'utf8');
      const normalized = normalizeImports(original);
      if (normalized !== original) {
        fs.writeFileSync(full, normalized, 'utf8');
      }
    }
  }
}

async function main() {
  // Normalize all .sol files in basePath before compilation so Foundry-style and
  // npm-style imports for the same library don't end up as duplicate compilation units.
  try {
    normalizeAllSolFiles(basePath);
  } catch {
    // Non-fatal: best-effort normalization
  }

  let fileNames: string[];
  try {
    fileNames = targetFile ? [targetFile] : recursiveExploration(basePath);
  } catch (e) {
    process.stdout.write(JSON.stringify({ success: false, error: `Failed to explore ${basePath}: ${e}` }));
    process.exit(1);
  }

  if (fileNames.length === 0) {
    process.stdout.write(JSON.stringify({ success: true, findings: [] }));
    return;
  }

  const files: InputType = [];
  try {
    const asts = await compileAndBuildAST(basePath, fileNames);
    fileNames.forEach((fileName, index) => {
      files.push({
        content: fs.readFileSync(`${basePath}${fileName}`, { encoding: 'utf8', flag: 'r' }),
        name: fileName,
        ast: asts[index],
      });
    });
  } catch (e) {
    process.stdout.write(JSON.stringify({ success: false, error: `Compilation failed: ${e}` }));
    process.exit(1);
  }

  const findings: Array<{
    type: string;
    title: string;
    description?: string;
    instances: Array<{ fileName: string; line: number; endLine?: number }>;
  }> = [];

  for (const issue of issues) {
    let instances: Instance[] = [];

    if (issue.regexOrAST === 'Regex') {
      for (const file of files) {
        const matches: RegExpMatchArray[] = [...file.content.matchAll(issue.regex)];
        if (issue.regexPreCondition) {
          const pre = [...file.content.matchAll(issue.regexPreCondition)];
          if (pre.length === 0) continue;
        }
        for (const res of matches) {
          const lineIdx = [...(res.input?.slice(0, res.index) ?? '').matchAll(/\n/g)].length;
          const lineText = res.input?.split('\n')[lineIdx] ?? '';
          const comments = [...lineText.matchAll(/([ \t]*\/\/|[ \t]*\/\*|[ \t]*\*)/g)];
          if (comments.length === 0 || comments[0]?.index !== 0) {
            let l = lineFromIndex(res.input!, res.index!);
            let endLine: number | undefined;
            if (issue.startLineModifier) l += issue.startLineModifier;
            if (issue.endLineModifier) endLine = l + issue.endLineModifier;
            instances.push({ fileName: file.name, line: l, endLine, fileContent: res.input! });
          }
        }
      }
    } else {
      try {
        instances = issue.detector(files);
      } catch {
        // skip detectors that crash (e.g. due to missing AST on import-heavy files)
      }
    }

    // deduplicate
    for (let i = 1; i < instances.length;) {
      if (instances[i - 1].fileName === instances[i].fileName && instances[i - 1].line === instances[i].line) {
        instances.splice(i - 1, 1);
      } else {
        i++;
      }
    }

    if (instances.length > 0) {
      findings.push({
        type: issue.type,
        title: issue.title,
        description: issue.description,
        instances: instances.map(inst => ({ fileName: inst.fileName, line: inst.line, endLine: inst.endLine })),
      });
    }
  }

  process.stdout.write(JSON.stringify({ success: true, findings }));
}

main().catch(err => {
  process.stdout.write(JSON.stringify({ success: false, error: String(err) }));
  process.exit(1);
});
