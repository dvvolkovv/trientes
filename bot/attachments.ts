const LINE_MARKER = /^📎 attach:\s*(.+?)\s*$/;

export function parseAttachments(input: string): {
  text: string;
  paths: string[];
} {
  const paths: string[] = [];
  const kept: string[] = [];
  for (const line of input.split("\n")) {
    const m = LINE_MARKER.exec(line);
    if (m) {
      paths.push(m[1]);
    } else {
      kept.push(line);
    }
  }
  return { text: kept.join("\n"), paths };
}
