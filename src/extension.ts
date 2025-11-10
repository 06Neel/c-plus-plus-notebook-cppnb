
import * as vscode from 'vscode';
import { CppNotebookSerializer } from './serializer';
import { CppNotebookKernel } from './kernel';

export function activate(context: vscode.ExtensionContext) {
  // Register serializer
  const serializer = new CppNotebookSerializer();
  context.subscriptions.push(
    vscode.workspace.registerNotebookSerializer('cpp-notebook', serializer, { transientOutputs: false })
  );

  // Register kernel
  const controller = new CppNotebookKernel();
  context.subscriptions.push(controller);

  // Command: create a new notebook
  context.subscriptions.push(
    vscode.commands.registerCommand('cppnb.newNotebook', async () => {
      const doc = await vscode.workspace.openNotebookDocument('cpp-notebook', new vscode.NotebookData([
        new vscode.NotebookCellData(vscode.NotebookCellKind.Markup, '# C++ Notebook\nWrite text here.', 'markdown'),
        new vscode.NotebookCellData(vscode.NotebookCellKind.Code, '#include <iostream>\nint main(){ std::cout << 2+3 << "\\n"; }', 'cpp')
      ]));
      await vscode.window.showNotebookDocument(doc);
    })
  );
}

export function deactivate() {}
