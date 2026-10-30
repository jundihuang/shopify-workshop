import fs from "node:fs/promises";
import zlib from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function decodeXml(value) {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function readZipEntries(buffer) {
  let eocdOffset = -1;
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("Invalid XLSX file: ZIP end-of-central-directory record not found");

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map();
  let cursor = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new Error("Invalid XLSX file: malformed ZIP central directory");
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");

    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new Error(`Invalid XLSX file: malformed local header for ${name}`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

    let contents;
    if (method === 0) {
      contents = Buffer.from(compressed);
    } else if (method === 8) {
      try {
        contents = zlib.inflateRawSync(compressed);
      } catch (error) {
        throw new Error(`Invalid XLSX file: could not inflate ${name}: ${error.message}`);
      }
    } else {
      throw new Error(`Unsupported XLSX ZIP compression method ${method} for ${name}`);
    }
    if (uncompressedSize > 0 && contents.length !== uncompressedSize) {
      throw new Error(`Invalid XLSX file: size mismatch while reading ${name}`);
    }
    entries.set(name, contents.toString("utf8"));
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function attr(attrs, name) {
  const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`, "i").exec(attrs);
  return match ? decodeXml(match[1]) : null;
}

function textFromXml(fragment) {
  const chunks = [];
  const textRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/gi;
  let match;
  while ((match = textRegex.exec(fragment)) !== null) chunks.push(decodeXml(match[1]));
  return chunks.join("");
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const strings = [];
  const itemRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) strings.push(textFromXml(match[1]));
  return strings;
}

function columnIndex(reference) {
  const match = /^([A-Z]+)(\d+)$/i.exec(reference || "");
  if (!match) return null;
  let index = 0;
  for (const char of match[1].toUpperCase()) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function parseCellValue(attrs, inner, sharedStrings) {
  const type = attr(attrs, "t");
  if (type === "inlineStr") {
    const inline = textFromXml(inner);
    if (inline !== "") return inline;
  }

  const valueMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/i.exec(inner);
  const raw = valueMatch ? decodeXml(valueMatch[1]) : "";
  if (type === "s") {
    const index = Number.parseInt(raw, 10);
    return Number.isInteger(index) ? sharedStrings[index] ?? "" : "";
  }
  if (type === "b") return raw === "1" ? "TRUE" : "FALSE";
  if (type === "str" || type === "d") return raw;
  if (type === "inlineStr") return "";
  return raw;
}

function parseSheet(xml, sharedStrings) {
  const rows = [];
  const rowRegex = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(xml)) !== null) {
    const rowAttrs = rowMatch[1] ?? "";
    const rowInner = rowMatch[2] ?? "";
    const rowNumber = Number.parseInt(attr(rowAttrs, "r") || "0", 10) || rows.length + 1;
    const cells = [];
    let maxColumn = -1;
    const cellRegex = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowInner)) !== null) {
      const attrs = cellMatch[1] ?? "";
      const inner = cellMatch[2] ?? "";
      const reference = attr(attrs, "r");
      let index = columnIndex(reference);
      if (index === null) index = cells.length;
      cells[index] = parseCellValue(attrs, inner, sharedStrings);
      if (index > maxColumn) maxColumn = index;
    }
    const values = Array.from({ length: maxColumn + 1 }, (_, index) => cells[index] ?? "");
    if (values.some((value) => String(value).trim() !== "")) rows.push({ values, rowNumber });
  }
  return rows;
}

export async function parseXlsx(filePath) {
  const buffer = await fs.readFile(filePath);
  const entries = readZipEntries(buffer);
  const sharedStrings = parseSharedStrings(entries.get("xl/sharedStrings.xml"));
  const sheetNames = [...entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const na = Number(a.match(/(\d+)\.xml$/i)?.[1] ?? 0);
      const nb = Number(b.match(/(\d+)\.xml$/i)?.[1] ?? 0);
      return na - nb;
    });
  if (sheetNames.length === 0) throw new Error("Invalid XLSX file: no worksheet found");
  const rows = parseSheet(entries.get(sheetNames[0]), sharedStrings);
  if (rows.length === 0) return { headers: [], records: [] };

  const headers = rows[0].values.map((value) => String(value).trim());
  const records = rows.slice(1).map(({ values, rowNumber }) => {
    const cells = {};
    for (let index = 0; index < headers.length; index += 1) cells[headers[index]] = values[index] ?? "";
    return { cells, rowNumber };
  });
  return { headers, records };
}
