
import * as vscode from 'vscode';

type CppNotebookFile = {
  cells: { kind: 'markdown' | 'code'; text: string }[];
};

export class CppNotebookSerializer implements vscode.NotebookSerializer {
  async deserializeNotebook(content: Uint8Array, _token: vscode.CancellationToken): Promise<vscode.NotebookData> {
    let text = new TextDecoder().decode(content);
    if (!text.trim()) {
      return new vscode.NotebookData([]);
    }
    let data: CppNotebookFile;
    try {
      data = JSON.parse(text);
    } catch {
      data = { cells: [] };
    }
    const cells = (data.cells || []).map(c => {
      if (c.kind === 'markdown') {
        return new vscode.NotebookCellData(vscode.NotebookCellKind.Markup, c.text, 'markdown');
      } else {
        return new vscode.NotebookCellData(vscode.NotebookCellKind.Code, c.text, 'cpp');
      }
    });
    return new vscode.NotebookData(cells);
  }

  async serializeNotebook(data: vscode.NotebookData, _token: vscode.CancellationToken): Promise<Uint8Array> {
    const cells = data.cells.map(cell => ({
      kind: cell.kind === vscode.NotebookCellKind.Markup ? 'markdown' : 'code',
      text: cell.value
    }));
    const file: CppNotebookFile = { cells };
    const text = JSON.stringify(file, null, 2);
    return new TextEncoder().encode(text);
  }
}
