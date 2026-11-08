import * as vscode from "vscode";
import { CamelRoute, parseRoutes } from "./model";
import { DependencyProvider } from "./dependencyView";

class RouteItem extends vscode.TreeItem {
  constructor(readonly route: CamelRoute) {
    super(`${route.id}  ·  ${route.from}`, vscode.TreeItemCollapsibleState.Expanded);
    this.description = vscode.workspace.asRelativePath(route.file);
    this.contextValue = "camelRoute";
    this.command = {
      command: "camelDebugger.openLocation",
      title: "Open Route",
      arguments: [route.file, route.line]
    };
  }
}

class StepItem extends vscode.TreeItem {
  constructor(label: string, file: string, line: number, contextValue: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = contextValue;
    this.command = {
      command: "camelDebugger.openLocation",
      title: "Open Source",
      arguments: [file, line]
    };
  }
}

class RoutesProvider implements vscode.TreeDataProvider<RouteItem | StepItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private routes: CamelRoute[] = [];
  private generation = 0;
  message: string | undefined;

  constructor(private readonly output: vscode.OutputChannel) {}

  refresh(): void {
    const generation = ++this.generation;
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {
      this.routes = [];
      this.message = undefined;
      this.changed.fire();
      return;
    }

    void this.loadRoutes(generation).catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Failed to load Apache Camel routes: ${message}`);
    });
  }

  private async loadRoutes(generation: number): Promise<void> {
    const files = await vscode.workspace.findFiles(
      "**/*.{yaml,yml}",
      "**/{.git,node_modules,target,build,out}/**"
    );
    const discovered: CamelRoute[] = [];
    let failures = 0;
    for (const file of files) {
      try {
        const document = await vscode.workspace.openTextDocument(file);
        discovered.push(...parseRoutes(document.getText(), file.fsPath));
      } catch {
        failures += 1;
        this.output.appendLine(`Could not read or parse YAML route file: ${file.fsPath}`);
      }
    }
    if (generation !== this.generation) {
      return;
    }
    this.message = failures
      ? `${failures} YAML file(s) could not be read. See the Apache Camel output.`
      : undefined;
    this.routes = discovered;
    this.changed.fire();
  }

  getTreeItem(element: RouteItem | StepItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: RouteItem | StepItem): (RouteItem | StepItem)[] {
    if (element instanceof RouteItem) {
      const children: StepItem[] = [
        new StepItem(`from(${element.route.from})`, element.route.file, element.route.line, "camelEndpoint")
      ];
      for (const step of element.route.steps) {
        children.push(new StepItem(step.label, element.route.file, step.line, "camelStep"));
      }
      return children;
    }
    if (element) {
      return [];
    }
    if (!this.routes.length) {
      const empty = new vscode.TreeItem("No Camel routes found");
      empty.description = "Open a workspace with YAML routes";
      return [empty];
    }
    return this.routes.map(route => new RouteItem(route));
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Apache Camel");
  const provider = new RoutesProvider(output);
  const tree = vscode.window.createTreeView("camelDebugger.routes", { treeDataProvider: provider });
  const dependencies = new DependencyProvider(output);
  const dependencyTree = vscode.window.createTreeView("camelDebugger.dependencies", { treeDataProvider: dependencies });
  const refreshDependencies = (): void => {
    void dependencies.refresh();
  };

  context.subscriptions.push(
    tree,
    provider.onDidChangeTreeData(() => {
      tree.message = provider.message;
    }),
    output,
    dependencies,
    dependencyTree,
    dependencies.onDidChangeTreeData(() => {
      dependencyTree.message = dependencies.message;
    }),
    vscode.commands.registerCommand("camelDebugger.refreshRoutes", () => {
      provider.refresh();
      refreshDependencies();
    }),
    vscode.commands.registerCommand("camelDebugger.refreshDependencies", refreshDependencies),
    vscode.commands.registerCommand("camelDebugger.openLocation", async (file: string, line: number) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      const editor = await vscode.window.showTextDocument(document);
      const position = new vscode.Position(line, 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    }),
    vscode.commands.registerCommand("camelDebugger.attachDebugger", async () => {
      const portInput = await vscode.window.showInputBox({
        prompt: "Port of the running Camel JVM's Java debug server",
        value: "5005",
        validateInput: value => /^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 65535
          ? undefined
          : "Enter a port between 1 and 65535"
      });
      if (!portInput) {
        return;
      }

      const started = await vscode.debug.startDebugging(undefined, {
        type: "java",
        request: "attach",
        name: "Attach to Camel JVM",
        hostName: "localhost",
        port: Number(portInput)
      });
      if (!started) {
        void vscode.window.showErrorMessage(
          "Could not start the Java debugger. Install the Extension Pack for Java and ensure the Camel JVM is listening for debugger connections."
        );
      }
    })
  );

  const watcher = vscode.workspace.createFileSystemWatcher("**/*.{yaml,yml}");
  const scheduleRefresh = debounce(() => {
    provider.refresh();
    refreshDependencies();
  }, 300);
  const scheduleDependencyRefresh = debounce(refreshDependencies, 300);
  const settingsWatcher = vscode.workspace.createFileSystemWatcher("**/settings.xml");
  const userSettingsWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(dependencies.userHome, ".m2/settings.xml")
  );
  context.subscriptions.push(
    watcher,
    settingsWatcher,
    userSettingsWatcher,
    watcher.onDidCreate(scheduleRefresh),
    watcher.onDidChange(scheduleRefresh),
    watcher.onDidDelete(scheduleRefresh),
    settingsWatcher.onDidCreate(scheduleDependencyRefresh),
    settingsWatcher.onDidChange(scheduleDependencyRefresh),
    settingsWatcher.onDidDelete(scheduleDependencyRefresh),
    userSettingsWatcher.onDidCreate(scheduleDependencyRefresh),
    userSettingsWatcher.onDidChange(scheduleDependencyRefresh),
    userSettingsWatcher.onDidDelete(scheduleDependencyRefresh),
    vscode.workspace.onDidChangeWorkspaceFolders(scheduleRefresh),
    vscode.workspace.onDidChangeTextDocument(event => {
      if (/\.(?:yaml|yml)$/i.test(event.document.fileName)) {
        scheduleRefresh();
      } else if (/(?:^|[\\/])settings\.xml$/i.test(event.document.fileName)) {
        scheduleDependencyRefresh();
      }
    })
  );

  provider.refresh();
  refreshDependencies();
}

function debounce(callback: () => void, delay: number): () => void {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(callback, delay);
  };
}

export function deactivate(): void {}
