/**
 * Minimal RFC 4180 CSV parser: quoted fields, commas and newlines inside quotes, "" escapes,
 * CRLF or LF line endings, optional UTF-8 BOM. Returns rows as objects keyed by the header.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseRows(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  const header = rows.shift();
  if (!header) throw new Error("CSV is empty");
  const seen = new Set<string>();
  for (const name of header) {
    if (seen.has(name)) throw new Error(`CSV header has duplicate column "${name}"`);
    seen.add(name);
  }
  return rows.map((cells, i) => {
    if (cells.length !== header.length) {
      throw new Error(`CSV row ${i + 2} has ${cells.length} fields, expected ${header.length}`);
    }
    const record: Record<string, string> = {};
    header.forEach((name, j) => {
      record[name] = cells[j] ?? "";
    });
    return record;
  });
}

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStarted = false;

  const endField = () => {
    row.push(field);
    field = "";
    fieldStarted = false;
  };
  const endRow = () => {
    endField();
    // Skip completely blank lines (e.g. the trailing newline at end of file).
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (fieldStarted) throw new Error(`CSV has a stray quote in an unquoted field (line ${rows.length + 1})`);
      inQuotes = true;
      fieldStarted = true;
    } else if (ch === ",") {
      endField();
    } else if (ch === "\n") {
      endRow();
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else {
      field += ch;
      fieldStarted = true;
    }
  }
  if (inQuotes) throw new Error("CSV ends inside a quoted field");
  if (field !== "" || row.length > 0) endRow();
  return rows;
}
