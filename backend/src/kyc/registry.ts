import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCsv } from "../catalogue/csv.js";
import { REPO_ROOT } from "../config.js";

/**
 * Mock GSTIN and Udyam registries (MOCK: CSV files from the hackathon pack, read-only), standing in
 * for the GSTN and Udyam portal lookups.
 */

export const DEFAULT_GSTIN_REGISTRY_PATH = resolve(REPO_ROOT, "data", "raw", "mock_gstin_registry.csv");
export const DEFAULT_UDYAM_REGISTRY_PATH = resolve(REPO_ROOT, "data", "raw", "mock_udyam_registry.csv");

export const GST_STATUSES = ["Active", "Cancelled", "Suspended"] as const;
export type GstStatus = (typeof GST_STATUSES)[number];

export interface GstRecord {
  gstin: string;
  legalName: string;
  tradeName: string;
  constitution: string;
  address: string;
  state: string;
  registrationDate: string;
  status: GstStatus;
}

export interface UdyamRecord {
  udyamNumber: string;
  enterpriseName: string;
  enterpriseType: string;
  majorActivity: string;
  nicDescription: string;
  state: string;
  city: string;
  registrationDate: string;
}

function required(row: Record<string, string>, column: string, file: string, line: number): string {
  const value = (row[column] ?? "").trim();
  if (!value) throw new Error(`${file} row ${line}: "${column}" is empty`);
  return value;
}

export function parseGstRegistry(csvText: string): Map<string, GstRecord> {
  const out = new Map<string, GstRecord>();
  parseCsv(csvText).forEach((row, i) => {
    const f = "mock_gstin_registry.csv";
    const status = required(row, "status", f, i + 2);
    if (!(GST_STATUSES as readonly string[]).includes(status)) throw new Error(`${f} row ${i + 2}: unknown status "${status}"`);
    const record: GstRecord = {
      gstin: required(row, "gstin", f, i + 2),
      legalName: required(row, "legal_name", f, i + 2),
      tradeName: required(row, "trade_name", f, i + 2),
      constitution: required(row, "constitution", f, i + 2),
      address: required(row, "principal_place_of_business", f, i + 2),
      state: required(row, "state", f, i + 2),
      registrationDate: required(row, "registration_date", f, i + 2),
      status: status as GstStatus,
    };
    if (out.has(record.gstin)) throw new Error(`${f}: GSTIN on row ${i + 2} appears twice`);
    out.set(record.gstin, record);
  });
  return out;
}

export function parseUdyamRegistry(csvText: string): Map<string, UdyamRecord> {
  const out = new Map<string, UdyamRecord>();
  parseCsv(csvText).forEach((row, i) => {
    const f = "mock_udyam_registry.csv";
    const record: UdyamRecord = {
      udyamNumber: required(row, "udyam_number", f, i + 2),
      enterpriseName: required(row, "enterprise_name", f, i + 2),
      enterpriseType: required(row, "enterprise_type", f, i + 2),
      majorActivity: required(row, "major_activity", f, i + 2),
      nicDescription: required(row, "nic_description", f, i + 2),
      state: required(row, "state", f, i + 2),
      city: required(row, "city", f, i + 2),
      registrationDate: required(row, "date_of_registration", f, i + 2),
    };
    if (out.has(record.udyamNumber)) throw new Error(`${f}: Udyam number on row ${i + 2} appears twice`);
    out.set(record.udyamNumber, record);
  });
  return out;
}

export interface Registries {
  gst: ReadonlyMap<string, GstRecord>;
  udyam: ReadonlyMap<string, UdyamRecord>;
}

export function loadRegistries(
  gstPath: string = DEFAULT_GSTIN_REGISTRY_PATH,
  udyamPath: string = DEFAULT_UDYAM_REGISTRY_PATH,
): Registries {
  return {
    gst: parseGstRegistry(readFileSync(gstPath, "utf8")),
    udyam: parseUdyamRegistry(readFileSync(udyamPath, "utf8")),
  };
}
