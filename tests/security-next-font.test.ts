import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { findFontFilesInCss } = require(
  "next/dist/compiled/@next/font/dist/google/find-font-files-in-css",
) as {
  findFontFilesInCss: (
    css: string,
    subsetsToPreload?: string[],
  ) => {
    googleFontFileUrl: string;
    preloadFontFile: boolean;
    ext: string;
  }[];
};

describe("Next Google Fonts extensionless URL regression", () => {
  it("uses the woff2 format hint without changing the extensionless URL", () => {
    const fontUrl = "/l/font?kit=x&amp;skey=y&amp;v=z";
    const css = `/* latin */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(${fontUrl}) format('woff2');
}
`;

    expect(findFontFilesInCss(css, ["latin"])).toEqual([
      {
        googleFontFileUrl: fontUrl,
        preloadFontFile: true,
        ext: "woff2",
      },
    ]);
  });
});
