/**
 * Parsea texto extraído de PDF de liquidación/cotización médica (ej. CEM LIRCAY).
 * Formato de línea: # Cod Tipo Agrupación Fecha Hora $ Total $ Calc% Paciente RUT
 * Ej: 1 6755 CONSULTA MEDICA 02-02-2026 15:48 $ 14.870 $ 10.409 GOMEZ SANCHEZ EDITH 04.678.760-9
 * RUT opcional: se aceptan líneas con fecha + monto + nombre aunque no tengan RUT.
 */

export interface ParsedLiquidationRow {
  dateOfService: string;
  patientName: string;
  patientDocument?: string;
  amountPaid: number;
}

// RUT chileno: con puntos (04.678.760-9) o sin (4678760-9)
const RUT_REGEX = /\d{1,2}\.\d{3}\.\d{3}-[\dkK]|\d{7,8}-[\dkK]/gi;
const AMOUNT_REGEX = /\$\s*([\d.]+)/g;
// Fecha DD-MM-YYYY y opcionalmente hora HH:MM (ej. 02-02-2026 15:48)
const DATE_TIME_REGEX = /(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/;

function parseAmount(match: string): number {
  const m = match.match(/\$\s*([\d.]+)/);
  if (!m) return 0;
  const num = m[1]!.replace(/\./g, "");
  return parseInt(num, 10) || 0;
}

export function parseLiquidationPdfText(text: string): ParsedLiquidationRow[] {
  const lines = text.split(/\r?\n/);
  const results: ParsedLiquidationRow[] = [];
  let inDetailSection = false;

  const sectionKeywords = [
    "DETALLE LIQUIDACIÓN",
    "DETALLE LIQUIDACION",
    "DETALLE COTIZACIÓN",
    "DETALLE COTIZACION",
  ];
  for (const line of lines) {
    const trimmed = line.trim();
    if (sectionKeywords.some((kw) => trimmed.includes(kw))) {
      inDetailSection = true;
      continue;
    }
    if (!inDetailSection) continue;

    const amounts = [...trimmed.matchAll(AMOUNT_REGEX)];
    const totalAmount = amounts[0] ? parseAmount(amounts[0][0]!) : 0;
    const dateTimeMatch = trimmed.match(DATE_TIME_REGEX);
    if (!dateTimeMatch || totalAmount <= 0) continue;

    const dateOfService = `${dateTimeMatch[3]}-${dateTimeMatch[2]}-${dateTimeMatch[1]}T${(dateTimeMatch[4] ?? "12").padStart(2, "0")}:${(dateTimeMatch[5] ?? "00").padStart(2, "0")}:00.000Z`;

    const lastAmountMatch = amounts[amounts.length - 1];
    const lastAmountEnd = lastAmountMatch
      ? trimmed.indexOf(lastAmountMatch[0]!) + lastAmountMatch[0]!.length
      : 0;
    const patientPart = trimmed.slice(lastAmountEnd).trim();
    const rutMatch = patientPart.match(RUT_REGEX);
    const rut = rutMatch ? rutMatch[0]!.trim() : undefined;
    const patientName = patientPart.replace(RUT_REGEX, "").replace(/\s+/g, " ").trim();

    if (patientName.length >= 3) {
      const row: ParsedLiquidationRow = {
        dateOfService,
        patientName,
        amountPaid: totalAmount,
      };
      if (rut) row.patientDocument = rut;
      results.push(row);
    }
  }

  return results;
}
