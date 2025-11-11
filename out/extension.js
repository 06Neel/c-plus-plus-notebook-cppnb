"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode3 = __toESM(require("vscode"));

// src/serializer.ts
var vscode = __toESM(require("vscode"));
var CppNotebookSerializer = class {
  async deserializeNotebook(content, _token) {
    let text = new TextDecoder().decode(content);
    if (!text.trim()) {
      return new vscode.NotebookData([]);
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { cells: [] };
    }
    const cells = (data.cells || []).map((c) => {
      if (c.kind === "markdown") {
        return new vscode.NotebookCellData(vscode.NotebookCellKind.Markup, c.text, "markdown");
      } else {
        return new vscode.NotebookCellData(vscode.NotebookCellKind.Code, c.text, "cpp");
      }
    });
    return new vscode.NotebookData(cells);
  }
  async serializeNotebook(data, _token) {
    const cells = data.cells.map((cell) => ({
      kind: cell.kind === vscode.NotebookCellKind.Markup ? "markdown" : "code",
      text: cell.value
    }));
    const file = { cells };
    const text = JSON.stringify(file, null, 2);
    return new TextEncoder().encode(text);
  }
};

// src/kernel.ts
var vscode2 = __toESM(require("vscode"));
var os = __toESM(require("os"));
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var import_child_process = require("child_process");
function hasMain(source) {
  return /\bint\s+main\s*\(/.test(source);
}
function hashString(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h << 5) + h + s.charCodeAt(i);
  return (h >>> 0).toString(16);
}
var CppNotebookKernel = class {
  constructor() {
    this.compPath = "g++";
    this.std = "c++17";
    this.timeoutMs = 5e3;
    this.extraArgs = [];
    this.askMode = "auto";
    // per-notebook session folders for cached objects
    this.sessions = /* @__PURE__ */ new Map();
    this.controller = vscode2.notebooks.createNotebookController(
      "cpp-notebook-kernel",
      "cpp-notebook",
      "C++ Notebook"
    );
    this.controller.supportedLanguages = ["cpp", "c++", "c"];
    this.controller.executeHandler = this.executeCells.bind(this);
    vscode2.commands.registerCommand("cppnb.clearState", async () => {
      const nb = vscode2.window.activeNotebookEditor?.notebook;
      if (!nb) return;
      const key = nb.uri.toString();
      const dir = this.sessions.get(key);
      if (dir) {
        try {
          await fs.promises.rm(dir, { recursive: true, force: true });
        } catch {
        }
        this.sessions.delete(key);
      }
      vscode2.window.showInformationMessage("C++ Notebook: shared state cleared for this notebook.");
    });
  }
  dispose() {
    this.controller.dispose();
  }
  async executeCells(cells) {
    if (!cells) return;
    for (const cell of cells) await this.executeOne(cell);
  }
  reloadSettings() {
    const cfg = vscode2.workspace.getConfiguration("cppnb");
    this.compPath = cfg.get("compilerPath", this.compPath);
    this.std = cfg.get("std", this.std);
    this.timeoutMs = cfg.get("timeoutMs", this.timeoutMs);
    this.extraArgs = cfg.get("extraArgs", this.extraArgs);
    this.askMode = cfg.get("askForInput", this.askMode) ?? "auto";
  }
  async ensureSessionDir(cell) {
    const nb = cell.notebook ?? vscode2.window.activeNotebookEditor?.notebook;
    const key = nb ? nb.uri.toString() : "global";
    let dir = this.sessions.get(key);
    if (!dir) {
      dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cppnb-sess-"));
      await fs.promises.mkdir(path.join(dir, "obj"), { recursive: true });
      this.sessions.set(key, dir);
    }
    return dir;
  }
  looksLikeReadsInput(src) {
    const pats = [
      /\bstd::cin\b/,
      /\bcin\b/,
      /\bstd::getline\s*\(/,
      /\bgetline\s*\(/,
      /\bscanf\s*\(/,
      /\bfscanf\s*\(/,
      /\bgetchar\s*\(/,
      /\bgetch\s*\(/,
      /\bgets\s*\(/
    ];
    return pats.some((rx) => rx.test(src));
  }
  async executeOne(cell) {
    const exec = this.controller.createNotebookCellExecution(cell);
    exec.start(Date.now());
    exec.clearOutput();
    if (cell.kind === vscode2.NotebookCellKind.Markup) {
      exec.appendOutput(new vscode2.NotebookCellOutput([vscode2.NotebookCellOutputItem.text("")]));
      exec.end(true);
      return;
    }
    this.reloadSettings();
    const sessionDir = await this.ensureSessionDir(cell);
    const objDir = path.join(sessionDir, "obj");
    const source = cell.document.getText();
    const tmpSrcDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cppnb-cell-"));
    const srcPath = path.join(tmpSrcDir, "cell.cpp");
    try {
      await fs.promises.writeFile(srcPath, source, "utf8");
      if (!hasMain(source)) {
        const cellId = hashString(cell.document.uri.toString());
        const objPath = path.join(objDir, `${cellId}.o`);
        try {
          await fs.promises.unlink(objPath);
        } catch {
        }
        const compileArgsState = ["-std=" + this.std, "-c", srcPath, "-O2", "-o", objPath, ...this.extraArgs];
        const comp = await this.runProcess(this.compPath, compileArgsState, this.timeoutMs);
        if (comp.timedOut) {
          exec.appendOutput(new vscode2.NotebookCellOutput([vscode2.NotebookCellOutputItem.stderr("Compilation timed out.")]));
          exec.end(false);
          return;
        }
        if (comp.code !== 0) {
          exec.appendOutput(new vscode2.NotebookCellOutput([vscode2.NotebookCellOutputItem.stderr(comp.stderr || "Compilation failed.")]));
          exec.end(false);
          return;
        }
        exec.appendOutput(new vscode2.NotebookCellOutput([vscode2.NotebookCellOutputItem.text("State updated \u2714 (compiled and cached).")]));
        exec.end(true);
        return;
      }
      const exePath = path.join(tmpSrcDir, os.platform() === "win32" ? "a.exe" : "a.out");
      const cachedObjs = (await fs.promises.readdir(objDir)).filter((f) => f.endsWith(".o")).map((f) => path.join(objDir, f));
      const linkArgs = ["-std=" + this.std, srcPath, "-O2", "-o", exePath, ...cachedObjs, ...this.extraArgs];
      const link = await this.runProcess(this.compPath, linkArgs, this.timeoutMs);
      if (link.timedOut) {
        exec.appendOutput(new vscode2.NotebookCellOutput([vscode2.NotebookCellOutputItem.stderr("Linking timed out.")]));
        exec.end(false);
        return;
      }
      if (link.code !== 0) {
        exec.appendOutput(new vscode2.NotebookCellOutput([vscode2.NotebookCellOutputItem.stderr(link.stderr || "Linking failed.")]));
        exec.end(false);
        return;
      }
      let stdinText = "";
      let shouldAsk = false;
      if (this.askMode === "always") shouldAsk = true;
      else if (this.askMode === "auto") shouldAsk = this.looksLikeReadsInput(source);
      if (shouldAsk) {
        const typed = await vscode2.window.showInputBox({
          title: "Program input (optional)",
          prompt: "Provide input for the program. Use \\n for new lines (leave empty for no input).",
          placeHolder: "e.g. 10 20  or  10\\n20",
          ignoreFocusOut: true,
          value: ""
        });
        stdinText = typed ?? "";
      }
      const run = await this.runProcess(exePath, [], this.timeoutMs, stdinText);
      let textOut = (run.stdout || "") + (run.stderr ? "\n" + run.stderr : "");
      if (run.timedOut) textOut += "\n[Timed out]";
      exec.appendOutput(new vscode2.NotebookCellOutput([vscode2.NotebookCellOutputItem.text(textOut || "(no output)")]));
      exec.end(run.code === 0 && !run.timedOut);
    } catch (err) {
      exec.appendOutput(new vscode2.NotebookCellOutput([vscode2.NotebookCellOutputItem.stderr(String(err?.message ?? err))]));
      exec.end(false);
    } finally {
      try {
        await fs.promises.rm(tmpSrcDir, { recursive: true, force: true });
      } catch {
      }
    }
  }
  runProcess(cmd, args, timeoutMs, stdinText = "") {
    return new Promise((resolve) => {
      const child = (0, import_child_process.spawn)(cmd, args, { shell: process.platform === "win32" });
      if (stdinText && child.stdin) {
        let toWrite = stdinText.replace(/\\n/g, "\n");
        if (toWrite.length > 0 && !toWrite.endsWith("\n")) toWrite += "\n";
        try {
          child.stdin.write(toWrite);
        } catch {
        }
        try {
          child.stdin.end();
        } catch {
        }
      }
      let stdout = "";
      let stderr = "";
      let finished = false;
      let to;
      child.stdout.on("data", (d) => {
        stdout += d.toString();
      });
      child.stderr.on("data", (d) => {
        stderr += d.toString();
      });
      child.on("error", (err) => {
        if (!finished) {
          finished = true;
          if (to) clearTimeout(to);
          resolve({ code: -1, stdout, stderr: String(err), timedOut: false });
        }
      });
      child.on("close", (code) => {
        if (!finished) {
          finished = true;
          if (to) clearTimeout(to);
          resolve({ code, stdout, stderr, timedOut: false });
        }
      });
      to = setTimeout(() => {
        if (!finished) {
          finished = true;
          try {
            child.kill();
          } catch {
          }
          resolve({ code: null, stdout, stderr, timedOut: true });
        }
      }, timeoutMs);
    });
  }
};

// src/extension.ts
function activate(context) {
  const serializer = new CppNotebookSerializer();
  context.subscriptions.push(
    vscode3.workspace.registerNotebookSerializer("cpp-notebook", serializer, { transientOutputs: false })
  );
  const controller = new CppNotebookKernel();
  context.subscriptions.push(controller);
  context.subscriptions.push(
    vscode3.commands.registerCommand("cppnb.newNotebook", async () => {
      const doc = await vscode3.workspace.openNotebookDocument("cpp-notebook", new vscode3.NotebookData([
        new vscode3.NotebookCellData(vscode3.NotebookCellKind.Markup, "# C++ Notebook\nWrite text here.", "markdown"),
        new vscode3.NotebookCellData(vscode3.NotebookCellKind.Code, '#include <iostream>\nint main(){ std::cout << 2+3 << "\\n"; }', "cpp")
      ]));
      await vscode3.window.showNotebookDocument(doc);
    })
  );
}
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
