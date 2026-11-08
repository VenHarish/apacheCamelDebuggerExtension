import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRoutes } from "../src/model";

describe("parseRoutes", () => {
  it("parses YAML DSL route IDs, sources, steps, and source lines", () => {
    const source = `- route:
    id: orders
    from:
      uri: "direct:orders"
      steps:
        - log: "received"
        - to: "mock:orders"
`;
    const routes = parseRoutes(source, "routes.yaml");

    assert.equal(routes.length, 1);
    assert.equal(routes[0].id, "orders");
    assert.equal(routes[0].from, "direct:orders");
    assert.equal(routes[0].line, 0);
    assert.deepEqual(routes[0].steps.map(step => step.label), ["log(received)", "to(mock:orders)"]);
    assert.deepEqual(routes[0].steps.map(step => step.line), [5, 6]);
  });

  it("discovers multiple routes in sequence and mapping documents", () => {
    const source = `routes:
  - route:
      id: first
      from:
        uri: timer:first
  - route:
      id: second
      from:
        uri: timer:second
`;
    const routes = parseRoutes(source, "routes.yml");

    assert.deepEqual(routes.map(route => [route.id, route.from, route.line]), [
      ["first", "timer:first", 1],
      ["second", "timer:second", 5]
    ]);
  });

  it("uses a stable line-based ID when a route has no ID", () => {
    const routes = parseRoutes(`- route:
    from:
      uri: timer:anonymous
`, "routes.yaml");

    assert.equal(routes[0].id, "route-1");
  });

  it("returns no routes for unsupported file types", () => {
    assert.deepEqual(parseRoutes("from: timer:x", "routes.xml"), []);
  });

  it("finds routes across multiple YAML documents", () => {
    const source = `kind: Kamelet
metadata: { name: example }
---
- route:
    from:
      uri: timer:example
`;
    const routes = parseRoutes(source, "routes.yaml");
    assert.equal(routes.length, 1);
    assert.equal(routes[0].from, "timer:example");
    assert.equal(routes[0].line, 3);
  });

  it("reports invalid YAML instead of silently ignoring it", () => {
    assert.throws(() => parseRoutes("- route: [", "routes.yaml"), /Invalid YAML/);
  });
});
