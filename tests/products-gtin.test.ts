import { describe, expect, it } from "vitest";
import { parseGtin } from "@/lib/products/gtin";

describe("parseGtin", () => {
  it("accepts a real EAN-13 and keeps it as is", () => {
    // Coca-Cola 0,5 л (живой код с упаковки) и книжный ISBN-13.
    expect(parseGtin("5449000000996")).toBe("5449000000996");
    expect(parseGtin("9783161484100")).toBe("9783161484100");
  });

  it("rejects an EAN-13 whose check digit does not add up", () => {
    expect(parseGtin("5449000000997")).toBeNull();
  });

  it("normalises UPC-12 to EAN-13 with a leading zero", () => {
    expect(parseGtin("036000291452")).toBe("0036000291452");
  });

  it("accepts EAN-8 as it is", () => {
    expect(parseGtin("96385074")).toBe("96385074");
    expect(parseGtin("96385075")).toBeNull();
  });

  it("strips spaces and dashes a human types from a package", () => {
    expect(parseGtin(" 5449-0000 0099 6 ")).toBe("5449000000996");
  });

  it("refuses anything that is not a barcode", () => {
    for (const bad of ["", "   ", "abc", "12345", "5449000000996x", "544900000099600"]) {
      expect(parseGtin(bad)).toBeNull();
    }
  });

  it("refuses all zeroes: a code that names no product", () => {
    expect(parseGtin("0000000000000")).toBeNull();
    expect(parseGtin("00000000")).toBeNull();
  });
});
