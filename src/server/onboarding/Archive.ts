import { stringify } from "csv-stringify/sync"

export const packageArchive = (files: Record<string, string>) => new Bun.Archive(files).bytes()

export const recordsCsv = (records: readonly Record<string, unknown>[]) => stringify([...records], {
  columns: [...new Set(records.flatMap(Object.keys))],
  header: true,
  quoted: true,
  record_delimiter: "\r\n",
  escape_formulas: true,
  cast: { object: (value) => JSON.stringify(value) },
})
