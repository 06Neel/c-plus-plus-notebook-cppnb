// src/kernel.ts
import * as vscode from 'vscode';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

type AskMode = 'auto' | 'always' | 'never';

function hasMain(source: string): boolean {
  return /\bint\s+main\s*\(/.test(source);
}

// Small, stable hash for filenames (djb2)
function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
  // convert to unsigned 32-bit and hex
  return (h >>> 0).toString(16);
}

export class CppNotebookKernel implements vscode.Disposable {
  readonly controller: vscode.NotebookController;

  private compPath = 'g++';
  private std = 'c++17';
  private timeoutMs = 5000;
  private extraArgs: string[] = [];
  private askMode: AskMode = 'auto';

  // per-notebook session folders for cached objects
  private sessions = new Map<string, string>();

  constructor() {
    this.controller = vscode.notebooks.createNotebookController(
      'cpp-notebook-kernel',
      'cpp-notebook',
      'C++ Notebook'
    );
    this.controller.supportedLanguages = ['cpp', 'c++', 'c'];
    this.controller.executeHandler = this.executeCells.bind(this);

    vscode.commands.registerCommand('cppnb.clearState', async () => {
      const nb = vscode.window.activeNotebookEditor?.notebook;
      if (!nb) return;
      const key = nb.uri.toString();
      const dir = this.sessions.get(key);
      if (dir) {
        try { await fs.promises.rm(dir, { recursive: true, force: true }); } catch {}
        this.sessions.delete(key);
      }
      vscode.window.showInformationMessage('C++ Notebook: shared state cleared for this notebook.');
    });
  }

  dispose() {
    this.controller.dispose();
  }

  private async executeCells(cells?: vscode.NotebookCell[]) {
    if (!cells) return;
    for (const cell of cells) await this.executeOne(cell);
  }

  private reloadSettings() {
    const cfg = vscode.workspace.getConfiguration('cppnb');
    this.compPath = cfg.get<string>('compilerPath', this.compPath);
    this.std = cfg.get<string>('std', this.std);
    this.timeoutMs = cfg.get<number>('timeoutMs', this.timeoutMs);
    this.extraArgs = cfg.get<string[]>('extraArgs', this.extraArgs);
    this.askMode = (cfg.get<string>('askForInput', this.askMode) as AskMode) ?? 'auto';
  }

  private async ensureSessionDir(cell: vscode.NotebookCell): Promise<string> {
    const nb = cell.notebook ?? vscode.window.activeNotebookEditor?.notebook;
    const key = nb ? nb.uri.toString() : 'global';
    let dir = this.sessions.get(key);
    if (!dir) {
      dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cppnb-sess-'));
      await fs.promises.mkdir(path.join(dir, 'obj'), { recursive: true });
      this.sessions.set(key, dir);
    }
    return dir;
  }

  private looksLikeReadsInput(src: string): boolean {
    const pats = [
      /\bstd::cin\b/, /\bcin\b/,
      /\bstd::getline\s*\(/, /\bgetline\s*\(/,
      /\bscanf\s*\(/, /\bfscanf\s*\(/,
      /\bgetchar\s*\(/, /\bgetch\s*\(/, /\bgets\s*\(/
    ];
    return pats.some(rx => rx.test(src));
  }

  private async executeOne(cell: vscode.NotebookCell) {
    const exec = this.controller.createNotebookCellExecution(cell);
    exec.start(Date.now());
    exec.clearOutput();

    if (cell.kind === vscode.NotebookCellKind.Markup) {
      exec.appendOutput(new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.text('')]));
      exec.end(true);
      return;
    }

    this.reloadSettings();
    const sessionDir = await this.ensureSessionDir(cell);
    const objDir = path.join(sessionDir, 'obj');

    const source = cell.document.getText();

    // temp folder for this run
    const tmpSrcDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cppnb-cell-'));
    const srcPath = path.join(tmpSrcDir, 'cell.cpp');

    try {
      await fs.promises.writeFile(srcPath, source, 'utf8');

      if (!hasMain(source)) {
        // ---------- STATE CELL ----------
        // Compile to a stable filename based on the cell's URI -> overwrites on re-run
        const cellId = hashString(cell.document.uri.toString());
        const objPath = path.join(objDir, `${cellId}.o`);

        // Clean any previous file for this cell (just in case)
        try { await fs.promises.unlink(objPath); } catch {}

        const compileArgsState = ['-std=' + this.std, '-c', srcPath, '-O2', '-o', objPath, ...this.extraArgs];
        const comp = await this.runProcess(this.compPath, compileArgsState, this.timeoutMs);
        if (comp.timedOut) {
          exec.appendOutput(new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.stderr('Compilation timed out.')]));
          exec.end(false); return;
        }
        if (comp.code !== 0) {
          exec.appendOutput(new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.stderr(comp.stderr || 'Compilation failed.')]));
          exec.end(false); return;
        }
        exec.appendOutput(new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.text('State updated ✔ (compiled and cached).')]));
        exec.end(true);
        return;
      }

      // ---------- RUN CELL ----------
      const exePath = path.join(tmpSrcDir, os.platform() === 'win32' ? 'a.exe' : 'a.out');

      // All cached objects (one per state cell after the fix)
      const cachedObjs = (await fs.promises.readdir(objDir))
        .filter(f => f.endsWith('.o'))
        .map(f => path.join(objDir, f));

      const linkArgs = ['-std=' + this.std, srcPath, '-O2', '-o', exePath, ...cachedObjs, ...this.extraArgs];
      const link = await this.runProcess(this.compPath, linkArgs, this.timeoutMs);
      if (link.timedOut) {
        exec.appendOutput(new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.stderr('Linking timed out.')]));
        exec.end(false); return;
      }
      if (link.code !== 0) {
        exec.appendOutput(new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.stderr(link.stderr || 'Linking failed.')]));
        exec.end(false); return;
      }

      // Input prompt policy
      let stdinText = '';
      let shouldAsk = false;
      if (this.askMode === 'always') shouldAsk = true;
      else if (this.askMode === 'auto') shouldAsk = this.looksLikeReadsInput(source);

      if (shouldAsk) {
        const typed = await vscode.window.showInputBox({
          title: 'Program input (optional)',
          prompt: 'Provide input for the program. Use \\n for new lines (leave empty for no input).',
          placeHolder: 'e.g. 10 20  or  10\\n20',
          ignoreFocusOut: true,
          value: ''
        });
        stdinText = typed ?? '';
      }

      const run = await this.runProcess(exePath, [], this.timeoutMs, stdinText);
      let textOut = (run.stdout || '') + (run.stderr ? ('\n' + run.stderr) : '');
      if (run.timedOut) textOut += '\n[Timed out]';

      exec.appendOutput(new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.text(textOut || '(no output)')]));
      exec.end(run.code === 0 && !run.timedOut);

    } catch (err: any) {
      exec.appendOutput(new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.stderr(String(err?.message ?? err))]));
      exec.end(false);
    } finally {
      try { await fs.promises.rm(tmpSrcDir, { recursive: true, force: true }); } catch {}
    }
  }

  private runProcess(
    cmd: string,
    args: string[],
    timeoutMs: number,
    stdinText: string = ''
  ): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
    return new Promise(resolve => {
      const child = spawn(cmd, args, { shell: process.platform === 'win32' });

      if (stdinText && child.stdin) {
        let toWrite = stdinText.replace(/\\n/g, '\n');
        if (toWrite.length > 0 && !toWrite.endsWith('\n')) toWrite += '\n';
        try { child.stdin.write(toWrite); } catch {}
        try { child.stdin.end(); } catch {}
      }

      let stdout = '';
      let stderr = '';
      let finished = false;
      let to: NodeJS.Timeout | undefined;

      child.stdout.on('data', d => { stdout += d.toString(); });
      child.stderr.on('data', d => { stderr += d.toString(); });

      child.on('error', err => {
        if (!finished) {
          finished = true;
          if (to) clearTimeout(to);
          resolve({ code: -1, stdout, stderr: String(err), timedOut: false });
        }
      });

      child.on('close', code => {
        if (!finished) {
          finished = true;
          if (to) clearTimeout(to);
          resolve({ code, stdout, stderr, timedOut: false });
        }
      });

      to = setTimeout(() => {
        if (!finished) {
          finished = true;
          try { child.kill(); } catch {}
          resolve({ code: null, stdout, stderr, timedOut: true });
        }
      }, timeoutMs);
    });
  }
}