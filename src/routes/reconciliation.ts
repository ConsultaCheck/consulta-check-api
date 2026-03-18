import { Router } from "express";
import { z } from "zod";
import { AttendanceModel } from "../models/Attendance";
import { LiquidationItemModel } from "../models/Liquidation";

const router = Router();

// Palabras normalizadas (sin tildes, minúsculas) - para comparación flexible
function nameToWords(name: string | undefined): Set<string> {
  if (!name || !name.trim()) return new Set();
  const words = name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean);
  return new Set(words);
}

// Distancia de Levenshtein (para tolerar typos como "Todo" vs "Toro")
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = new Array<number>(n + 1).fill(0);
  }
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }
  return dp[m]![n]!;
}

// Palabras similares: exacto, inicial, singular/plural, Levenshtein, OCR primera/última letra
function wordsSimilar(w1: string, w2: string): boolean {
  if (w1 === w2) return true;
  const clean1 = w1.replace(/[^\p{L}]/gu, "");
  const clean2 = w2.replace(/[^\p{L}]/gu, "");
  if (clean1.length <= 2 && clean2.length >= 2 && clean2.toLowerCase().startsWith(clean1.toLowerCase()))
    return true;
  if (
    clean1 + "s" === clean2 ||
    clean2 + "s" === clean1 ||
    clean1 + "es" === clean2 ||
    clean2 + "es" === clean1
  )
    return true;
  const lenDiff = Math.abs(w1.length - w2.length);
  if (lenDiff === 1 && (w1.slice(1) === w2 || w2.slice(1) === w1 || w1.slice(0, -1) === w2 || w2.slice(0, -1) === w1))
    return true;
  const maxDist = Math.min(w1.length, w2.length) <= 5 ? 1 : 2;
  return levenshtein(w1, w2) <= maxDist;
}

// Nombres compatibles: subconjunto de palabras + tolerancia a typos (ej. "Adriana Valenzuela Todo" vs "Valenzuela Toro Adriana")
function namesCompatible(a: string | undefined, b: string | undefined): boolean {
  const wordsA = Array.from(nameToWords(a));
  const wordsB = Array.from(nameToWords(b));
  if (wordsA.length === 0 || wordsB.length === 0) return false;
  const smaller = wordsA.length <= wordsB.length ? wordsA : wordsB;
  const larger = wordsA.length <= wordsB.length ? wordsB : wordsA;
  for (const w of smaller) {
    const found = larger.some((w2) => wordsSimilar(w, w2));
    if (!found) return false;
  }
  return true;
}

// RUT normalizado (solo dígitos y k)
function normalizeRut(rut: string | undefined): string {
  if (!rut || !rut.trim()) return "";
  return (rut ?? "").replace(/[.\-\s]/g, "").toLowerCase();
}

const reconciliationSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  coverage: z.string().optional(),
});

type LeanItem = { _id: unknown; patientDocument?: string; patientName?: string; dateOfService?: Date; amountPaid: number; coverage?: string };

// GET /reconciliation
// Match por RUT + fecha + monto (varios por mismo RUT = varias consultas). Si no hay RUT, fallback por nombre normalizado.
router.get("/", async (req, res, next) => {
  try {
    const parsed = reconciliationSchema.parse(req.query);

    const attFilter: Record<string, unknown> = {};
    const itemFilter: Record<string, unknown> = {};

    if (parsed.from || parsed.to) {
      attFilter.dateOfAttendance = {};
      itemFilter.dateOfService = {};
      if (parsed.from) {
        (attFilter.dateOfAttendance as Record<string, Date>).$gte = new Date(parsed.from);
        (itemFilter.dateOfService as Record<string, Date>).$gte = new Date(parsed.from);
      }
      if (parsed.to) {
        (attFilter.dateOfAttendance as Record<string, Date>).$lte = new Date(parsed.to);
        (itemFilter.dateOfService as Record<string, Date>).$lte = new Date(parsed.to);
      }
    }

    if (parsed.coverage && parsed.coverage !== "all") {
      attFilter.coverage = parsed.coverage;
      itemFilter.coverage = parsed.coverage;
    }

    const [attendances, items] = await Promise.all([
      AttendanceModel.find(attFilter)
        .select("patientName patientDocument dateOfAttendance totalAmount coverage reconciliationStatus")
        .lean(),
      LiquidationItemModel.find(itemFilter)
        .select("patientName patientDocument dateOfService amountPaid coverage liquidationId")
        .lean(),
    ]);

    const dateStr = (d: Date) => d.toISOString().slice(0, 10);

    // Por RUT+fecha+monto: lista de ítems (mismo RUT puede tener varias consultas)
    const byRutKey = new Map<string, LeanItem[]>();
    for (const item of items) {
      const rut = normalizeRut(item.patientDocument);
      if (!rut) continue;
      const key = `${rut}|${dateStr(item.dateOfService ?? new Date())}|${Math.round(item.amountPaid)}`;
      const list = byRutKey.get(key) ?? [];
      list.push(item);
      byRutKey.set(key, list);
    }

    // Por fecha + monto (para match por nombre flexible - subconjunto de palabras)
    const byDateAmount = new Map<string, LeanItem[]>();
    for (const item of items) {
      const key = `${dateStr(item.dateOfService ?? new Date())}|${Math.round(item.amountPaid)}`;
      const list = byDateAmount.get(key) ?? [];
      list.push(item);
      byDateAmount.set(key, list);
    }

    type Status = "PAID" | "UNPAID" | "PAID_NOT_REGISTERED";
    type ReconResult = {
      id: string;
      patientName: string;
      patientDocument?: string;
      date: string;
      coverage: string | undefined;
      amount: number;
      status: Status;
      reason?: string;
      liquidationId?: string;
      suggestedMatches?: {
        id: string;
        patientName: string;
        patientDocument?: string;
        date: string;
        amount: number;
        liquidationId?: string;
      }[];
    };
    const results: ReconResult[] = [];

    const matchedItemIds = new Set<string>();

    const getDateAmountKey = (item: LeanItem) =>
      `${dateStr(item.dateOfService ?? new Date())}|${Math.round(item.amountPaid)}`;

    function removeFromDateAmountIndex(item: LeanItem) {
      const key = getDateAmountKey(item);
      const list = byDateAmount.get(key);
      if (list) {
        const idx = list.findIndex((i) => String(i._id) === String(item._id));
        if (idx >= 0) list.splice(idx, 1);
      }
    }

    function removeFromRutIndex(item: LeanItem) {
      const rut = normalizeRut(item.patientDocument);
      if (rut) {
        const key = `${rut}|${getDateAmountKey(item)}`;
        const list = byRutKey.get(key);
        if (list) {
          const idx = list.findIndex((i) => String(i._id) === String(item._id));
          if (idx >= 0) list.splice(idx, 1);
        }
      }
    }

    function takeMatch(
      rutKey: string,
      dateAmountKey: string,
      att: { patientDocument?: string; patientName?: string; dateOfAttendance: Date; totalAmount: number },
    ): LeanItem | null {
      const rut = normalizeRut(att.patientDocument);
      const hasRut = rut && rut !== "-";
      if (hasRut) {
        const list = byRutKey.get(rutKey);
        if (list && list.length > 0) {
          const taken = list.shift()!;
          matchedItemIds.add(String(taken._id));
          removeFromDateAmountIndex(taken);
          return taken;
        }
      }
      let list = byDateAmount.get(dateAmountKey);
      let keyUsed = dateAmountKey;
      if (!list || list.length === 0) {
        const [datePart, amtPart] = dateAmountKey.split("|");
        const amt = parseInt(amtPart ?? "0", 10);
        const keyMinus = `${datePart}|${amt - 1}`;
        const keyPlus = `${datePart}|${amt + 1}`;
        if (byDateAmount.has(keyMinus)) (list = byDateAmount.get(keyMinus)), (keyUsed = keyMinus);
        else if (byDateAmount.has(keyPlus)) (list = byDateAmount.get(keyPlus)), (keyUsed = keyPlus);
      }
      if (!list || list.length === 0) return null;
      const idx = list.findIndex((i) => namesCompatible(att.patientName, i.patientName));
      if (idx < 0) return null;
      const taken = list.splice(idx, 1)[0]!;
      matchedItemIds.add(String(taken._id));
      removeFromRutIndex(taken);
      return taken;
    }

    for (const att of attendances) {
      const attDate = dateStr(att.dateOfAttendance);
      const manualStatus = (att as { reconciliationStatus?: "PAID" | "UNPAID" | null }).reconciliationStatus;
      if (manualStatus === "PAID") {
        results.push({
          id: `att-${att._id.toString()}`,
          patientName: att.patientName,
          patientDocument: att.patientDocument ?? "",
          date: att.dateOfAttendance.toISOString(),
          coverage: att.coverage,
          amount: att.totalAmount,
          status: "PAID",
        });
        continue;
      }
      if (manualStatus === "UNPAID") {
        const unmatchedSameDate = items.filter(
          (i) =>
            !matchedItemIds.has(String(i._id)) &&
            dateStr(i.dateOfService ?? new Date()) === attDate &&
            namesCompatible(att.patientName, i.patientName),
        );
        const reason =
          unmatchedSameDate.length > 0
            ? `Montos distintos. Liquidación: ${unmatchedSameDate.map((i) => `$${Math.round(i.amountPaid).toLocaleString("es-CL")}`).join(", ")}`
            : "No hay liquidación con misma fecha y nombre compatible";
        results.push({
          id: `att-${att._id.toString()}`,
          patientName: att.patientName,
          patientDocument: att.patientDocument ?? "",
          date: att.dateOfAttendance.toISOString(),
          coverage: att.coverage,
          amount: att.totalAmount,
          status: "UNPAID",
          reason,
        });
        continue;
      }

      const attAmt = Math.round(att.totalAmount);
      const rutKey = `${normalizeRut(att.patientDocument)}|${attDate}|${attAmt}`;
      const dateAmountKey = `${attDate}|${attAmt}`;

      const match = takeMatch(rutKey, dateAmountKey, att);

      if (match) {
        const rut =
          (att.patientDocument && att.patientDocument.trim() !== "" && att.patientDocument !== "-")
            ? att.patientDocument
            : (match.patientDocument ?? "");
        results.push({
          id: `att-${att._id.toString()}`,
          patientName: att.patientName,
          patientDocument: rut,
          date: att.dateOfAttendance.toISOString(),
          coverage: att.coverage,
          amount: att.totalAmount,
          status: "PAID",
        });
      } else {
        const unmatchedSameDate = items.filter(
          (i) =>
            !matchedItemIds.has(String(i._id)) &&
            dateStr(i.dateOfService ?? new Date()) === attDate &&
            namesCompatible(att.patientName, i.patientName),
        );
        const reason =
          unmatchedSameDate.length > 0
            ? `Montos distintos. Liquidación: ${unmatchedSameDate.map((i) => `$${Math.round(i.amountPaid).toLocaleString("es-CL")}`).join(", ")}`
            : "No hay liquidación con misma fecha y nombre compatible";
        const recon: ReconResult = {
          id: `att-${att._id.toString()}`,
          patientName: att.patientName,
          patientDocument: att.patientDocument ?? "",
          date: att.dateOfAttendance.toISOString(),
          coverage: att.coverage,
          amount: att.totalAmount,
          status: "UNPAID",
          reason,
        };
        if (unmatchedSameDate.length > 0) {
          recon.suggestedMatches = unmatchedSameDate.map((i) => {
            const liq = i as LeanItem & { liquidationId?: unknown };
            const sm: NonNullable<ReconResult["suggestedMatches"]>[number] = {
              id: `liqitem-${i._id.toString()}`,
              patientName: i.patientName ?? "Desconocido",
              patientDocument: i.patientDocument,
              date: (i.dateOfService ?? new Date()).toISOString(),
              amount: i.amountPaid,
            };
            if (liq.liquidationId) sm.liquidationId = String(liq.liquidationId);
            return sm;
          });
        }
        results.push(recon);
      }
    }

    const unpaidResults = results.filter((r) => r.status === "UNPAID");
    for (const item of items) {
      if (matchedItemIds.has(String(item._id))) continue;
      const itemDate = dateStr(item.dateOfService ?? new Date());
      const unpaidSameDate = unpaidResults.filter(
        (r) =>
          r.id.startsWith("att-") &&
          dateStr(new Date(r.date)) === itemDate &&
          namesCompatible(item.patientName, r.patientName),
      );
      const reason =
        unpaidSameDate.length > 0
          ? `Montos distintos. Asistencia: ${unpaidSameDate.map((r) => `$${Math.round(r.amount).toLocaleString("es-CL")}`).join(", ")}`
          : "No hay asistencia con misma fecha y nombre compatible";
      const liqItem = item as LeanItem & { liquidationId?: unknown };
      const recon: ReconResult = {
        id: `liqitem-${item._id.toString()}`,
        patientName: item.patientName ?? "Desconocido",
        patientDocument: item.patientDocument ?? "",
        date: (item.dateOfService ?? new Date()).toISOString(),
        coverage: item.coverage,
        amount: item.amountPaid,
        status: "PAID_NOT_REGISTERED",
        reason,
      };
      if (liqItem.liquidationId) recon.liquidationId = String(liqItem.liquidationId);
      if (unpaidSameDate.length > 0) {
        recon.suggestedMatches = unpaidSameDate.map((r) => ({
          id: r.id,
          patientName: r.patientName,
          patientDocument: r.patientDocument,
          date: r.date,
          amount: r.amount,
        }));
      }
      results.push(recon);
    }

    res.json(results);
  } catch (err) {
    next(err);
  }
});

// POST /reconciliation/sync-ruts
// Sincroniza los RUT de la liquidación a las asistencias cuando hay coincidencia (nombre + fecha + monto)
router.post("/sync-ruts", async (req, res, next) => {
  try {
    const parsed = reconciliationSchema.parse(req.query);

    const attFilter: Record<string, unknown> = {};
    const itemFilter: Record<string, unknown> = {};

    if (parsed.from || parsed.to) {
      attFilter.dateOfAttendance = {};
      itemFilter.dateOfService = {};
      if (parsed.from) {
        (attFilter.dateOfAttendance as Record<string, Date>).$gte = new Date(parsed.from);
        (itemFilter.dateOfService as Record<string, Date>).$gte = new Date(parsed.from);
      }
      if (parsed.to) {
        (attFilter.dateOfAttendance as Record<string, Date>).$lte = new Date(parsed.to);
        (itemFilter.dateOfService as Record<string, Date>).$lte = new Date(parsed.to);
      }
    }

    if (parsed.coverage && parsed.coverage !== "all") {
      attFilter.coverage = parsed.coverage;
      itemFilter.coverage = parsed.coverage;
    }

    const [attendances, items] = await Promise.all([
      AttendanceModel.find(attFilter).lean(),
      LiquidationItemModel.find(itemFilter).lean(),
    ]);

    const dateStr = (d: Date) => d.toISOString().slice(0, 10);

    const byRutKey = new Map<string, LeanItem[]>();
    for (const item of items) {
      const rut = normalizeRut(item.patientDocument);
      if (!rut) continue;
      const key = `${rut}|${dateStr(item.dateOfService ?? new Date())}|${Math.round(item.amountPaid)}`;
      const list = byRutKey.get(key) ?? [];
      list.push(item);
      byRutKey.set(key, list);
    }

    const byDateAmount = new Map<string, LeanItem[]>();
    for (const item of items) {
      const key = `${dateStr(item.dateOfService ?? new Date())}|${Math.round(item.amountPaid)}`;
      const list = byDateAmount.get(key) ?? [];
      list.push(item);
      byDateAmount.set(key, list);
    }

    const matchedItemIds = new Set<string>();

    const getDateAmountKey = (item: LeanItem) =>
      `${dateStr(item.dateOfService ?? new Date())}|${Math.round(item.amountPaid)}`;

    function removeFromDateAmountIndex(item: LeanItem) {
      const key = getDateAmountKey(item);
      const list = byDateAmount.get(key);
      if (list) {
        const idx = list.findIndex((i) => String(i._id) === String(item._id));
        if (idx >= 0) list.splice(idx, 1);
      }
    }

    function removeFromRutIndex(item: LeanItem) {
      const rut = normalizeRut(item.patientDocument);
      if (rut) {
        const key = `${rut}|${getDateAmountKey(item)}`;
        const list = byRutKey.get(key);
        if (list) {
          const idx = list.findIndex((i) => String(i._id) === String(item._id));
          if (idx >= 0) list.splice(idx, 1);
        }
      }
    }

    function takeMatch(
      rutKey: string,
      dateAmountKey: string,
      att: { patientDocument?: string; patientName?: string; dateOfAttendance: Date; totalAmount: number },
    ): LeanItem | null {
      const rut = normalizeRut(att.patientDocument);
      const hasRut = rut && rut !== "-";
      if (hasRut) {
        const list = byRutKey.get(rutKey);
        if (list && list.length > 0) {
          const taken = list.shift()!;
          matchedItemIds.add(String(taken._id));
          removeFromDateAmountIndex(taken);
          return taken;
        }
      }
      let list = byDateAmount.get(dateAmountKey);
      let keyUsed = dateAmountKey;
      if (!list || list.length === 0) {
        const [datePart, amtPart] = dateAmountKey.split("|");
        const amt = parseInt(amtPart ?? "0", 10);
        const keyMinus = `${datePart}|${amt - 1}`;
        const keyPlus = `${datePart}|${amt + 1}`;
        if (byDateAmount.has(keyMinus)) (list = byDateAmount.get(keyMinus)), (keyUsed = keyMinus);
        else if (byDateAmount.has(keyPlus)) (list = byDateAmount.get(keyPlus)), (keyUsed = keyPlus);
      }
      if (!list || list.length === 0) return null;
      const idx = list.findIndex((i) => namesCompatible(att.patientName, i.patientName));
      if (idx < 0) return null;
      const taken = list.splice(idx, 1)[0]!;
      matchedItemIds.add(String(taken._id));
      removeFromRutIndex(taken);
      return taken;
    }

    let updated = 0;

    for (const att of attendances) {
      const attRecord = att as { _id: unknown; reconciliationStatus?: "PAID" | "UNPAID" | null; patientDocument?: string };
      if (attRecord.reconciliationStatus === "UNPAID") continue; // Sin match, no hay RUT de liquidación

      const attDate = dateStr(att.dateOfAttendance);
      const attAmt = Math.round(att.totalAmount);
      const rutKey = `${normalizeRut(att.patientDocument)}|${attDate}|${attAmt}`;
      const dateAmountKey = `${attDate}|${attAmt}`;

      const match = takeMatch(rutKey, dateAmountKey, att);

      if (match && match.patientDocument && match.patientDocument.trim()) {
        const liqRut = match.patientDocument.trim();
        const attRut = (attRecord.patientDocument ?? "").trim();
        const shouldUpdate =
          !attRut || attRut === "-" || normalizeRut(attRut) !== normalizeRut(liqRut);

        if (shouldUpdate) {
          await AttendanceModel.updateOne(
            { _id: att._id },
            { $set: { patientDocument: liqRut } },
          );
          updated++;
        }
      }
    }

    res.json({ updated });
  } catch (err) {
    next(err);
  }
});

export default router;

