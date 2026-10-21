// server/app.ts
import express from "express";
import { randomUUID } from "node:crypto";
import { z as z3 } from "zod";

// server/auth.ts
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

// server/store.ts
import { MongoClient } from "mongodb";

// client/memberships.ts
var plans = { 10: { hours: 10, days: 10, price: 699 }, 30: { hours: 30, days: 30, price: 1999 }, 100: { hours: 100, days: 100, price: 5999 } };
var phoneKey = (s) => s.length === 10 ? "91" + s : s;
var expiryTime = (date) => Date.parse(date + "T23:59:59.999+05:30");
var playedMilliseconds = (s, now) => {
  const end = Math.min(now, s.end ?? now);
  return Math.max(0, end - s.start - (s.pauses ?? []).reduce((sum, p) => sum + Math.max(0, Math.min(end, p.end ?? end) - Math.max(s.start, p.start)), 0));
};
var coveredMinutes = (s, now) => s.membershipId ? Math.min(s.memberMinutesAtStart ?? 0, Math.ceil(playedMilliseconds(s, Math.min(now, s.memberExpiresAt ?? now)) / 6e4)) : 0;

// client/model.ts
var initial = () => ({ stations: Array.from({ length: 16 }, (_, i) => ({ id: "pc" + (i + 1), name: "PC " + String(i + 1).padStart(2, "0"), type: "PC", rate: 79 })), menu: [], active: [], invoices: [] });
var cost = (s, now) => {
  const minutes = Math.ceil(playedMilliseconds(s, now) / 6e4), hourly = s.rate + (s.controllerCount ?? 0) * (s.controllerRate ?? 0);
  return Math.round((s.membershipId ? (Math.max(0, minutes - coveredMinutes(s, now)) * s.rate + minutes * (s.controllerCount ?? 0) * (s.controllerRate ?? 0)) / 60 : s.offer ? s.offer.price + Math.max(0, minutes - s.offer.minutes) * hourly / 60 : minutes * hourly / 60) * 100) / 100;
};
var extras = (s) => s.items.reduce((a, x) => a + x.price * x.qty, 0);
function applyTax(session, config) {
  const amount = config?.enabled ? Math.round((session.gaming ?? 0) * config.gamingRate + extras(session) * config.foodRate) / 100 : 0;
  session.tax = config?.enabled ? { label: config.label, gamingRate: config.gamingRate, foodRate: config.foodRate, amount } : void 0;
  session.total = Math.round(((session.gaming ?? 0) + extras(session) + amount) * 100) / 100;
}

// client/pricing.ts
var indiaParts = (now) => {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  return Object.fromEntries(p.map((x) => [x.type, x.value]));
};
var weekend = (now) => ["Fri", "Sat", "Sun"].includes(indiaParts(now).weekday);
var rateFor = (s, now) => weekend(now) ? s.weekendRate ?? s.rate : s.rate;
var controllerRateFor = (s) => s.controllerRate ?? (s.type === "PC" ? 50 : s.type === "PS5" ? 100 : void 0);
var typeRates = { PC: [100, 150], PS5: [200, 250], Pool: [250, 300], "Private room": [1e3, 1200] };
function offersFor(st, now) {
  const w = weekend(now), parts = indiaParts(now), hour = Number(parts.hour);
  const happy = !w && hour >= 11 && hour < 16;
  const plans2 = [];
  if (st.type === "PC") {
    plans2.push({ id: "pc-coke", name: "PC 3 hours + Coke (single)", price: w ? 369 : 269, minutes: 180, controllers: 0, includes: "1 Coke" });
    if (happy) plans2.push({ id: "pc-happy", name: "Happy hours \xB7 PC + Thums Up (single)", price: 169, minutes: 120, controllers: 0, includes: "Thums Up \xB7 1+1 hour" });
  }
  if (st.type === "PS5") plans2.push({ id: "ps5-coke", name: "PS5 2 hours + Coke (double)", price: w ? 699 : 599, minutes: 120, controllers: 1, includes: "Coke for double-player combo \xB7 1 extra controller" });
  if (happy && (st.type === "PS5" || st.type === "Xbox" && controllerRateFor(st) !== void 0)) plans2.push({ id: "console-happy", name: "Happy hours \xB7 PS5/Xbox + Coke (double)", price: 448, minutes: 120, controllers: 1, includes: "Coke \xB7 1 extra controller \xB7 1+1 hour" });
  return plans2;
}
var products = [
  ...["French Fries", "Veg Nuggets", "Garlic Bread", "Mexican Nachos", "Veg Maggi", "Indian Dhokla"].map((n) => [n, 99, "Snacks"]),
  ["Veg Burger", 109, "Snacks"],
  ["Veg Grill Sandwich", 109, "Snacks"],
  ["Veg Hakka Noodles", 129, "Snacks"],
  ["Veg Pizza", 199, "Snacks"],
  ["Veg Pasta", 199, "Snacks"],
  ["French Toast Icecream", 199, "Snacks"],
  ["Combo 1 \xB7 Veg Burger + French Fries + Coke", 199, "Food combos"],
  ["Combo 2 \xB7 Veg Grill Sandwich + Chips + Cold Coffee", 199, "Food combos"],
  ["Combo 3 \xB7 White Sauce Pasta + Garlic Bread + Mocktail", 249, "Food combos"],
  ["Combo 4 \xB7 Veg Farmhouse Pizza + Diet Coke", 249, "Food combos"],
  ["Combo 5 \xB7 Veg Hakka Noodles + Paneer Chilli + Cooler", 249, "Food combos"],
  ...["Green Apple", "Guava Blast", "Pineapple Punch", "Mango Mania", "Litchi Love", "Orangina", "Kiwi Kick", "Blueberry Pop", "Blue Lagoon", "Black Currant Cooler"].map((n) => [n, 99, "Mocktails"]),
  ...["Chocolate Shake", "Caramel Shake", "Butterscotch Shake", "Classic Cold Coffee", "Oreo Cold Coffee", "Vanilla Icecream Cold Coffee"].map((n) => [n, 129, "Shakes & coffee"]),
  ...["Coke", "Diet Coke", "Sprite", "Fanta", "Thums Up", "Limca"].flatMap((n) => [69, 79].map((p) => [n + " \xB7 \u20B9" + p + " can", p, "Soft drinks"])),
  ["Red Bull", 129, "Energy & water"],
  ["Monster", 129, "Energy & water"],
  ["Mineral Water 500 ml", 10, "Energy & water"]
];
var suppliedMenu = () => products.map(([name, price, category], i) => ({ id: "menu-20261012-" + i, name, price, category }));
function upgradePrices(state) {
  if (state.priceVersion === 1) return state;
  const stations = state.stations.map((st) => typeRates[st.type] ? { ...st, rate: typeRates[st.type][0], weekendRate: typeRates[st.type][1], controllerRate: controllerRateFor(st) } : st);
  for (const [id, name, type] of [["ps5-1", "PS5 01", "PS5"], ["private-1", "PS5 Private Room", "Private room"], ["pool-1", "Pool Table 01", "Pool"]]) {
    if (!stations.some((s) => s.type === type)) stations.push({ id, name, type, rate: typeRates[type][0], weekendRate: typeRates[type][1] });
  }
  const menu = [...state.menu];
  for (const f of suppliedMenu()) {
    const existing = menu.find((x) => x.name.toLowerCase() === f.name.toLowerCase());
    if (existing) {
      existing.price = f.price;
      existing.category = f.category;
    } else menu.push(f);
  }
  return { ...state, stations, menu, priceVersion: 1 };
}

// client/billing.ts
var invoiceSessions = (invoice) => invoice.kind === "membershipSale" ? [] : invoice.sessions ?? [invoice];

// client/invoice-editing.ts
function reviseInvoice(state, op, now, actor) {
  const invoice = state.invoices.find((x) => x.id === op.id);
  if (!invoice) throw Error("Invoice not found.");
  const before = structuredClone(invoice);
  delete before.history;
  const sessions = invoiceSessions(invoice);
  if (op.sessions.length !== sessions.length || new Set(op.sessions.map((x) => x.id)).size !== sessions.length) throw Error("Session list has changed. Reopen the invoice.");
  for (const change of op.sessions) {
    const session = sessions.find((x) => x.id === change.id);
    if (!session) throw Error("Session not found.");
    if (change.end < change.start || change.end > now) throw Error("Session end must follow start and cannot be in the future.");
    const originalEnd = session.end;
    const timeChanged = change.start !== session.start || change.end !== session.end;
    const oldUsed = session.membershipMinutesUsed ?? 0;
    session.pauses = session.pauses?.map((p) => ({ start: Math.max(change.start, p.start), end: Math.min(change.end, p.end ?? originalEnd) })).filter((p) => p.end > p.start);
    delete session.pausedAt;
    session.start = change.start;
    session.end = change.end;
    if (session.membershipId && timeChanged) {
      const m = state.memberships?.find((x) => x.id === session.membershipId);
      if (!m) throw Error("Membership record not found.");
      const used = coveredMinutes(session, change.end), delta = used - oldUsed;
      if (delta && state.active.some((x) => x.membershipId === m.id)) throw Error("End the active membership session before correcting its previous playing time.");
      if (m.remainingMinutes - delta < 0 || m.remainingMinutes - delta > m.totalMinutes) throw Error("This correction exceeds the available membership balance.");
      m.remainingMinutes -= delta;
      session.membershipMinutesUsed = used;
      session.memberBalanceAfter = Math.max(0, (session.memberBalanceAfter ?? m.remainingMinutes + delta) - delta);
    }
    session.gaming = Math.round(change.gaming * 100) / 100;
    session.items = change.items.map((f) => ({ ...f, price: Math.round(f.price * 100) / 100 }));
    applyTax(session, session.tax ? { enabled: true, ...session.tax } : void 0);
  }
  if (invoice.sessions) {
    invoice.start = Math.min(...sessions.map((x) => x.start));
    invoice.gaming = sessions.reduce((n, x) => n + Math.round((x.gaming ?? 0) * 100), 0) / 100;
    invoice.items = sessions.flatMap((x) => x.items);
    invoice.total = sessions.reduce((n, x) => n + Math.round((x.total ?? 0) * 100), 0) / 100;
    if (invoice.tax) invoice.tax.amount = sessions.reduce((n, x) => n + Math.round((x.tax?.amount ?? 0) * 100), 0) / 100;
  }
  if (invoice.kind !== "membershipSale") {
    invoice.adjustment = Math.round((op.adjustment ?? invoice.adjustment ?? 0) * 100) / 100;
    invoice.adjustmentReason = op.adjustmentReason ?? invoice.adjustmentReason;
    invoice.total = Math.round(((invoice.total ?? 0) + invoice.adjustment) * 100) / 100;
    if (invoice.total < 0) throw Error("Discount cannot exceed the bill subtotal.");
  }
  invoice.name = op.name;
  invoice.phone = op.phone;
  invoice.payment = op.payment;
  delete invoice.cashAmount;
  delete invoice.upiAmount;
  if (op.payment === "Split") {
    const cash = Math.round((op.cashAmount ?? 0) * 100), upi = Math.round((op.upiAmount ?? 0) * 100);
    if (cash <= 0 || upi <= 0 || cash + upi !== Math.round((invoice.total ?? 0) * 100)) throw Error("Cash and UPI must add up exactly to the revised total.");
    invoice.cashAmount = cash / 100;
    invoice.upiAmount = upi / 100;
  }
  if (invoice.kind === "membershipSale") {
    const m = state.memberships?.find((x) => x.id === invoice.saleMembershipId);
    if (m) {
      if (op.payment === "Unpaid" && state.active.some((x) => x.membershipId === m.id)) throw Error("Cannot mark a membership unpaid while it is in use.");
      m.payment = op.payment;
      m.cashAmount = invoice.cashAmount;
      m.upiAmount = invoice.upiAmount;
    }
  }
  invoice.history ??= [];
  invoice.history.push({ at: now, actor, reason: op.reason, before, afterTotal: invoice.total ?? 0 });
  return invoice;
}

// server/operations.ts
import { z } from "zod";
var calendar = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => Number.isFinite(Date.parse(d + "T00:00:00Z")) && (/* @__PURE__ */ new Date(d + "T00:00:00Z")).toISOString().slice(0, 10) === d);
var input = z.discriminatedUnion("op", [
  z.object({ op: z.literal("customer"), id: z.string().uuid().optional(), name: z.string().trim().min(1).max(100), phone: z.string().regex(/^\d{10,15}$/), notes: z.string().trim().max(1e3).default("") }),
  z.object({ op: z.literal("foods"), id: z.string(), items: z.array(z.object({ food: z.string(), qty: z.number().int().min(1).max(100) })).min(1).max(100).refine((items) => new Set(items.map((x) => x.food)).size === items.length) }),
  z.object({ op: z.literal("editInvoice"), adjustment: z.number().min(-1e7).max(1e7).optional(), adjustmentReason: z.string().trim().max(200).optional(), id: z.string(), name: z.string().trim().min(1).max(100), phone: z.string().regex(/^\d{10,15}$/).or(z.literal("")), reason: z.string().trim().min(3).max(300), payment: z.enum(["UPI", "Cash", "Card", "Unpaid", "Split"]), cashAmount: z.number().nonnegative().max(1e7).optional(), upiAmount: z.number().nonnegative().max(1e7).optional(), sessions: z.array(z.object({ id: z.string(), start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), gaming: z.number().nonnegative().max(1e7), items: z.array(z.object({ name: z.string().trim().min(1).max(100), price: z.number().nonnegative().max(1e5), qty: z.number().int().min(1).max(100) })).max(500) })).max(100) }),
  z.object({ op: z.literal("shop"), name: z.string().trim().min(1).max(100), address: z.string().max(300), phone: z.string().max(30), email: z.string().email().or(z.literal("")), gstin: z.string().max(30), receiptNote: z.string().max(300) }),
  z.object({ op: z.literal("taxConfig"), enabled: z.boolean(), label: z.string().trim().min(1).max(50), gamingRate: z.number().min(0).max(100), foodRate: z.number().min(0).max(100) }),
  z.object({ op: z.literal("pause"), id: z.string() }),
  z.object({ op: z.literal("resume"), id: z.string() }),
  z.object({ op: z.literal("expense"), date: calendar, category: z.string().trim().min(1).max(60), description: z.string().trim().min(1).max(200), amount: z.number().positive().max(1e7), payment: z.enum(["Cash", "UPI", "Card"]) }),
  z.object({ op: z.literal("deleteExpense"), id: z.string() }),
  z.object({ op: z.literal("stop"), id: z.string() }),
  z.object({ op: z.literal("combine"), adjustment: z.number().min(-1e7).max(1e7).default(0), adjustmentReason: z.string().trim().max(200).default(""), ids: z.array(z.string()).min(1).max(100).refine((ids) => new Set(ids).size === ids.length), name: z.string().trim().min(1).max(100), phone: z.string().regex(/^\d{10,15}$/).or(z.literal("")), payment: z.enum(["UPI", "Cash", "Card", "Unpaid", "Split"]), cashAmount: z.number().min(0).max(1e7).optional(), upiAmount: z.number().min(0).max(1e7).optional() }),
  z.object({ op: z.literal("membership"), name: z.string().trim().min(1).max(100), phone: z.string().regex(/^\d{10,15}$/), planHours: z.union([z.literal(10), z.literal(30), z.literal(100)]), purchasedDate: calendar, expiryDate: calendar, remainingMinutes: z.number().int().nonnegative(), recordSale: z.boolean(), payment: z.enum(["UPI", "Cash", "Card", "Unpaid", "Split"]), cashAmount: z.number().min(0).max(1e7).optional(), upiAmount: z.number().min(0).max(1e7).optional() }),
  z.object({ op: z.literal("membershipPaid"), id: z.string(), payment: z.enum(["UPI", "Cash", "Card", "Split"]), cashAmount: z.number().min(0).max(1e7).optional(), upiAmount: z.number().min(0).max(1e7).optional() }),
  z.object({ op: z.literal("start"), station: z.string(), name: z.string().trim().min(1).max(100), phone: z.string().regex(/^\d{10,15}$/).or(z.literal("")), minutes: z.number().int().min(1).max(1440).nullable(), offer: z.string().optional(), membershipId: z.string().optional(), controllers: z.number().int().min(0).max(4).default(0) }),
  z.object({ op: z.literal("extend"), id: z.string(), minutes: z.number().int().min(1).max(1440) }),
  z.object({ op: z.literal("food"), id: z.string(), food: z.string(), qty: z.number().int().min(1).max(100) }),
  z.object({ op: z.literal("end"), id: z.string(), payment: z.enum(["UPI", "Cash", "Card", "Unpaid", "Split"]), cashAmount: z.number().min(0).max(1e7).optional(), upiAmount: z.number().min(0).max(1e7).optional() }),
  z.object({ op: z.literal("deleteStation"), id: z.string().min(1) }),
  z.object({ op: z.literal("station"), id: z.string().optional(), name: z.string().trim().min(1).max(60), type: z.string().min(1).max(30), rate: z.number().min(0).max(1e5), weekendRate: z.number().min(0).max(1e5).optional(), controllerRate: z.number().min(0).max(1e5).optional() }),
  z.object({ op: z.literal("menu"), id: z.string().optional(), category: z.string().max(50).optional(), name: z.string().trim().min(1).max(80), price: z.number().min(0).max(1e5) })
]);
function splitAmounts(op, total) {
  if (op.payment !== "Split") return { cashAmount: void 0, upiAmount: void 0 };
  const cash = Math.round((op.cashAmount ?? 0) * 100), upi = Math.round((op.upiAmount ?? 0) * 100);
  if (cash <= 0 || upi <= 0 || cash + upi !== Math.round(total * 100)) throw Error("Cash and UPI must both be positive and add up exactly to the bill total.");
  return { cashAmount: cash / 100, upiAmount: upi / 100 };
}
function applyOperation(s, body, actor, now = Date.now()) {
  const op = input.parse(body);
  s.memberships ??= [];
  s.completed ??= [];
  if (op.op === "customer") {
    s.customers ??= [];
    const phone = phoneKey(op.phone);
    const duplicate = s.customers.find((c) => c.phone === phone && c.id !== op.id);
    if (duplicate) throw Error("A customer with this phone number already exists.");
    const existing = op.id ? s.customers.find((c) => c.id === op.id) : void 0;
    if (op.id && !existing) throw Error("Customer not found. Refresh and try again.");
    if (existing) Object.assign(existing, { name: op.name, phone, notes: op.notes, updatedAt: now });
    else s.customers.unshift({ id: crypto.randomUUID(), name: op.name, phone, notes: op.notes, createdAt: now, updatedAt: now });
  }
  if (op.op === "editInvoice") reviseInvoice(s, op, now, actor);
  if (op.op === "shop") {
    const { op: _, ...details } = op;
    s.shop = details;
  }
  if (op.op === "taxConfig") {
    const { op: _, ...config } = op;
    s.taxConfig = config;
  }
  if (op.op === "expense") {
    s.expenses ??= [];
    s.expenses.unshift({ ...op, id: crypto.randomUUID(), amount: Math.round(op.amount * 100) / 100 });
  }
  if (op.op === "deleteExpense") {
    s.expenses = (s.expenses ?? []).filter((x) => x.id !== op.id);
  }
  if (op.op === "pause" || op.op === "resume") {
    const a = s.active.find((x) => x.id === op.id);
    if (!a) throw Error("Session is already closed.");
    if (op.op === "pause") {
      if (a.pausedAt !== void 0) throw Error("Session is already paused.");
      a.pausedAt = now;
      a.pauses ??= [];
      a.pauses.push({ start: now });
    } else {
      if (a.pausedAt === void 0) throw Error("Session is not paused.");
      if (a.planned) a.planned += now - a.pausedAt;
      const pause = a.pauses?.slice().reverse().find((p) => p.end === void 0);
      if (pause) pause.end = now;
      delete a.pausedAt;
    }
  }
  if (op.op === "membership") {
    const p = plans[op.planHours];
    if (op.remainingMinutes > p.hours * 60) throw Error("Remaining time exceeds the purchased hours.");
    if (op.expiryDate < op.purchasedDate) throw Error("Expiry cannot be before purchase.");
    if (op.purchasedDate > new Date(now).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })) throw Error("Purchase date cannot be in the future.");
    if (op.recordSale && op.remainingMinutes !== p.hours * 60) throw Error("New purchases must start with the full hour balance. Use existing membership to import a used plan.");
    const paymentAmounts = splitAmounts(op, p.price);
    const id = crypto.randomUUID();
    s.memberships.unshift({ id, name: op.name, phone: phoneKey(op.phone), planHours: op.planHours, purchasedDate: op.purchasedDate, expiryDate: op.expiryDate, expiresAt: expiryTime(op.expiryDate), totalMinutes: p.hours * 60, remainingMinutes: op.remainingMinutes, importedUsedMinutes: p.hours * 60 - op.remainingMinutes, price: p.price, payment: op.payment, ...paymentAmounts, recordSale: op.recordSale, createdAt: now });
    if (op.recordSale) s.invoices.unshift({ id: crypto.randomUUID(), station: "membership", stationName: "Membership purchase", name: op.name, phone: phoneKey(op.phone), start: now, end: now, planned: null, rate: 0, items: [], gaming: 0, total: p.price, payment: op.payment, ...paymentAmounts, kind: "membershipSale", shop: s.shop, salePlan: p.hours + "-hour PC membership", saleMembershipId: id });
  }
  if (op.op === "membershipPaid") {
    const m = s.memberships.find((m2) => m2.id === op.id);
    if (!m) throw Error("Membership not found.");
    if (m.payment !== "Unpaid") throw Error("Membership is already paid.");
    const paymentAmounts = splitAmounts(op, m.price);
    m.payment = op.payment;
    Object.assign(m, paymentAmounts);
    const invoice = s.invoices.find((x) => x.saleMembershipId === m.id);
    if (invoice) {
      invoice.payment = op.payment;
      Object.assign(invoice, paymentAmounts);
    }
  }
  if (op.op === "start") {
    const st = s.stations.find((x) => x.id === op.station);
    if (!st || s.active.some((x) => x.station === st.id)) throw Error("Station is unavailable.");
    const offer = op.offer ? offersFor(st, now).find((x) => x.id === op.offer) : void 0;
    if (op.offer && !offer) throw Error("This offer is not available for this station or time.");
    if (op.controllers && controllerRateFor(st) === void 0) throw Error("Controller rates are not listed for this station type.");
    const member = op.membershipId ? s.memberships.find((m) => m.id === op.membershipId) : void 0;
    if (op.membershipId) {
      if (!member) throw Error("Membership not found.");
      if (st.type !== "PC") throw Error("Hour memberships are for PC gaming only.");
      if (op.offer) throw Error("Choose membership or gaming offer, not both.");
      if (member.payment === "Unpaid") throw Error("Record membership payment before starting a member session.");
      if (now > member.expiresAt || member.remainingMinutes <= 0) throw Error("Membership is expired or has no hours left.");
      if (s.active.some((a) => a.membershipId && phoneKey(a.phone) === member.phone)) throw Error("This customer already has an active membership session.");
    }
    s.active.push({ id: crypto.randomUUID(), station: st.id, stationName: st.name, name: member?.name ?? op.name, phone: member?.phone ?? op.phone, start: now, planned: offer ? now + offer.minutes * 6e4 : op.minutes ? now + op.minutes * 6e4 : null, rate: rateFor(st, now), membershipId: member?.id, memberPlan: member ? member.planHours + "-hour PC membership" : void 0, memberMinutesAtStart: member?.remainingMinutes, memberExpiresAt: member?.expiresAt, controllerCount: offer?.controllers ?? op.controllers, controllerRate: controllerRateFor(st) ?? 0, offer: offer ? { name: offer.name, price: offer.price, minutes: offer.minutes, includes: offer.includes } : void 0, items: [] });
  }
  if (op.op === "extend" || op.op === "foods" || op.op === "food" || op.op === "end" || op.op === "stop") {
    const session = s.active.find((x) => x.id === op.id);
    if (!session) throw Error("Session is already closed.");
    if (op.op === "extend") session.planned = Math.max(session.pausedAt ?? now, session.planned ?? (session.pausedAt ?? now)) + op.minutes * 6e4;
    if (op.op === "foods") {
      const items = op.items.map((item) => {
        const f = s.menu.find((x) => x.id === item.food);
        if (!f) throw Error("A selected menu item is no longer available. Reopen the food menu.");
        return { name: f.name, price: f.price, qty: item.qty };
      });
      session.items.push(...items);
    }
    if (op.op === "food") {
      const f = s.menu.find((x) => x.id === op.food);
      if (!f) throw Error("Menu item not found.");
      session.items.push({ name: f.name, price: f.price, qty: op.qty });
    }
    if (op.op === "end" || op.op === "stop") {
      if (session.membershipId) {
        const m = s.memberships.find((x) => x.id === session.membershipId);
        if (!m) throw Error("Membership record is missing.");
        const used = coveredMinutes(session, now);
        if (used > m.remainingMinutes) throw Error("Membership balance changed. Refresh and retry.");
        m.remainingMinutes -= used;
        session.membershipMinutesUsed = used;
        session.memberBalanceAfter = m.remainingMinutes;
      }
      session.end = now;
      session.gaming = cost(session, now);
      applyTax(session, s.taxConfig);
      session.shop = s.shop;
      if (op.op === "end") {
        session.payment = op.payment;
        Object.assign(session, splitAmounts(op, session.total ?? 0));
        s.invoices.unshift(session);
      } else s.completed.unshift(session);
      s.active = s.active.filter((x) => x.id !== session.id);
    }
  }
  if (op.op === "combine") {
    const sessions = op.ids.map((id) => {
      const x = s.completed.find((x2) => x2.id === id);
      if (!x) throw Error("A selected session has already been billed or is unavailable. Refresh and select again.");
      return x;
    });
    const adjustment = Math.round(op.adjustment * 100) / 100;
    const total = (sessions.reduce((sum, x) => sum + Math.round((x.total ?? 0) * 100), 0) + Math.round(adjustment * 100)) / 100;
    if (total < 0) throw Error("Discount cannot exceed the selected total.");
    const amounts = splitAmounts(op, total);
    s.invoices.unshift({ id: crypto.randomUUID(), kind: "combined", sessions, adjustment, adjustmentReason: op.adjustmentReason, shop: s.shop, tax: sessions.some((x) => x.tax) ? { label: "Tax", gamingRate: 0, foodRate: 0, amount: sessions.reduce((n, x) => n + Math.round((x.tax?.amount ?? 0) * 100), 0) / 100 } : void 0, station: "combined", stationName: sessions.map((x) => x.stationName).join(", "), name: op.name, phone: op.phone, start: Math.min(...sessions.map((x) => x.start)), end: now, planned: null, rate: 0, items: sessions.flatMap((x) => x.items), gaming: sessions.reduce((sum, x) => sum + Math.round((x.gaming ?? 0) * 100), 0) / 100, total, payment: op.payment, ...amounts });
    s.completed = s.completed.filter((x) => !op.ids.includes(x.id));
  }
  if (op.op === "deleteStation") {
    if (!s.stations.some((x) => x.id === op.id)) throw Error("Station not found.");
    if (s.active.some((x) => x.station === op.id)) throw Error("End the active or paused session before deleting this station.");
    s.stations = s.stations.filter((x) => x.id !== op.id);
  }
  if (op.op === "station") {
    const st = s.stations.find((x) => x.id === op.id);
    if (st) Object.assign(st, { name: op.name, type: op.type, rate: op.rate, weekendRate: op.weekendRate ?? op.rate, controllerRate: op.controllerRate });
    else s.stations.push({ id: crypto.randomUUID(), name: op.name, type: op.type, rate: op.rate, weekendRate: op.weekendRate ?? op.rate, controllerRate: op.controllerRate });
  }
  if (op.op === "menu") {
    const f = s.menu.find((x) => x.id === op.id);
    if (op.id && !f) throw Error("Menu item not found.");
    if (f) Object.assign(f, { name: op.name, price: op.price, category: op.category });
    else s.menu.push({ id: crypto.randomUUID(), name: op.name, price: op.price, category: op.category });
  }
  if (["start", "membership", "end", "combine", "stop", "editInvoice"].includes(op.op)) {
    s.customers ??= [];
    const candidates = [...s.active ?? [], ...s.memberships ?? [], ...s.invoices ?? [], ...s.completed ?? []];
    for (const row of candidates) {
      const name = String(row.name ?? "").trim(), phone = phoneKey(String(row.phone ?? ""));
      if (name && /^\d{10,15}$/.test(phone) && !s.customers.some((c) => c.phone === phone)) s.customers.push({ id: crypto.randomUUID(), name, phone, notes: "", createdAt: now, updatedAt: now });
    }
  }
  return s;
}

// server/store.ts
var connection;
async function database() {
  if (!process.env.MONGODB_URI) throw Error("Database connection is not configured.");
  connection ??= new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 10, minPoolSize: 0, maxIdleTimeMS: 6e4, serverSelectionTimeoutMS: 8e3 }).connect().catch((e) => {
    connection = void 0;
    throw e;
  });
  const client = await connection;
  return { client, db: client.db("hungry_joystick") };
}
var arrays = ["stations", "menu", "active", "completed", "memberships", "invoices", "expenses", "customers"];
var clean = (x) => {
  const { _id, ...data } = x;
  return data;
};
async function syncCustomers(db, patch, session) {
  const rows = ["memberships", "invoices", "active", "completed"].flatMap((key) => patch[key]?.upsert ?? []);
  const byPhone = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const name = String(row?.name ?? "").trim();
    const phone = String(row?.phone ?? "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
    if (name && /^\d{10,15}$/.test(phone)) byPhone.set(phone, name);
  }
  for (const [phone, name] of byPhone) {
    await db.collection("customers").updateOne({ phone }, { $setOnInsert: { id: crypto.randomUUID(), name, phone, notes: "", createdAt: Date.now(), updatedAt: Date.now() } }, { upsert: true, session });
  }
}
var ready;
async function initialize() {
  return ready ??= (async () => {
    const { db, client } = await database();
    for (const key of arrays) await db.collection(key).createIndex({ id: 1 }, { unique: true });
    await db.collection("customers").createIndex({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: "string" } } });
    await db.collection("requests").createIndex({ "response.revision": 1 }, { unique: true });
    await db.collection("active").createIndex({ station: 1 }, { unique: true });
    await db.collection("invoices").createIndex({ end: -1, id: 1 });
    await db.collection("invoices").createIndex({ saleMembershipId: 1 });
    await db.collection("memberships").createIndex({ phone: 1, expiresAt: 1 });
    await db.collection("staff").createIndex({ username: 1 }, { unique: true });
    await db.collection("activityLog").createIndex({ at: -1 });
    await db.collection("authSessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await db.collection("authAttempts").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        if (await db.collection("settings").findOne({ _id: "cafe" }, { session })) return;
        const s = upgradePrices(initial());
        for (const key of arrays) {
          const rows = s[key] ?? [];
          if (rows.length) await db.collection(key).insertMany(rows, { session });
        }
        const metadata = { ...s };
        for (const key of arrays) delete metadata[key];
        await db.collection("settings").insertOne({ _id: "cafe", revision: 0, data: metadata }, { session });
      });
    } finally {
      await session.endSession();
    }
    const settings = await db.collection("settings").findOne({ _id: "cafe" }, { projection: { customerDirectoryVersion: 1 } });
    if ((settings?.customerDirectoryVersion ?? 0) < 2) {
      const rows = [];
      for (const name of ["memberships", "invoices", "active", "completed"]) rows.push(...await db.collection(name).find({ phone: { $exists: true } }, { projection: { name: 1, phone: 1 } }).toArray());
      const patch = { active: { upsert: rows, remove: [] } };
      const backfillSession = client.startSession();
      try {
        await backfillSession.withTransaction(async () => {
          await syncCustomers(db, patch, backfillSession);
          await db.collection("settings").updateOne({ _id: "cafe" }, { $set: { customerDirectoryVersion: 2 } }, { session: backfillSession });
        });
      } finally {
        await backfillSession.endSession();
      }
    }
  })().catch((e) => {
    ready = void 0;
    throw e;
  });
}
async function readState(session, body) {
  const { db } = await database();
  const metadata = await db.collection("settings").findOne({ _id: "cafe" }, { session });
  if (!metadata) throw Error("Database is not initialized");
  const state = { ...metadata.data };
  for (const key of arrays) {
    let filter = {};
    if (body && key === "invoices") filter = body.op === "editInvoice" ? { id: body.id } : body.op === "membershipPaid" ? { saleMembershipId: body.id } : { id: { $in: [] } };
    if (body && key === "expenses") filter = body.op === "deleteExpense" ? { id: body.id } : { id: { $in: [] } };
    state[key] = (await db.collection(key).find(filter, { session }).sort(key === "invoices" ? { end: -1 } : key === "memberships" ? { createdAt: -1 } : { _id: 1 }).toArray()).map(clean);
  }
  return { state, revision: metadata.revision };
}
function diff(before, after) {
  const patch = {};
  for (const key of arrays) {
    const old = new Map((before[key] ?? []).map((x) => [x.id, JSON.stringify(x)]));
    const values = after[key] ?? [];
    const ids = new Set(values.map((x) => x.id));
    const upsert = values.filter((x) => old.get(x.id) !== JSON.stringify(x));
    const remove = [...old.keys()].filter((x) => !ids.has(x));
    if (upsert.length || remove.length) patch[key] = { upsert, remove };
  }
  const settings = (s) => {
    const data = { ...s };
    for (const key of arrays) delete data[key];
    return data;
  };
  if (JSON.stringify(settings(before)) !== JSON.stringify(settings(after))) patch.settings = { upsert: [settings(after)], remove: [] };
  return patch;
}
async function snapshot(known) {
  await initialize();
  const { client, db } = await database();
  if (known !== void 0) {
    const m = await db.collection("settings").findOne({ _id: "cafe" }, { projection: { revision: 1 } });
    if (m?.revision === known) return null;
    if (m && known >= 0 && m.revision - known <= 100) {
      const changes = await db.collection("requests").find({ "response.revision": { $gt: known, $lte: m.revision } }).sort({ "response.revision": 1 }).limit(100).toArray();
      if (changes.length === m.revision - known) {
        const merged = {};
        for (const row of changes) {
          for (const [key, value] of Object.entries(row.response.patch)) {
            const current = merged[key] ??= { upsert: [], remove: [] };
            if (key === "settings") {
              merged[key] = value;
              continue;
            }
            const touched = /* @__PURE__ */ new Set([...value.remove, ...value.upsert.map((x) => x.id)]);
            current.upsert = current.upsert.filter((x) => !touched.has(x.id)).concat(value.upsert);
            current.remove = [.../* @__PURE__ */ new Set([...current.remove, ...value.remove])].filter((id) => !value.upsert.some((x) => x.id === id));
          }
        }
        return { patch: merged, revision: m.revision };
      }
    }
  }
  const session = client.startSession();
  try {
    return await session.withTransaction(() => readState(session), { readConcern: { level: "snapshot" } });
  } finally {
    await session.endSession();
  }
}
async function mutate(body, actor, key) {
  await initialize();
  const op = input.parse(body);
  const { client, db } = await database();
  const session = client.startSession();
  try {
    return await session.withTransaction(async () => {
      const receipt = await db.collection("requests").findOne({ _id: key }, { session });
      if (receipt) return receipt.response;
      const { state, revision } = await readState(session, op);
      if (body.revision !== revision) throw Object.assign(Error("Another device saved a change. Refresh and retry."), { status: 409 });
      const before = structuredClone(state);
      applyOperation(state, op, actor);
      const patch = diff(before, state);
      for (const name of arrays) {
        const change = patch[name];
        if (!change) continue;
        for (const row of change.upsert) await db.collection(name).replaceOne({ id: row.id }, row, { upsert: true, session });
        if (change.remove.length) await db.collection(name).deleteMany({ id: { $in: change.remove } }, { session });
      }
      const result = await db.collection("settings").updateOne({ _id: "cafe", revision }, { $inc: { revision: 1 }, ...patch.settings ? { $set: { data: patch.settings.upsert[0] } } : {} }, { session });
      if (result.modifiedCount !== 1) throw Object.assign(Error("Concurrent update. Refresh and retry."), { status: 409 });
      const response = { patch, revision: revision + 1, invoice: patch.invoices?.upsert[0] };
      await db.collection("requests").insertOne({ _id: key, response, createdAt: /* @__PURE__ */ new Date() }, { session });
      await db.collection("activityLog").insertOne({ at: /* @__PURE__ */ new Date(), actor, action: op.op, recordId: typeof op.id === "string" ? op.id : void 0 }, { session });
      return response;
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
  } finally {
    await session.endSession();
  }
}
async function importBackup(payload) {
  if (!payload?.state || !Number.isInteger(payload.revision) || payload.revision < 0) throw Error("Choose a complete Hungry Joystick JSON backup.");
  const source = payload.state;
  for (const key of arrays) {
    if (!Array.isArray(source[key] ?? [])) throw Error("Invalid backup collection: " + key);
    const rows = source[key] ?? [];
    if (rows.some((x) => !x || typeof x.id !== "string" || x.id.length > 200) || new Set(rows.map((x) => x.id)).size !== rows.length) throw Error("Invalid or duplicate record IDs: " + key);
  }
  for (const key of ["active", "completed", "invoices"]) for (const row of source[key] ?? []) {
    if (!Number.isFinite(row.start) || !Array.isArray(row.items)) throw Error("Invalid session in backup");
  }
  await initialize();
  const { db, client } = await database();
  const session = client.startSession();
  try {
    return await session.withTransaction(async () => {
      const current = await db.collection("settings").findOne({ _id: "cafe" }, { session });
      if (current?.revision !== 0 || current?.migratedAt) throw Error("This database already contains business data. Import refused.");
      for (const key of arrays) {
        await db.collection(key).deleteMany({}, { session });
        const rows = source[key] ?? [];
        if (rows.length) await db.collection(key).insertMany(rows.map((row) => {
          const { _id, ...data2 } = row;
          return data2;
        }), { session });
      }
      await syncCustomers(db, { active: { upsert: ["memberships", "invoices", "active", "completed"].flatMap((key) => source[key] ?? []), remove: [] } }, session);
      const data = { ...source };
      for (const key of arrays) delete data[key];
      const counts = Object.fromEntries(arrays.map((key) => [key, (source[key] ?? []).length]));
      await db.collection("settings").updateOne({ _id: "cafe" }, { $set: { data, revision: payload.revision, migratedAt: /* @__PURE__ */ new Date(), migrationCounts: counts } }, { session });
      return { counts };
    });
  } finally {
    await session.endSession();
  }
}

// server/auth.ts
var scrypt = promisify(scryptCallback);
var digest = (s) => createHash("sha256").update(s).digest("hex");
var forbidden = (message, status = 403) => Object.assign(Error(message), { status });
function token(req) {
  return req.headers.cookie?.split(";").map((x) => x.trim()).find((x) => x.startsWith("hj_session="))?.slice(11) ?? "";
}
async function owner(req) {
  const raw = token(req);
  if (!raw) return null;
  const { db } = await database();
  const session = await db.collection("authSessions").findOne({ _id: digest(raw), expiresAt: { $gt: /* @__PURE__ */ new Date() } });
  if (!session) return null;
  if (!session.staffId) return { name: "Owner", email: process.env.OWNER_EMAIL ?? "hungryjoystick.blr@gmail.com", role: "owner" };
  const staff = await db.collection("staff").findOne({ id: session.staffId, enabled: true });
  return staff ? { name: staff.name, email: "", username: staff.username, id: staff.id, role: "staff" } : null;
}
async function verify(password, salt, stored) {
  if (!/^[0-9a-f]{128}$/i.test(stored) || !/^[0-9a-f]{32}$/i.test(salt)) return false;
  const hash = await scrypt(password, salt, 64);
  return timingSafeEqual(hash, Buffer.from(stored, "hex"));
}
async function passwordFields(password) {
  if (password.length < 12 || password.length > 200) throw forbidden("Password must contain 12\u2013200 characters.", 400);
  const salt = randomBytes(16).toString("hex");
  return { salt, hash: (await scrypt(password, salt, 64)).toString("hex") };
}
async function signIn(req, res, setup = false) {
  await initialize();
  const { db } = await database();
  const email = String(req.body.email ?? "").toLowerCase().trim(), username2 = String(req.body.username ?? "").toLowerCase().trim(), password = String(req.body.password ?? "");
  const expected = process.env.OWNER_EMAIL ?? "hungryjoystick.blr@gmail.com";
  const bucket = digest((username2 || email) + ":" + Math.floor(Date.now() / 9e5));
  const attempt = await db.collection("authAttempts").findOneAndUpdate({ _id: bucket }, { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(Date.now() + 9e5) } }, { upsert: true, returnDocument: "after" });
  if ((attempt?.count ?? 0) > 15) throw forbidden("Too many attempts. Try again in 15 minutes.", 429);
  let account = await db.collection("owner").findOne({ _id: "owner" });
  if (setup) {
    const provided = digest(String(req.body.setupCode ?? "")), wanted = digest(process.env.ADMIN_SETUP_TOKEN ?? "");
    if (!process.env.ADMIN_SETUP_TOKEN || !timingSafeEqual(Buffer.from(provided), Buffer.from(wanted)) || account) throw forbidden("Setup code is invalid or already used.", 400);
    if (email !== expected) throw forbidden("Use your configured owner email.", 400);
    const fields = await passwordFields(password);
    await db.collection("owner").insertOne({ _id: "owner", email, ...fields });
    account = { email, ...fields };
  }
  let staffId;
  if (!setup && username2) {
    const staff = await db.collection("staff").findOne({ username: username2, enabled: true });
    if (!staff || password.length > 200 || !await verify(password, staff.salt, staff.hash)) throw forbidden("Username or password is incorrect.", 401);
    staffId = staff.id;
  } else {
    if (!account || email !== expected || password.length > 200 || !await verify(password, account.salt, account.hash)) throw forbidden("Email or password is incorrect.", 401);
  }
  const raw = randomBytes(32).toString("hex");
  await db.collection("authSessions").insertOne({ _id: digest(raw), staffId: staffId ?? null, expiresAt: new Date(Date.now() + 12 * 36e5) });
  await db.collection("activityLog").insertOne({ at: /* @__PURE__ */ new Date(), actor: staffId ? "staff:" + username2 : "owner", action: "login", recordId: staffId ?? "owner" });
  res.cookie("hj_session", raw, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 12 * 36e5 });
  res.json({ ok: true });
}
async function signOut(req, res) {
  const { db } = await database();
  const raw = token(req);
  if (raw) {
    const session = await db.collection("authSessions").findOneAndDelete({ _id: digest(raw) });
    if (session) {
      let actor = "owner";
      if (session.staffId) {
        const staff = await db.collection("staff").findOne({ id: session.staffId }, { projection: { username: 1 } });
        actor = "staff:" + (staff?.username ?? session.staffId);
      }
      await db.collection("activityLog").insertOne({ at: /* @__PURE__ */ new Date(), actor, action: "logout", recordId: session.staffId ?? "owner" });
    }
  }
  res.clearCookie("hj_session", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/" });
  res.redirect("/login");
}

// server/system-health.ts
import { createHash as createHash2, timingSafeEqual as timingSafeEqual2 } from "node:crypto";
import { z as z2 } from "zod";
var schema = z2.object({
  date: z2.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  backupTaskOk: z2.boolean(),
  backupRanAt: z2.string().datetime({ offset: true }).nullable(),
  backupFile: z2.string().regex(/^HungryJoystick-\d{8}-\d{6}\.archive\.gz\.age$/).nullable(),
  backupSizeBytes: z2.number().int().nonnegative().nullable(),
  alertTaskOk: z2.boolean(),
  alertRanAt: z2.string().datetime({ offset: true }).nullable(),
  issues: z2.array(z2.string().max(200)).max(12)
}).strict();
function equalSecret(provided, expected) {
  if (!expected || !provided) return false;
  const a = createHash2("sha256").update(provided).digest();
  const b = createHash2("sha256").update(expected).digest();
  return timingSafeEqual2(a, b);
}
function indiaDate(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
function registerSystemHealth(app2) {
  app2.post("/api/system-health/report", async (req, res) => {
    const expected = process.env.HJ_BACKUP_STATUS_TOKEN || "";
    const provided = (req.get("authorization") || "").match(/^Bearer ([^\s]+)$/)?.[1] || "";
    if (!expected) return res.status(503).json({ error: "Backup reporting not configured." });
    if (!equalSecret(provided, expected)) return res.status(401).json({ error: "Unauthorized." });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid status report." });
    const row = parsed.data;
    const today = indiaDate(/* @__PURE__ */ new Date());
    if (row.date !== today) return res.status(400).json({ error: "Report date must be today (India time)." });
    const { db } = await database();
    await db.collection("backupHealthReports").updateOne({ _id: row.date }, { $set: { ...row, receivedAt: /* @__PURE__ */ new Date() } }, { upsert: true });
    res.json({ ok: true });
  });
  app2.get("/api/system-health", async (req, res) => {
    const user = await owner(req);
    if (!user) return res.status(401).json({ error: "Please sign in." });
    if (user.role !== "owner") return res.status(403).json({ error: "Owner access required." });
    const { db } = await database();
    await db.command({ ping: 1 });
    const rows = await db.collection("backupHealthReports").find({}).sort({ receivedAt: -1 }).limit(14).toArray();
    const reports = rows.map((r) => ({ date: r.date, backupTaskOk: r.backupTaskOk, backupRanAt: r.backupRanAt, backupFile: r.backupFile, backupSizeBytes: r.backupSizeBytes, alertTaskOk: r.alertTaskOk, alertRanAt: r.alertRanAt, issues: r.issues, receivedAt: r.receivedAt }));
    const latest = reports[0] ?? null;
    const ageMs = latest ? Date.now() - new Date(latest.receivedAt).getTime() : null;
    res.json({ database: { connected: true, checkedAt: (/* @__PURE__ */ new Date()).toISOString() }, reportingConfigured: !!process.env.HJ_BACKUP_STATUS_TOKEN, latest, history: reports, stale: !latest || ageMs === null || ageMs > 26 * 36e5, schedule: { backup: "23:30 IST", alert: "23:45 IST", report: "23:50 IST" }, cloudSyncVerified: false });
  });
}

// server/app.ts
var app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "10mb" }));
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "same-origin");
  if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
    if (req.method === "POST" && req.path === "/api/system-health/report") {
      if (!req.is("application/json")) {
        res.status(415).json({ error: "JSON required." });
        return;
      }
      next();
      return;
    }
    const origin = req.get("origin");
    if (!origin) {
      res.status(403).json({ error: "Request origin is required." });
      return;
    }
    try {
      const parsedOrigin = new URL(origin);
      const configuredFrontend = process.env.FRONTEND_ORIGIN?.trim();
      const sameHost = parsedOrigin.host === req.get("host");
      const trustedFrontend = configuredFrontend !== void 0 && parsedOrigin.origin === configuredFrontend && parsedOrigin.protocol === "https:";
      if (!sameHost && !trustedFrontend) {
        res.status(403).json({ error: "Request origin is not allowed." });
        return;
      }
    } catch {
      res.status(403).json({ error: "Invalid request origin." });
      return;
    }
    if (!req.is("application/json")) {
      res.status(415).json({ error: "JSON required." });
      return;
    }
  }
  next();
});
app.get("/api/health", (_req, res) => res.json({ ok: true, stack: "MERN" }));
app.get("/api/auth/me", async (req, res) => {
  const user = await owner(req);
  res.status(user ? 200 : 401).json({ owner: user });
});
app.post("/api/auth/login", (req, res) => signIn(req, res));
app.post("/api/auth/staff-login", (req, res) => signIn(req, res));
app.post("/api/auth/setup", (req, res) => signIn(req, res, true));
app.get("/api/auth/logout", signOut);
registerSystemHealth(app);
app.use("/api/manage", async (req, res, next) => {
  const user = await owner(req);
  if (!user) {
    res.status(401).json({ error: "Please sign in." });
    return;
  }
  res.locals.user = user;
  next();
});
app.get("/api/migration/status", async (req, res) => {
  if ((await owner(req))?.role !== "owner") {
    res.status(403).json({ error: "Owner access required." });
    return;
  }
  const { db } = await database();
  const record = await db.collection("settings").findOne({ _id: "cafe" });
  res.json({ ready: !!record?.migratedAt, counts: record?.migrationCounts });
});
app.post("/api/migration/import", async (req, res) => {
  if ((await owner(req))?.role !== "owner") {
    res.status(403).json({ error: "Owner access required." });
    return;
  }
  res.json(await importBackup(req.body));
});
app.get("/api/manage", async (req, res) => {
  const known = req.query.revision === void 0 ? void 0 : Number(req.query.revision);
  const data = await snapshot(known);
  if (!data) {
    res.status(204).end();
    return;
  }
  if (res.locals.user.role === "staff") {
    const value = data;
    if (value.state) delete value.state.expenses;
    if (value.patch) delete value.patch.expenses;
  }
  res.json(data);
});
var staffOperations = /* @__PURE__ */ new Set(["customer", "start", "pause", "resume", "stop", "extend", "food", "foods", "end", "combine", "membership", "membershipPaid"]);
app.post("/api/manage", async (req, res) => {
  const user = res.locals.user;
  if (user.role === "staff" && !staffOperations.has(String(req.body?.op))) {
    res.status(403).json({ error: "Only the owner can perform this action." });
    return;
  }
  const { db } = await database();
  const settings = await db.collection("settings").findOne({ _id: "cafe" });
  if (!settings?.migratedAt) {
    res.status(503).json({ error: "Import your complete caf\xE9 backup from Owner profile before starting operations." });
    return;
  }
  const key = z3.string().uuid().parse(req.get("Idempotency-Key"));
  const revision = z3.number().int().nonnegative().parse(req.body.revision);
  res.json(await mutate({ ...req.body, revision }, user.role === "staff" ? "staff:" + user.username : user.email, key));
});
app.use("/api/staff", async (req, res, next) => {
  const user = await owner(req);
  if (!user) {
    res.status(401).json({ error: "Please sign in." });
    return;
  }
  if (user.role !== "owner") {
    res.status(403).json({ error: "Owner access required." });
    return;
  }
  next();
});
var username = z3.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_.-]{2,31}$/);
var createStaff = z3.object({ name: z3.string().trim().min(1).max(100), username, password: z3.string().min(12).max(200), enabled: z3.boolean().optional() }).strict();
var updateStaff = z3.object({ name: z3.string().trim().min(1).max(100).optional(), username: username.optional(), password: z3.string().min(12).max(200).optional(), enabled: z3.boolean().optional() }).strict().refine((v) => Object.keys(v).length > 0);
app.get("/api/staff", async (_req, res) => {
  const { db } = await database();
  await initialize();
  const staff = await db.collection("staff").find({}, { projection: { _id: 0, id: 1, name: 1, username: 1, enabled: 1, createdAt: 1 } }).sort({ createdAt: -1 }).toArray();
  res.json({ staff });
});
app.get("/api/staff/activity", async (_req, res) => {
  const { db } = await database();
  const activity = await db.collection("activityLog").find({}).sort({ at: -1 }).limit(200).project({ _id: 0 }).toArray();
  res.json({ activity });
});
app.post("/api/staff", async (req, res) => {
  const values = createStaff.parse(req.body);
  await initialize();
  const { db } = await database();
  const fields = await passwordFields(values.password);
  const row = { id: randomUUID(), name: values.name, username: values.username, enabled: values.enabled ?? true, ...fields, createdAt: /* @__PURE__ */ new Date() };
  try {
    await db.collection("staff").insertOne(row);
  } catch (e) {
    if (e?.code === 11e3) {
      res.status(409).json({ error: "Username already exists." });
      return;
    }
    throw e;
  }
  await db.collection("activityLog").insertOne({ at: /* @__PURE__ */ new Date(), actor: "owner", action: "staffCreated", recordId: row.id });
  res.status(201).json({ ok: true });
});
app.patch("/api/staff/:id", async (req, res) => {
  const values = updateStaff.parse(req.body);
  const { db } = await database();
  const changes = { ...values };
  if (values.password) {
    Object.assign(changes, await passwordFields(values.password));
    delete changes.password;
  }
  const result = await db.collection("staff").updateOne({ id: req.params.id }, { $set: changes });
  if (!result.matchedCount) {
    res.status(404).json({ error: "Staff account not found." });
    return;
  }
  if (values.enabled === false || values.password) await db.collection("authSessions").deleteMany({ staffId: req.params.id });
  await db.collection("activityLog").insertOne({ at: /* @__PURE__ */ new Date(), actor: "owner", action: values.password ? "staffPasswordReset" : "staffUpdated", recordId: req.params.id });
  res.json({ ok: true });
});
app.use((error, _req, res, _next) => {
  const status = error.status ?? (error instanceof z3.ZodError ? 400 : 500);
  res.status(status).json({ error: error instanceof z3.ZodError ? "Check the entered details." : status === 500 ? "Server error. Check backend logs." : error.message ?? "Request failed." });
});
var app_default = app;
export {
  app_default as default
};
