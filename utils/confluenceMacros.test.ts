import { test } from "node:test";
import assert from "node:assert/strict";
import { expandConfluenceMacros } from "./confluenceMacros.js";

test("expandConfluenceMacros renders a simple expand macro with its title", () => {
  const html =
    '<ac:structured-macro ac:name="expand">' +
    '<ac:parameter ac:name="title">Click to expand</ac:parameter>' +
    "<ac:rich-text-body><p>Hidden details</p></ac:rich-text-body>" +
    "</ac:structured-macro>";
  const result = expandConfluenceMacros(html);
  assert.match(result, /\[Expand: Click to expand\]/);
  assert.match(result, /Hidden details/);
});

test("expandConfluenceMacros renders nested accordion tabs inside an accordion", () => {
  const html =
    '<ac:structured-macro ac:name="accordion">' +
    '<ac:structured-macro ac:name="accordion-tab">' +
    '<ac:parameter ac:name="title">First tab</ac:parameter>' +
    "<ac:rich-text-body><p>First content</p></ac:rich-text-body>" +
    "</ac:structured-macro>" +
    '<ac:structured-macro ac:name="accordion-tab">' +
    '<ac:parameter ac:name="title">Second tab</ac:parameter>' +
    "<ac:rich-text-body><p>Second content</p></ac:rich-text-body>" +
    "</ac:structured-macro>" +
    "</ac:structured-macro>";
  const result = expandConfluenceMacros(html);
  assert.match(result, /\[Accordion tab: First tab\]/);
  assert.match(result, /First content/);
  assert.match(result, /\[Accordion tab: Second tab\]/);
  assert.match(result, /Second content/);
});

test("expandConfluenceMacros renders a tabs-group with nested tabs-page macros", () => {
  const html =
    '<ac:structured-macro ac:name="tabs-group">' +
    '<ac:structured-macro ac:name="tabs-page">' +
    '<ac:parameter ac:name="title">Tab A</ac:parameter>' +
    "<ac:rich-text-body><p>Content A</p></ac:rich-text-body>" +
    "</ac:structured-macro>" +
    "</ac:structured-macro>";
  const result = expandConfluenceMacros(html);
  assert.match(result, /\[Tab: Tab A\]/);
  assert.match(result, /Content A/);
});

test("expandConfluenceMacros renders an info panel with a callout prefix", () => {
  const html =
    '<ac:structured-macro ac:name="info">' +
    "<ac:rich-text-body><p>Heads up</p></ac:rich-text-body>" +
    "</ac:structured-macro>";
  const result = expandConfluenceMacros(html);
  assert.match(result, /\*\*Info\*\*/);
  assert.match(result, /Heads up/);
});

test("expandConfluenceMacros falls back to stripped text for plain HTML without macros", () => {
  const html = "<p>Just a paragraph.</p>";
  assert.equal(expandConfluenceMacros(html), "Just a paragraph.");
});
