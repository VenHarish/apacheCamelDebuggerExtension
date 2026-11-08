import * as os from "node:os";
import * as vscode from "vscode";
import { DependencyEntry, DependencySource, parseKamelets, parseMavenSettings } from "./dependencies";

class SourceItem extends vscode.TreeItem {
  constructor(readonly source: DependencySource) {
    super(source.name, vscode.TreeItemCollapsibleState.Expanded);
    this.description = vscode.workspace.asRelativePath(source.file);
    this.command = {
      command: "camelDebugger.openLocation",
      title: "Open Source",
      arguments: [source.file, source.line]
    };
  }
}

class DependencyItem extends vscode.TreeItem {
  constructor(entry: DependencyEntry, file: string) {
    super(entry.label, vscode.TreeItemCollapsibleState.None);
    this.description = entry.profile
      ? `${entry.kind} · profile ${entry.profile}`
      : entry.kind;
    this.command = {
      command: "camelDebugger.openLocation",
      title: "Open Source",
      arguments: [file, entry.line]
    };
  }
}

export class DependencyProvider implements vscode.TreeDataProvider<SourceItem | DependencyItem>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private sources: DependencySource[] = [];
  private generation = 0;
  private disposed = false;
  private readonly settingsUri = vscode.Uri.joinPath(vscode.Uri.file(os.homedir()), ".m2", "settings.xml");
  readonly userHome = vscode.Uri.file(os.homedir());

  constructor(private readonly output: vscode.OutputChannel) {}

  async refresh(): Promise<void> {
    const generation = ++this.generation;
    const sources: DependencySource[] = [];
    let failures = 0;
    const failure = (uri: vscode.Uri, type: string): void => {
      failures += 1;
      this.output.appendLine(`Could not read or parse ${type}: ${uri.fsPath}`);
    };

    try {
      const [yamlFiles, workspaceSettings] = await Promise.all([
        vscode.workspace.findFiles("**/*.{yaml,yml}", "**/{.git,node_modules,target,build,out}/**"),
        vscode.workspace.findFiles("**/settings.xml", "**/{.git,node_modules,target,build,out}/**")
      ]);
      for (const uri of yamlFiles) {
        try {
          const document = await vscode.workspace.openTextDocument(uri);
          sources.push(...parseKamelets(document.getText(), uri.fsPath));
        } catch {
          failure(uri, "YAML file");
        }
      }

      const settings = new Map(workspaceSettings.map(uri => [uri.toString(), uri]));
      settings.set(this.settingsUri.toString(), this.settingsUri);
      for (const uri of settings.values()) {
        try {
          const openDocument = vscode.workspace.textDocuments.find(document => document.uri.toString() === uri.toString());
          const text = openDocument?.getText() ?? Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
          sources.push(parseMavenSettings(text, uri.fsPath));
        } catch (error) {
          if (uri.toString() === this.settingsUri.toString()
            && error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
            continue;
          }
          failure(uri, "Maven settings file");
        }
      }
    } catch (error) {
      failures += 1;
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine(`Could not search workspace for dependency sources: ${message}`);
    }

    if (this.disposed || generation !== this.generation) {
      return;
    }
    this.sources = sources.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    this.message = failures
      ? `${failures} source file(s) could not be read. See the Apache Camel output.`
      : sources.length ? undefined : "No Kamelets or Maven settings found.";
    this.changed.fire();
  }

  message: string | undefined;

  getTreeItem(element: SourceItem | DependencyItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SourceItem | DependencyItem): (SourceItem | DependencyItem)[] {
    if (element instanceof SourceItem) {
      return element.source.entries.map(entry => new DependencyItem(entry, element.source.file));
    }
    if (element) {
      return [];
    }
    return this.sources.map(source => new SourceItem(source));
  }

  dispose(): void {
    this.disposed = true;
    this.changed.dispose();
  }
}
