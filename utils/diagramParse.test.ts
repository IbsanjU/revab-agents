import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDiagram, parseDrawio, parseMermaid, parsePlantuml } from "./diagramParse.js";

const DRAWIO_XML = `
<mxfile><diagram><mxGraphModel><root>
  <mxCell id="0" />
  <mxCell id="1" parent="0" />
  <mxCell id="n1" value="Start" style="ellipse;fillColor=#fff" vertex="1" parent="1" />
  <mxCell id="n2" value="Check &lt;input&gt;" style="rhombus" vertex="1" parent="1" />
  <mxCell id="n3" value="Done" vertex="1" parent="1" />
  <mxCell id="e1" value="yes" edge="1" source="n1" target="n2" parent="1" />
  <mxCell id="e2" edge="1" source="n2" target="n3" parent="1" />
  <mxCell id="e3" edge="1" source="n2" parent="1" />
</root></mxGraphModel></diagram></mxfile>`;

test("parseDrawio extracts nodes with shapes and label-resolved edges", () => {
  const graph = parseDrawio(DRAWIO_XML);
  assert.equal(graph.format, "drawio");
  assert.equal(graph.nodes.length, 3);
  assert.deepEqual(graph.nodes[0], { id: "n1", label: "Start", shape: "ellipse" });
  assert.equal(graph.nodes[1].shape, "decision");
  assert.deepEqual(graph.edges[0], { from: "Start", to: "Check <input>", label: "yes" });
  assert.equal(graph.edges.length, 2);
  assert.match(graph.warnings[0], /missing a source or target/);
});

test("parseDrawio rejects non-drawio XML", () => {
  assert.throws(() => parseDrawio("<svg></svg>"), /Not a draw\.io/);
});

test("parseMermaid extracts labeled nodes and edges from a flowchart", () => {
  const graph = parseMermaid(`
flowchart TD
  A[Login page] -->|submit| B{Valid?}
  B --> C[Dashboard]
  B -->|no| A
`);
  assert.equal(graph.format, "mermaid");
  assert.deepEqual(
    graph.nodes.map((n) => n.label).sort(),
    ["Dashboard", "Login page", "Valid?"]
  );
  assert.equal(graph.edges.length, 3);
  assert.deepEqual(graph.edges[0], { from: "A", to: "B", label: "submit" });
});

test("parsePlantuml extracts arrows with labels", () => {
  const graph = parsePlantuml(`
@startuml
title Checkout flow
Cart --> Payment : pay
Payment --> Confirmation
@enduml
`);
  assert.equal(graph.format, "plantuml");
  assert.equal(graph.nodes.length, 3);
  assert.deepEqual(graph.edges[0], { from: "Cart", to: "Payment", label: "pay" });
});

test("parseDiagram auto-detects each format", () => {
  assert.equal(parseDiagram(DRAWIO_XML).format, "drawio");
  assert.equal(parseDiagram("flowchart LR\n A --> B").format, "mermaid");
  assert.equal(parseDiagram("@startuml\nA --> B\n@enduml").format, "plantuml");
});

test("parseDiagram throws a helpful error for undetectable content", () => {
  assert.throws(() => parseDiagram("just some prose"), /Could not detect diagram format/);
});
