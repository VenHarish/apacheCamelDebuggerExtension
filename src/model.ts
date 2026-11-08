import { isMap, isScalar, isSeq, parseAllDocuments, type Node, type Pair, type YAMLMap } from "yaml";

export interface RouteStep {
  label: string;
  line: number;
}

export interface CamelRoute {
  id: string;
  from: string;
  file: string;
  line: number;
  steps: RouteStep[];
}

type MapNode = YAMLMap<Node, Node | null>;

function lineAt(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length - 1;
}

function nodeLine(source: string, node: Node | null | undefined): number {
  return node?.range ? lineAt(source, node.range[0]) : 0;
}

function entries(map: MapNode): Pair<Node, Node | null>[] {
  return map.items;
}

function mapValue(map: MapNode | null | undefined, name: string): Node | null {
  if (!map) {
    return null;
  }
  const pair = entries(map).find(entry => isScalar(entry.key) && String(entry.key.value) === name);
  return pair?.value ?? null;
}

function scalarText(node: Node | null | undefined): string | undefined {
  return isScalar(node) && node.value !== null && node.value !== undefined
    ? String(node.value)
    : undefined;
}

interface RouteDefinition {
  route: MapNode;
  line: number;
}

function routeMappings(node: Node | null, source: string): RouteDefinition[] {
  const routes: RouteDefinition[] = [];
  const visit = (current: Node | null | undefined): void => {
    if (isMap<Node, Node | null>(current)) {
      for (const pair of current.items) {
        if (isScalar(pair.key) && pair.key.value === "route" && isMap<Node, Node | null>(pair.value)) {
          routes.push({ route: pair.value, line: nodeLine(source, pair.key) });
        } else {
          visit(pair.value);
        }
      }
    } else if (isSeq<Node | null>(current)) {
      for (const item of current.items) {
        visit(item);
      }
    }
  };
  visit(node);
  return routes;
}

function stepLabel(pair: Pair<Node, Node | null>): string | undefined {
  const name = scalarText(pair.key);
  if (!name) {
    return undefined;
  }

  const value = scalarText(pair.value);
  return value ? `${name}(${value})` : name;
}

function parseSteps(source: string, from: MapNode): RouteStep[] {
  const steps = mapValue(from, "steps");
  if (!isSeq<Node | null>(steps)) {
    return [];
  }

  const result: RouteStep[] = [];
  for (const item of steps.items) {
    if (!isMap<Node, Node | null>(item)) {
      continue;
    }
    const pair = item.items[0];
    if (!pair) {
      continue;
    }
    const label = stepLabel(pair);
    if (label) {
      result.push({ label, line: nodeLine(source, pair.key) });
    }
  }
  return result;
}

export function parseYamlRoutes(source: string, file: string): CamelRoute[] {
  const documents = parseAllDocuments(source, { uniqueKeys: false });
  const errors = documents.flatMap(document => document.errors);
  if (errors.length) {
    throw new Error(`Invalid YAML: ${errors.map(error => error.message).join("; ")}`);
  }

  return documents.flatMap(document => routeMappings(document.contents, source)).flatMap(({ route, line }) => {
    const from = mapValue(route, "from");
    const fromMap = isMap<Node, Node | null>(from) ? from : null;
    const uri = scalarText(mapValue(fromMap, "uri"));
    if (!fromMap || !uri) {
      return [];
    }

    return [{
      id: scalarText(mapValue(route, "id")) ?? `route-${line + 1}`,
      from: uri,
      file,
      line,
      steps: parseSteps(source, fromMap)
    }];
  });
}

export function parseRoutes(source: string, file: string): CamelRoute[] {
  if (!["yaml", "yml"].includes(file.split(".").pop()?.toLowerCase() ?? "")) {
    return [];
  }
  return parseYamlRoutes(source, file);
}
