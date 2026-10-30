/**
 * Small RFC-4180-style CSV reader. It intentionally has no dependencies so
 * the workshop runtime can work from a clean Node installation.
 */
export function parseCsv(text) {
  const input = String(text ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let rowNumber = 1;
  let recordStartRow = 1;

  const pushField = () => {
    row.push(field);
    field = "";
  };

  const pushRow = () => {
    pushField();
    // Keep rows that have at least one non-empty cell. A trailing newline
    // should not create a phantom data row.
    if (row.some((value) => value.trim() !== "")) {
      rows.push({ values: row, rowNumber: recordStartRow });
    }
    row = [];
    recordStartRow = rowNumber + 1;
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
        if (char === "\n") rowNumber += 1;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      pushField();
      continue;
    }
    if (char === "\r") {
      if (input[i + 1] === "\n") i += 1;
      rowNumber += 1;
      pushRow();
      continue;
    }
    if (char === "\n") {
      rowNumber += 1;
      pushRow();
      continue;
    }
    field += char;
  }

  if (inQuotes) throw new Error("CSV is malformed: unterminated quoted field");
  if (field.length > 0 || row.length > 0) pushRow();

  if (rows.length === 0) return { headers: [], records: [] };
  const headers = rows[0].values.map((value) => value.replace(/^\uFEFF/, "").trim());
  const records = rows.slice(1).map(({ values, rowNumber: sourceRow }) => {
    const cells = {};
    for (let index = 0; index < headers.length; index += 1) {
      cells[headers[index]] = values[index] ?? "";
    }
    return { cells, rowNumber: sourceRow };
  });
  return { headers, records };
}
