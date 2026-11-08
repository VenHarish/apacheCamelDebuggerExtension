# Apache Camel Route Explorer

A VS Code extension for exploring Apache Camel YAML DSL projects. It gives you a workspace route tree with each route's source endpoint and steps, opens the corresponding source when you select an item, and can attach VS Code's Java debugger to a running Camel JVM.

## Features

- Discovers Camel routes in `.yaml` and `.yml` files.
- Shows route IDs, `from` endpoints, and recognizable route steps in the **Apache Camel Routes** view in Explorer.
- Opens the source file at the route or step when selected.
- Refreshes automatically when route files change; use **Apache Camel: Refresh Routes** to refresh manually.
- Lists every `spec.dependencies` entry from workspace Kamelets in the **Apache Camel Dependencies** view.
- Lists repository and plugin repository IDs from all profiles in workspace `settings.xml` files and `~/.m2/settings.xml`. It also lists dependency declarations in profiles if present, though they are not part of Maven's standard settings schema.
- Refreshes dependency sources when YAML or settings files change; use **Apache Camel: Refresh Dependencies** to refresh manually. Select an entry to open its source.
- Offers **Apache Camel: Attach to JVM** to attach the Java debugger to a running Camel process.

The route explorer is a source-level view; it does not connect to a Camel runtime or inspect runtime route state. Java and XML DSL files are intentionally not included.

The dependency view shows declarations, not resolved or transitive Maven dependencies. It does not evaluate Maven profile activation, settings precedence, property interpolation, or Kamelet references. It displays repository IDs only, not URLs or credentials. Read or parse failures are reported in the Apache Camel output channel.

## Requirements

- VS Code 1.85 or newer.
- To use **Apache Camel: Attach to JVM**, install the [Extension Pack for Java](https://marketplace.visualstudio.com/items?itemName=vscjava.vscode-java-pack), start the Camel application with Java remote debugging enabled, and enter its debug port (default `5005`).

For example, configure the JVM with `-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005`. Use your project's normal run configuration and follow your environment's security requirements before exposing a debug port.

## Development

```sh
npm install
npm test
```

Press `F5` in VS Code to launch the Extension Development Host.

## Limitations

The explorer reads YAML structure without compiling the project. It recognizes standard Camel YAML DSL route entries with a `from.uri` endpoint and `from.steps`; dynamically generated routes and nonstandard layouts may not appear in the tree. It does not set route-level breakpoints or control routes in a running Camel context.
