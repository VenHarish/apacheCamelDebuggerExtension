import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseKamelets, parseMavenSettings } from "../src/dependencies";

describe("Kamelet dependencies", () => {
  it("extracts every declared dependency from multiple YAML documents", () => {
    const source = `apiVersion: camel.apache.org/v1
kind: Kamelet
metadata:
  name: timer-source
spec:
  dependencies:
    - camel:core
    - camel:timer
    - "mvn:org.example:library:1.2"
---
kind: Kamelet
metadata: { name: log-sink }
spec:
  dependencies: [camel:log, camel:core]
`;
    const result = parseKamelets(source, "/workspace/kamelets.yaml");
    assert.deepEqual(result.map(item => item.name), ["timer-source", "log-sink"]);
    assert.deepEqual(result[0].entries.map(item => [item.label, item.line]), [
      ["camel:core", 6], ["camel:timer", 7], ["mvn:org.example:library:1.2", 8]
    ]);
    assert.deepEqual(result[1].entries.map(item => item.label), ["camel:log", "camel:core"]);
  });

  it("ignores other YAML resources and preserves empty Kamelets", () => {
    assert.deepEqual(parseKamelets("kind: ConfigMap\nspec:\n  dependencies: [secret]\n", "a.yaml"), []);
    assert.deepEqual(parseKamelets("kind: Kamelet\nmetadata: {name: empty}\nspec: {}\n", "a.yaml")[0].entries, []);
  });

  it("reports invalid YAML and invalid dependency declarations", () => {
    assert.throws(() => parseKamelets("kind: [", "a.yaml"), /Invalid YAML/);
    assert.throws(() => parseKamelets("kind: Kamelet\nspec: {dependencies: wrong}", "a.yaml"), /must be a sequence/);
    assert.throws(() => parseKamelets("kind: Kamelet\nspec: {dependencies: [42]}", "a.yaml"), /non-empty strings/);
  });
});

describe("Maven settings", () => {
  it("extracts repository IDs, plugin repository IDs and nonstandard profile dependency declarations", () => {
    const source = `<settings xmlns="http://maven.apache.org/SETTINGS/1.0.0">
  <servers><server><id>private</id><password>top-secret</password></server></servers>
  <profiles><profile>
    <repositories><repository>
      <id>central</id><url>https://user:password@example.test/repo?token=secret</url>
    </repository></repositories>
    <pluginRepositories><pluginRepository><id>plugins</id></pluginRepository></pluginRepositories>
    <dependencies><dependency><groupId>com.example</groupId><artifactId>demo</artifactId><version>1.0</version></dependency></dependencies>
    <id>dev</id>
  </profile></profiles>
</settings>`;
    const result = parseMavenSettings(source, "/home/user/.m2/settings.xml");
    assert.deepEqual(result.entries.map(({ label, kind, profile }) => [label, kind, profile]), [
      ["central", "repository", "dev"],
      ["plugins", "pluginRepository", "dev"],
      ["com.example:demo:1.0", "dependency", "dev"]
    ]);
    assert.equal(result.entries[0].line, 3);
    assert.doesNotMatch(JSON.stringify(result), /secret|password|example\.test\/repo/);
  });

  it("reads all profiles and preserves duplicate repositories", () => {
    const source = `<settings><profiles>
      <profile><id>one</id><repositories><repository><id>central</id></repository></repositories></profile>
      <profile><id>two</id><repositories><repository><id>central</id></repository></repositories></profile>
    </profiles></settings>`;
    const result = parseMavenSettings(source, "settings.xml");
    assert.deepEqual(result.entries.map(entry => entry.profile), ["one", "two"]);
  });

  it("rejects malformed, non-settings and DOCTYPE input", () => {
    assert.throws(() => parseMavenSettings("<settings>", "settings.xml"));
    assert.throws(() => parseMavenSettings("<project/>", "settings.xml"), /Root element/);
    assert.throws(() => parseMavenSettings("<!DOCTYPE settings><settings/>", "settings.xml"), /DOCTYPE/);
    assert.throws(() => parseMavenSettings("<settings><profiles><profile><repositories><repository/></repositories></profile></profiles></settings>", "settings.xml"), /repository ID/);
  });
});
