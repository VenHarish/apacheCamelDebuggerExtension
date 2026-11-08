import { SaxesParser } from "saxes";
import { isMap, isScalar, isSeq, parseAllDocuments, type Node, type YAMLMap } from "yaml";

export interface DependencyEntry {
  label: string;
  line: number;
  kind: "dependency" | "repository" | "pluginRepository";
  profile?: string;
}

export interface DependencySource {
  name: string;
  file: string;
  line: number;
  entries: DependencyEntry[];
}

type MapNode = YAMLMap<Node, Node | null>;

function mapValue(map: MapNode | null, name: string): Node | null {
  return map?.items.find(pair => isScalar(pair.key) && pair.key.value === name)?.value ?? null;
}

function asMap(node: Node | null | undefined): MapNode | null {
  return isMap<Node, Node | null>(node) ? node : null;
}

function scalarText(node: Node | null | undefined): string | undefined {
  return isScalar(node) && typeof node.value === "string" ? node.value : undefined;
}

function nodeLine(source: string, node: Node | null | undefined): number {
  return node?.range ? source.slice(0, node.range[0]).split("\n").length - 1 : 0;
}

export function parseKamelets(source: string, file: string): DependencySource[] {
  const documents = parseAllDocuments(source);
  const errors = documents.flatMap(document => document.errors);
  if (errors.length) {
    throw new Error(`Invalid YAML: ${errors.map(error => error.message).join("; ")}`);
  }

  const result: DependencySource[] = [];
  for (const document of documents) {
    const root = asMap(document.contents);
    if (scalarText(mapValue(root, "kind")) !== "Kamelet") {
      continue;
    }

    const metadata = asMap(mapValue(root, "metadata"));
    const spec = asMap(mapValue(root, "spec"));
    const dependencies = mapValue(spec, "dependencies");
    const entries: DependencyEntry[] = [];
    if (dependencies && !isSeq<Node | null>(dependencies)) {
      throw new Error("Kamelet spec.dependencies must be a sequence");
    }
    if (isSeq<Node | null>(dependencies)) {
      for (const item of dependencies.items) {
        const label = scalarText(item);
        if (!label) {
          throw new Error("Kamelet dependencies must be non-empty strings");
        }
        entries.push({ label, line: nodeLine(source, item), kind: "dependency" });
      }
    }

    result.push({
      name: scalarText(mapValue(metadata, "name")) ?? "Unnamed Kamelet",
      file,
      line: nodeLine(source, root),
      entries
    });
  }
  return result;
}

interface XmlFrame {
  name: string;
  text: string;
  line: number;
  fields: Record<string, string>;
}

interface ProfileEntry {
  fields: Record<string, string>;
  line: number;
  kind: DependencyEntry["kind"];
}

export function parseMavenSettings(source: string, file: string): DependencySource {
  const parser = new SaxesParser({ xmlns: true });
  const stack: XmlFrame[] = [];
  const entries: DependencyEntry[] = [];
  let profileId = "";
  let profileEntries: ProfileEntry[] = [];
  let pendingLine = 0;
  let isSettings = false;

  parser.on("doctype", () => {
    throw new Error("DOCTYPE is not supported in Maven settings");
  });
  parser.on("opentagstart", () => {
    pendingLine = parser.line - 1;
  });
  parser.on("opentag", tag => {
    stack.push({ name: tag.local, text: "", line: pendingLine, fields: {} });
    if (stack.length === 1) {
      isSettings = tag.local === "settings";
    }
    if (stack.map(frame => frame.name).join("/") === "settings/profiles/profile") {
      profileId = "";
      profileEntries = [];
    }
  });
  const addText = (text: string): void => {
    const path = stack.map(frame => frame.name).join("/");
    if (/^settings\/profiles\/profile\/(?:id|(?:repositories\/repository|pluginRepositories\/pluginRepository)\/id|dependencies\/dependency\/(?:groupId|artifactId|version|type|classifier|scope))$/.test(path)) {
      stack[stack.length - 1].text += text;
    }
  };
  parser.on("text", addText);
  parser.on("cdata", addText);
  parser.on("closetag", () => {
    const path = stack.map(frame => frame.name).join("/");
    const frame = stack.pop();
    if (!frame) {
      return;
    }
    if (path === "settings/profiles/profile/id") {
      profileId = frame.text.trim();
    } else if (/^settings\/profiles\/profile\/(?:repositories\/repository|pluginRepositories\/pluginRepository|dependencies\/dependency)$/.test(path)) {
      const kind = frame.name === "repository" ? "repository"
        : frame.name === "pluginRepository" ? "pluginRepository" : "dependency";
      profileEntries.push({ fields: frame.fields, line: frame.line, kind });
    } else if (/^settings\/profiles\/profile\/(?:repositories\/repository|pluginRepositories\/pluginRepository|dependencies\/dependency)\/[^/]+$/.test(path)) {
      const parent = stack[stack.length - 1];
      if (frame.text.trim()) {
        parent.fields[frame.name] = frame.text.trim();
      }
    } else if (path === "settings/profiles/profile") {
      for (const entry of profileEntries) {
        const fields = entry.fields;
        const label = entry.kind === "dependency"
          ? [fields.groupId, fields.artifactId, fields.version, fields.type, fields.classifier, fields.scope]
            .filter(Boolean).join(":")
          : fields.id;
        if (!label || (entry.kind === "dependency" && (!fields.groupId || !fields.artifactId))) {
          throw new Error(`Missing ${entry.kind === "dependency" ? "dependency coordinates" : "repository ID"} in Maven settings`);
        }
        entries.push({ label, line: entry.line, kind: entry.kind, profile: profileId || "(unnamed profile)" });
      }
    }
  });
  parser.write(source).close();
  if (!isSettings) {
    throw new Error("Root element is not Maven settings");
  }
  return { name: "Maven settings", file, line: 0, entries };
}
