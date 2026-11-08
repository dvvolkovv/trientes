import { afterEach, describe, expect, it, vi } from "vitest";

type TestAttribute = { name: string; value: string };

// Node has no DOMParser. This minimal test double deliberately models the
// browser's live NamedNodeMap: removing an attribute shifts the next one left.
class TestElement {
  readonly children: TestElement[] = [];

  constructor(
    readonly tagName: string,
    private readonly attributes: TestAttribute[],
  ) {}

  removeAttribute(name: string) {
    const index = this.attributes.findIndex((attribute) => attribute.name === name);
    if (index >= 0) this.attributes.splice(index, 1);
  }

  serialize(): string {
    const attributes = this.attributes
      .map(({ name, value }) => (value ? ` ${name}="${value}"` : ` ${name}`))
      .join("");
    const children = this.children.map((child) => child.serialize()).join("");
    return `<${this.tagName}${attributes}>${children}</${this.tagName}>`;
  }
}

class TestBody {
  constructor(readonly children: TestElement[]) {}

  querySelectorAll(): TestElement[] {
    return [];
  }

  get innerHTML(): string {
    return this.children.map((child) => child.serialize()).join("");
  }
}

class TestDOMParser {
  parseFromString(input: string): { body: TestBody } {
    const match = /^<details\s+([^>]*)><\/details>$/.exec(input);
    if (!match) throw new Error("Unsupported test fixture");

    const attributes = Array.from(
      match[1].matchAll(/([^\s=]+)(?:="([^"]*)")?/g),
      (attribute) => ({ name: attribute[1], value: attribute[2] ?? "" }),
    );
    return { body: new TestBody([new TestElement("details", attributes)]) };
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MapLibre DOM.sanitize adjacent event attributes", () => {
  it("removes every malicious handler and preserves the safe open attribute", async () => {
    const { DOM } = await vi.importActual<{
      DOM: { sanitize(input: string): string };
    }>("../node_modules/maplibre-gl/src/util/dom");
    vi.stubGlobal("DOMParser", TestDOMParser);

    const sanitized = DOM.sanitize(
      '<details open onload="alert(1)" ontoggle="alert(2)"></details>',
    );

    expect(sanitized).not.toContain("onload=");
    expect(sanitized).not.toContain("ontoggle=");
    expect(sanitized).toBe("<details open></details>");
  });
});
