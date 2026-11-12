'use strict';
/* =========================================================
   Sales Invoice – mobile-first, offline-first (IndexedDB)
   ========================================================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9));
const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(n) ? n : 0; };
const rnd = (v, d = 2) => { const f = Math.pow(10, d); return Math.round(v * f + Math.sign(v) * 1e-7) / f; };
const fmt = (v, d = 2) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const dmy = iso => (iso ? iso.split('-').reverse().join('-') : '');
const app = $('#app');

/* ---------- IndexedDB ---------- */
const DB = (() => {
  let db;
  const stores = ['companies', 'parties', 'products', 'invoices', 'pdfs', 'kv'];
  const wrap = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const st = (s, m = 'readonly') => db.transaction(s, m).objectStore(s);
  return {
    open() {
      return new Promise((res, rej) => {
        const r = indexedDB.open('salesinvoice', 1);
        r.onupgradeneeded = () => {
          const d = r.result;
          stores.forEach(s => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: s === 'kv' ? 'k' : 'id' }); });
        };
        r.onsuccess = () => { db = r.result; res(); };
        r.onerror = () => rej(r.error);
      });
    },
    all: s => wrap(st(s).getAll()),
    get: (s, id) => wrap(st(s).get(id)),
    put: (s, o) => wrap(st(s, 'readwrite').put(o)),
    del: (s, id) => wrap(st(s, 'readwrite').delete(id)),
    clear: s => wrap(st(s, 'readwrite').clear())
  };
})();

/* ---------- Settings ---------- */
const DEFAULTS = {
  prefix: 'INV-', pad: 4, startNo: 1,
  dQty: 2, dRate: 2, dAmt: 2,
  gstApplicable: true, gstRate: 18, invStyle: 'classic',
  payTerms: '', terms: '',
  units: ['PCS', 'KG', 'QUINTAL', 'TON', 'METER', 'LITRE', 'BOX', 'NOS', 'DOZEN']

};
let S = { ...DEFAULTS };
const saveSettings = () => DB.put('kv', { k: 'settings', v: S });

/* ---------- Static data ---------- */
const STATES = [['01', 'Jammu & Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'], ['04', 'Chandigarh'], ['05', 'Uttarakhand'], ['06', 'Haryana'], ['07', 'Delhi'], ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'], ['10', 'Bihar'], ['11', 'Sikkim'], ['12', 'Arunachal Pradesh'], ['13', 'Nagaland'], ['14', 'Manipur'], ['15', 'Mizoram'], ['16', 'Tripura'], ['17', 'Meghalaya'], ['18', 'Assam'], ['19', 'West Bengal'], ['20', 'Jharkhand'], ['21', 'Odisha'], ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'], ['24', 'Gujarat'], ['26', 'Dadra & Nagar Haveli and Daman & Diu'], ['27', 'Maharashtra'], ['29', 'Karnataka'], ['30', 'Goa'], ['31', 'Lakshadweep'], ['32', 'Kerala'], ['33', 'Tamil Nadu'], ['34', 'Puducherry'], ['35', 'Andaman & Nicobar Islands'], ['36', 'Telangana'], ['37', 'Andhra Pradesh'], ['38', 'Ladakh']];
const stateFromGstin = g => { const m = /^(\d{2})/.exec((g || '').trim()); const s = m && STATES.find(x => x[0] === m[1]); return s ? s[1] : ''; };
const GST_RATES = [0, 5, 12, 18, 28];
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;

/* ---------- UI helpers ---------- */
let toastT;
function toast(msg, ms = 2600) {
  $('.toast')?.remove();
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t); clearTimeout(toastT); toastT = setTimeout(() => t.remove(), ms);
}
function openSheet(title, html, footer = '') {
  const el = document.createElement('div'); el.className = 'sheet';
  el.innerHTML = `<div class="sheet-card" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">×</button></div><div class="sheet-body">${html}</div><div class="sheet-foot">${footer}</div></div>`;
  document.body.appendChild(el);
  el.close = () => el.remove();
  el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-close]')) el.close(); });
  return el;
}
const opts = (list, sel, ph) => (ph !== undefined ? `<option value="">${esc(ph)}</option>` : '') + list.map(x => { const [v, l] = Array.isArray(x) ? x : [x, x]; return `<option value="${esc(v)}"${String(v) === String(sel) ? ' selected' : ''}>${esc(l)}</option>`; }).join('');
const stateOpts = sel => opts(STATES.map(s => s[1]), sel, 'Select state');
function setPath(o, path, val) { const p = path.split('.'); let t = o; while (p.length > 1) { const k = p.shift(); t = t[k] = t[k] || {}; } t[p[0]] = val; }
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
const safe = s => String(s || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-');
const fileName = inv => `${safe(inv.company?.name)}_${safe(inv.number)}_${inv.date}.pdf`;

/* ---------- Amount in words (Indian) ---------- */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = n => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''));
const three = n => (n >= 100 ? ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' : '') : '') + (n % 100 ? two(n % 100) : '');
function intWords(n) {
  if (n === 0) return 'Zero';
  const out = [];
  const cr = Math.floor(n / 1e7); n %= 1e7;
  const lk = Math.floor(n / 1e5); n %= 1e5;
  const th = Math.floor(n / 1e3); n %= 1e3;
  if (cr) out.push(intWords(cr) + ' Crore');
  if (lk) out.push(two(lk) + ' Lakh');
  if (th) out.push(two(th) + ' Thousand');
  if (n) out.push(three(n));
  return out.join(' ');
}
function rupeesInWords(v) {
  v = Math.abs(rnd(v, 2));
  const r = Math.floor(v), p = Math.round((v - r) * 100);
  let s = 'Indian Rupees ' + intWords(r);
  if (p) s += ' and ' + two(p) + ' Paise';
  return s + ' Only';
}

/* ---------- Invoice maths ---------- */
const compState = c => (c && (c.state || stateFromGstin(c.gstin))) || '';
function calcInvoice(inv) {
  const gstOn = !!inv.gstApplicable;
  const items = (inv.items || []).map(it => {
    const qd = it.qd ?? S.dQty, rd = it.rd ?? S.dRate, ad = it.ad ?? S.dAmt;
    const q = rnd(num(it.qty), qd), r = rnd(num(it.rate), rd);
    return { q, r, amount: rnd(q * r, ad), gst: num(it.gst) };
  });
  const subtotal = rnd(items.reduce((s, x) => s + x.amount, 0), 2);
  const discount = Math.min(Math.max(num(inv.discount), 0), subtotal);
  const taxable = rnd(subtotal - discount, 2);
  const cs = compState(inv.company), ps = inv.billTo?.state || '';
  let treatment = inv.gstMode || 'auto', auto = false;
  if (treatment === 'auto') { auto = true; treatment = cs && ps && cs === ps ? 'intra' : 'inter'; }
  let tax = 0;
  if (gstOn) items.forEach(x => { const share = subtotal > 0 ? x.amount / subtotal : 0; tax += (x.amount - discount * share) * x.gst / 100; });
  tax = rnd(tax, 2);
  let cgst = 0, sgst = 0, igst = 0;
  if (gstOn) { if (treatment === 'intra') { cgst = rnd(tax / 2, 2); sgst = rnd(tax - cgst, 2); } else igst = tax; }
  const other = num(inv.other);
  const raw = rnd(taxable + tax + other, 2);
  let grand, roundOff = 0;
  if (inv.roundOff !== false) { grand = Math.round(raw); roundOff = rnd(grand - raw, 2); } else grand = raw;
  return { items, subtotal, discount, taxable, cgst, sgst, igst, tax, other, roundOff, grand, treatment, auto, stateKnown: !!(cs && ps) };
}

/* ---------- Invoice numbering (per company) ---------- */
const fmtNo = (c, n) => ((c.prefix || S.prefix) || '') + String(n).padStart(c.pad || S.pad, '0');
async function usedNumbers(companyId, exceptId) {
  return (await DB.all('invoices')).filter(i => i.companyId === companyId && i.id !== exceptId).map(i => String(i.number).trim().toLowerCase());
}
async function nextAutoNumber(c, exceptId) {
  const used = new Set(await usedNumbers(c.id, exceptId));
  let n = c.nextNo || S.startNo;
  while (used.has(fmtNo(c, n).toLowerCase())) n++;
  return { n, text: fmtNo(c, n) };
}

/* =========================================================
   PDF (jsPDF + autoTable) – A4, multi-page
   ========================================================= */
const STYLES = {
  classic: { name: 'Classic', desc: 'Blue headings with a full grid. Clean, standard A4 bill.', font: 'helvetica', ink: [29, 53, 87], tint: [238, 241, 246], line: [130, 140, 155], head: 'fill', theme: 'grid' },
  tally: { name: 'Tally Style', desc: 'Black and white, boxed page, centred company name, like Tally prints.', font: 'helvetica', ink: [0, 0, 0], tint: [255, 255, 255], line: [0, 0, 0], head: 'plain', theme: 'tally', center: true, border: 'single', declaration: true },
  modern: { name: 'Modern', desc: 'Coloured header band with soft striped rows.', font: 'helvetica', ink: [15, 98, 92], tint: [232, 244, 242], line: [200, 215, 213], head: 'fill', theme: 'striped', band: true },
  minimal: { name: 'Minimal', desc: 'Light lines, lots of white space, grey text.', font: 'helvetica', ink: [70, 70, 70], tint: [244, 244, 244], line: [200, 200, 200], head: 'plain', theme: 'light', titleRight: true },
  traditional: { name: 'Traditional', desc: 'Serif font, double border, centred header. Old bill-book look.', font: 'times', ink: [96, 24, 24], tint: [250, 242, 236], line: [96, 24, 24], head: 'fill', theme: 'grid', center: true, border: 'double', declaration: true }
};
function buildPdf(inv) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const cfg = STYLES[inv.style] || STYLES.classic;
  const t = calcInvoice(inv), c = inv.company || {}, W = 210, M = 10;
  const INK = cfg.ink, TINT = cfg.tint, LINE = cfg.line, F = cfg.font;
  const gstOn = !!inv.gstApplicable, fill = cfg.head === 'fill';
  const bw = cfg.theme === 'tally' ? 0.3 : cfg.theme === 'light' ? 0.1 : 0.2;
  const base = { font: F, fontSize: 8.8, cellPadding: 2, lineColor: LINE, lineWidth: cfg.theme === 'striped' ? 0 : bw, textColor: 20, overflow: 'linebreak' };
  const headSt = fill ? { fillColor: INK, textColor: 255, fontStyle: 'bold' } : { fillColor: [255, 255, 255], textColor: 20, fontStyle: 'bold' };
  const infoHead = fill ? { fillColor: TINT, textColor: 20, fontStyle: 'bold' } : headSt;
  const lbl = s => ({ content: s, styles: { fontStyle: 'bold', fillColor: fill ? TINT : [255, 255, 255] } });

  // ---- header ----
  let logo = null;
  if (c.logo) { try { const p = doc.getImageProperties(c.logo); let w = p.width, h = p.height; const r = Math.min(32 / w, 22 / h); logo = { d: c.logo, t: p.fileType, w: w * r, h: h * r }; } catch (e) { /* ignore */ } }
  const lw = logo ? logo.w + 5 : 0;
  const textX = cfg.center ? W / 2 : M + lw;
  const textW = cfg.center ? W - 2 * (M + lw) : W - M - (M + lw) - (cfg.titleRight ? 55 : 0);
  const align = cfg.center ? 'center' : 'left';
  doc.setFont(F, 'bold').setFontSize(15);
  const nameLines = doc.splitTextToSize(c.name || '', textW);
  doc.setFont(F, 'normal').setFontSize(9);
  const info = [];
  if (c.address) info.push(c.address);
  const st = compState(c); if (st) info.push('State: ' + st);
  const ids = [c.gstin && 'GSTIN: ' + c.gstin, c.pan && 'PAN: ' + c.pan].filter(Boolean).join('    '); if (ids) info.push(ids);
  const ct = [c.mobile && 'Mobile: ' + c.mobile, c.email && 'Email: ' + c.email].filter(Boolean).join('    '); if (ct) info.push(ct);
  const infoLines = info.flatMap(l => doc.splitTextToSize(l, textW));
  const top = cfg.band ? 8 : M;
  const textH = nameLines.length * 6 + infoLines.length * 4.1;
  let y;
  if (cfg.band) {
    y = top + Math.max(textH, logo ? logo.h : 0) + 6;
    doc.setFillColor(...INK).rect(0, 0, W, y, 'F');
  }
  if (logo) {
    if (cfg.band) doc.setFillColor(255, 255, 255).roundedRect(M - 1, top - 1, logo.w + 2, logo.h + 2, 1, 1, 'F');
    try { doc.addImage(logo.d, logo.t, M, top, logo.w, logo.h); } catch (e) { /* ignore */ }
  }
  doc.setFont(F, 'bold').setFontSize(15).setTextColor(...(cfg.band ? [255, 255, 255] : [20, 20, 20]));
  let ty = top + 5.5;
  nameLines.forEach(l => { doc.text(l, textX, ty, { align }); ty += 6; });
  doc.setFont(F, 'normal').setFontSize(9).setTextColor(...(cfg.band ? [230, 244, 242] : [50, 50, 50]));
  infoLines.forEach(l => { doc.text(l, textX, ty, { align }); ty += 4.1; });
  if (!cfg.band) {
    y = Math.max(ty, top + (logo ? logo.h : 0)) + 1.5;
    doc.setDrawColor(...(cfg.titleRight ? [190, 190, 190] : INK)).setLineWidth(cfg.theme === 'tally' ? 0.3 : cfg.titleRight ? 0.2 : 0.5).line(M, y, W - M, y);
  }
  const title = gstOn && c.gstin ? 'TAX INVOICE' : 'INVOICE';
  if (cfg.titleRight) {
    doc.setFont(F, 'bold').setFontSize(17).setTextColor(150, 150, 150); doc.text(title, W - M, top + 7, { align: 'right' }); y += 3;
  } else {
    y += 6.5;
    doc.setFont(F, 'bold').setFontSize(12).setTextColor(...(cfg.band || fill ? INK : [0, 0, 0]));
    if (cfg.border === 'double') doc.setDrawColor(...INK).setLineWidth(0.4).rect(W / 2 - 28, y - 5.8, 56, 8.2);
    doc.text(cfg.theme === 'tally' ? 'Tax Invoice' : title, W / 2, y, { align: 'center' });
    y += 3;
  }

  // ---- bill to / ship to / details ----
  const partyText = p => [p.name, p.address, p.state && 'State: ' + p.state, p.gstin && 'GSTIN: ' + p.gstin, p.pan && 'PAN: ' + p.pan].filter(Boolean).join('\n');
  const meta = [['Invoice No.', inv.number], ['Date', dmy(inv.date)], ['Vehicle No.', inv.vehicle], ['Agent / Broker', inv.agent], ['Delivery Location', inv.delivery]]
    .filter(r => r[1]).map(r => r[0] + ': ' + r[1]).join('\n');
  const head = ['Bill To'], body = [partyText(inv.billTo)];
  if (inv.shipOn) { head.push('Ship To'); body.push(partyText(inv.shipTo || {})); }
  head.push('Invoice Details'); body.push(meta);
  const cw = inv.shipOn ? [63, 63, 64] : [95, 95];
  doc.autoTable({
    startY: y, margin: { left: M, right: M }, theme: 'grid', head: [head], body: [body],
    styles: base, headStyles: infoHead, columnStyles: Object.fromEntries(cw.map((w, i) => [i, { cellWidth: w }]))
  });
  y = doc.lastAutoTable.finalY;

  // ---- items ----
  const showHsn = inv.items.some(i => (i.hsn || '').trim());
  const cols = [['S.No.', 'sn'], ['Description of Goods', 'd']];
  if (showHsn) cols.push(['HSN', 'h']);
  cols.push(['Qty', 'q'], ['Unit', 'u'], ['Rate', 'r']);
  if (gstOn) cols.push(['GST %', 'g']);
  cols.push(['Amount', 'a']);
  const rows = inv.items.map((it, i) => {
    const x = t.items[i], o = { sn: i + 1, d: it.desc, h: it.hsn || '', q: fmt(x.q, it.qd ?? S.dQty), u: it.unit || '', r: fmt(x.r, it.rd ?? S.dRate), g: x.gst + '%', a: fmt(x.amount, it.ad ?? S.dAmt) };
    return cols.map(cc => o[cc[1]]);
  });
  const right = { q: 1, r: 1, g: 1, a: 1 }, wd = { sn: 12, h: 22, q: 24, u: 18, r: 24, g: 16, a: 28 };
  const cs = {};
  cols.forEach((cc, i) => { const k = cc[1]; cs[i] = { halign: right[k] ? 'right' : k === 'sn' || k === 'u' ? 'center' : 'left' }; if (wd[k]) cs[i].cellWidth = wd[k]; });
  doc.autoTable({
    startY: y, margin: { left: M, right: M, bottom: 16 }, theme: 'grid', head: [cols.map(cc => cc[0])], body: rows, showHead: 'everyPage',
    styles: { ...base, fontSize: 9 }, headStyles: { ...headSt, halign: 'center' },
    alternateRowStyles: cfg.theme === 'striped' ? { fillColor: TINT } : {},
    columnStyles: cs, rowPageBreak: 'avoid',
    didParseCell: d => { if (cfg.theme === 'tally' && d.section === 'body') d.cell.styles.lineWidth = { top: 0, bottom: 0, left: 0.3, right: 0.3 }; }
  });
  y = doc.lastAutoTable.finalY;

  // ---- totals ----
  const trows = [['Subtotal', fmt(t.subtotal)]];
  if (t.discount > 0) trows.push(['Discount', '- ' + fmt(t.discount)]);
  if (gstOn || t.discount > 0) trows.push(['Total Taxable Value', fmt(t.taxable)]);
  if (gstOn && t.treatment === 'intra') { trows.push(['CGST', fmt(t.cgst)]); trows.push(['SGST', fmt(t.sgst)]); }
  if (gstOn && t.treatment === 'inter') trows.push(['IGST', fmt(t.igst)]);
  if (t.other) trows.push(['Other Charges', fmt(t.other)]);
  if (t.roundOff) trows.push(['Round Off', (t.roundOff > 0 ? '+ ' : '- ') + fmt(Math.abs(t.roundOff))]);
  trows.push(['GRAND TOTAL', 'Rs. ' + fmt(t.grand)]);
  const bank = inv.company?.bank || {};
  const bankLines = [bank.name && 'Bank: ' + bank.name, bank.holder && 'A/c Holder: ' + bank.holder, bank.acc && 'A/c No.: ' + bank.acc, bank.ifsc && 'IFSC: ' + bank.ifsc, bank.branch && 'Branch: ' + bank.branch].filter(Boolean);
  if (y + 62 > 281) { doc.addPage(); y = M; }
  const left = [[lbl('Amount in Words')], [rupeesInWords(t.grand)]];
  if (bankLines.length) { left.push([lbl('Bank Details')]); left.push([bankLines.join('\n')]); }
  const startY = y;
  doc.autoTable({ startY, margin: { left: M, right: W - M - 100, bottom: 16 }, theme: 'grid', body: left, styles: base });
  const leftEnd = doc.lastAutoTable.finalY;
  doc.autoTable({
    startY, margin: { left: M + 100, right: M, bottom: 16 }, theme: 'grid', body: trows,
    styles: { ...base, fontSize: 9.2 }, columnStyles: { 0: { cellWidth: 48 }, 1: { halign: 'right', cellWidth: 42 } },
    didParseCell: d => {
      if (d.row.index !== trows.length - 1) return;
      d.cell.styles.fontStyle = 'bold'; d.cell.styles.fontSize = 10.5;
      if (fill) { d.cell.styles.fillColor = INK; d.cell.styles.textColor = 255; } else d.cell.styles.fillColor = [238, 238, 238];
    }
  });
  y = Math.max(leftEnd, doc.lastAutoTable.finalY);

  const tc = [];
  if ((inv.payTerms || '').trim()) tc.push([lbl('Payment Terms')], [inv.payTerms.trim()]);
  if ((inv.terms || '').trim()) tc.push([lbl('Other Terms & Conditions')], [inv.terms.trim()]);
  if (tc.length) {
    doc.autoTable({ startY: y, margin: { left: M, right: M, bottom: 16 }, theme: 'grid', body: tc, styles: { ...base, fontSize: 8.6 } });
    y = doc.lastAutoTable.finalY;
  }
  if (y + 34 > 281) { doc.addPage(); y = M; }
  y += 8;
  if (cfg.declaration) {
    doc.setFont(F, 'italic').setFontSize(8).setTextColor(70);
    doc.text(doc.splitTextToSize('Declaration: We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.', 105), M, y);
    doc.setFont(F, 'normal').text('E. & O.E.', M, y + 14);
  }
  doc.setFont(F, 'bold').setFontSize(9.5).setTextColor(20);
  doc.text('For ' + (c.name || ''), W - M, y, { align: 'right' });
  doc.setFont(F, 'normal').setFontSize(9).setTextColor(60);
  doc.text('Authorised Signatory', W - M, y + 20, { align: 'right' });

  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    if (cfg.border === 'single') doc.setDrawColor(0).setLineWidth(0.4).rect(6, 6, 198, 285);
    if (cfg.border === 'double') { doc.setDrawColor(...INK).setLineWidth(0.8).rect(5, 5, 200, 287); doc.setLineWidth(0.25).rect(6.8, 6.8, 196.4, 283.4); }
    doc.setFont(F, 'normal').setFontSize(7.5).setTextColor(110);
    doc.text(`${cfg.declaration ? 'This is a Computer Generated Invoice  |  ' : ''}Invoice ${inv.number}  |  Page ${i} of ${n}`, W / 2, 287.5, { align: 'center' });
  }
  return doc;
}
const pdfBlob = inv => buildPdf(inv).output('blob');

/* ---------- HTML preview ---------- */
function invoiceHTML(inv) {
  const t = calcInvoice(inv), c = inv.company || {}, gstOn = !!inv.gstApplicable;
  const showHsn = inv.items.some(i => (i.hsn || '').trim());
  const pt = p => `<b>${esc(p.name)}</b><br>${esc(p.address)}${p.state ? '<br>State: ' + esc(p.state) : ''}${p.gstin ? '<br>GSTIN: ' + esc(p.gstin) : ''}${p.pan ? '<br>PAN: ' + esc(p.pan) : ''}`;
  const meta = [['Invoice No.', inv.number], ['Date', dmy(inv.date)], ['Vehicle No.', inv.vehicle], ['Agent / Broker', inv.agent], ['Delivery Location', inv.delivery]].filter(r => r[1]).map(r => `${r[0]}: <b>${esc(r[1])}</b>`).join('<br>');
  const bank = c.bank || {};
  const bl = [bank.name && 'Bank: ' + bank.name, bank.holder && 'A/c Holder: ' + bank.holder, bank.acc && 'A/c No.: ' + bank.acc, bank.ifsc && 'IFSC: ' + bank.ifsc, bank.branch && 'Branch: ' + bank.branch].filter(Boolean);
  const st = compState(c);
  const rows = inv.items.map((it, i) => {
    const x = t.items[i];
    return `<tr><td>${i + 1}</td><td>${esc(it.desc)}</td>${showHsn ? `<td>${esc(it.hsn)}</td>` : ''}<td class="n">${fmt(x.q, it.qd ?? S.dQty)}</td><td>${esc(it.unit)}</td><td class="n">${fmt(x.r, it.rd ?? S.dRate)}</td>${gstOn ? `<td class="n">${x.gst}%</td>` : ''}<td class="n">${fmt(x.amount, it.ad ?? S.dAmt)}</td></tr>`;
  }).join('');
  const tr = (l, v, cls = '') => `<tr class="${cls}"><td>${l}</td><td class="n">${v}</td></tr>`;
  let tot = tr('Subtotal', fmt(t.subtotal));
  if (t.discount > 0) tot += tr('Discount', '- ' + fmt(t.discount));
  if (gstOn || t.discount > 0) tot += tr('Total Taxable Value', fmt(t.taxable));
  if (gstOn && t.treatment === 'intra') tot += tr('CGST', fmt(t.cgst)) + tr('SGST', fmt(t.sgst));
  if (gstOn && t.treatment === 'inter') tot += tr('IGST', fmt(t.igst));
  if (t.other) tot += tr('Other Charges', fmt(t.other));
  if (t.roundOff) tot += tr('Round Off', (t.roundOff > 0 ? '+ ' : '- ') + fmt(Math.abs(t.roundOff)));
  tot += tr('GRAND TOTAL', '₹ ' + fmt(t.grand), 'grand');
  return `<div class="inv s-${esc(inv.style || 'classic')}">
    <div class="hd">${c.logo ? `<img src="${c.logo}" alt="">` : ''}<div><h2>${esc(c.name)}</h2><div class="pre">${esc(c.address)}</div>${st ? `<div>State: ${esc(st)}</div>` : ''}<div>${[c.gstin && 'GSTIN: ' + esc(c.gstin), c.pan && 'PAN: ' + esc(c.pan)].filter(Boolean).join(' &nbsp; ')}</div><div>${[c.mobile && 'Mobile: ' + esc(c.mobile), c.email && 'Email: ' + esc(c.email)].filter(Boolean).join(' &nbsp; ')}</div></div></div>
    <div class="ttl">${gstOn && c.gstin ? 'TAX INVOICE' : 'INVOICE'}</div>
    <table><tr><th>Bill To</th>${inv.shipOn ? '<th>Ship To</th>' : ''}<th>Invoice Details</th></tr><tr><td>${pt(inv.billTo)}</td>${inv.shipOn ? `<td>${pt(inv.shipTo || {})}</td>` : ''}<td>${meta}</td></tr></table>
    <table style="margin-top:-1px"><tr><th>S.No.</th><th>Description of Goods</th>${showHsn ? '<th>HSN</th>' : ''}<th class="n">Qty</th><th>Unit</th><th class="n">Rate</th>${gstOn ? '<th class="n">GST %</th>' : ''}<th class="n">Amount</th></tr>${rows}</table>
    <table style="margin-top:-1px"><tr><td style="width:52%;padding:0;border:0"><table><tr><th>Amount in Words</th></tr><tr><td>${esc(rupeesInWords(t.grand))}</td></tr>${bl.length ? `<tr><th>Bank Details</th></tr><tr><td class="pre">${esc(bl.join('\n'))}</td></tr>` : ''}</table></td><td style="padding:0;border:0"><table>${tot}</table></td></tr></table>
    ${(inv.payTerms || '').trim() ? `<table style="margin-top:-1px"><tr><th>Payment Terms</th></tr><tr><td class="pre">${esc(inv.payTerms.trim())}</td></tr></table>` : ''}
    ${(inv.terms || '').trim() ? `<table style="margin-top:-1px"><tr><th>Other Terms &amp; Conditions</th></tr><tr><td class="pre">${esc(inv.terms.trim())}</td></tr></table>` : ''}
    <div class="sig"><b>For ${esc(c.name)}</b><br><br><br>Authorised Signatory</div></div>`;
}

/* =========================================================
   Share / download / PDF store
   ========================================================= */
async function getPdf(rec) {
  const s = await DB.get('pdfs', rec.id);
  if (s?.blob) return s.blob;
  const b = pdfBlob(rec); await DB.put('pdfs', { id: rec.id, blob: b }); return b;
}
async function sharePdf(blob, name, title) {
  const file = new File([blob], name, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title, text: title }); }
    catch (e) { if (e.name !== 'AbortError') { toast('Sharing failed. PDF downloaded instead.'); download(blob, name); } }
  } else {
    download(blob, name); toast('This browser can’t share files. The PDF was downloaded instead.', 4000);
  }
}

const statusChip = () => '<span class="chip ok">Saved on phone</span>';

/* =========================================================
   Router
   ========================================================= */
let cur = null;           // invoice being edited
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; if (location.hash === '#/home' || !location.hash) route(); });

function setHeader(title, back) {
  $('#title').textContent = title; $('#backBtn').classList.toggle('on', !!back);
  document.title = title + ' · Sales Invoice';
}
$('#backBtn').onclick = () => { if (history.length > 1) history.back(); else location.hash = '#/home'; };
function markNav(k) { $$('.nav a').forEach(a => a.classList.toggle('on', a.dataset.nav === k)); }

async function route() {
  const parts = (location.hash || '#/home').split('/'); const page = parts[1] || 'home', arg = parts[2];
  window.scrollTo(0, 0);
  try {
    if (page === 'new') { cur = await newInvoice(); history.replaceState(null, '', '#/form'); return route(); }
    if (page === 'edit') {
      const r = await DB.get('invoices', arg); if (!r) { location.hash = '#/saved'; return; }
      cur = JSON.parse(JSON.stringify(r)); cur.editing = true; history.replaceState(null, '', '#/form'); return route();
    }
    const pages = { home: pgHome, saved: pgSaved, companies: pgCompanies, parties: pgParties, products: pgProducts, settings: pgSettings, form: pgForm, preview: pgPreview, view: pgView };
    markNav({ home: 'home', saved: 'saved', view: 'saved', settings: 'settings', form: 'form', preview: 'form' }[page] || '');
    await (pages[page] || pgHome)(arg);
  } catch (e) { console.error(e); app.innerHTML = `<div class="empty">Something went wrong: ${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', route);

/* ---------- Home ---------- */
async function pgHome() {
  setHeader('Sales Invoice', false);
  const [inv, co, pa, pr] = await Promise.all(['invoices', 'companies', 'parties', 'products'].map(s => DB.all(s)));
  app.innerHTML = `<div class="stack">
    <div class="hero"><a class="btn mark block" href="#/new">Create New Invoice</a>
    <p>${co.length ? 'Pick a company and a party, add items, then save or share the PDF.' : 'Start by adding the company you invoice from.'}</p></div>
    ${!co.length ? `<a class="btn primary block" href="#/companies">Add your first company</a>` : ''}
    <div class="tiles">
      <a class="tile" href="#/saved"><b>Saved Invoices</b><span>${inv.length} saved</span></a>
      <a class="tile" href="#/companies"><b>Companies</b><span>${co.length} added</span></a>
      <a class="tile" href="#/parties"><b>Parties</b><span>${pa.length} added</span></a>
      <a class="tile" href="#/products"><b>Inventory / Products</b><span>${pr.length} added</span></a>
      <a class="tile" href="#/settings"><b>Settings</b><span>Numbering, GST, backup</span></a>
      ${deferredInstall ? `<button class="tile" id="inst" style="font:inherit;text-align:left;cursor:pointer"><b>Install app</b><span>Add to home screen</span></button>` : ''}
    </div></div>`;
  $('#inst')?.addEventListener('click', async () => { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; route(); });
}

/* ---------- Masters: companies ---------- */
const listPage = (title, items, rowFn, addLabel, emptyMsg) => `<div class="stack"><button class="btn primary block" id="addBtn">${addLabel}</button>${items.length ? `<div class="list">${items.map(rowFn).join('')}</div>` : `<div class="empty">${emptyMsg}</div>`}</div>`;

async function pgCompanies() {
  setHeader('Companies', true);
  const items = (await DB.all('companies')).sort((a, b) => a.name.localeCompare(b.name));
  app.innerHTML = listPage('Companies', items, c => `<button class="li" data-id="${c.id}"><div class="l"><b>${esc(c.name)}</b><span>${esc(c.gstin || c.address)}</span></div><div class="r small muted">Next ${esc(fmtNo(c, c.nextNo || S.startNo))}</div></button>`, 'Add company', 'No companies yet. Add the company you issue invoices from.');
  $('#addBtn').onclick = () => companySheet(null, pgCompanies);
  $$('.li').forEach(b => b.onclick = async () => companySheet(await DB.get('companies', b.dataset.id), pgCompanies));
}
function companySheet(c, done) {
  const isNew = !c; c = c || { id: uid(), bank: {}, nextNo: S.startNo };
  const b = c.bank || {};
  const el = openSheet(isNew ? 'Add company' : 'Edit company', `
    <label class="fld"><span>Company name <i>*</i></span><input id="f-name" value="${esc(c.name)}" autocomplete="off"></label>
    <label class="fld"><span>Address <i>*</i></span><textarea id="f-address">${esc(c.address)}</textarea></label>
    <label class="fld"><span>State (decides CGST + SGST or IGST)</span><select id="f-state">${stateOpts(c.state || stateFromGstin(c.gstin))}</select></label>
    <div class="grid2"><label class="fld"><span>GSTIN</span><input id="f-gstin" value="${esc(c.gstin)}" autocapitalize="characters" maxlength="15"></label>
    <label class="fld"><span>PAN</span><input id="f-pan" value="${esc(c.pan)}" autocapitalize="characters" maxlength="10"></label></div>
    <div class="grid2"><label class="fld"><span>Mobile</span><input id="f-mobile" value="${esc(c.mobile)}" inputmode="tel"></label>
    <label class="fld"><span>Email</span><input id="f-email" value="${esc(c.email)}" inputmode="email" autocapitalize="none"></label></div>
    <div class="fld"><span>Logo</span><div class="row"><div class="logo-prev" id="logoPrev">${c.logo ? `<img src="${c.logo}" alt="">` : '<span class="muted small">None</span>'}</div>
      <div class="row wrap"><label class="btn sm" for="f-logo">Choose image</label><input id="f-logo" type="file" accept="image/*" hidden><button class="link danger" id="logoRm" type="button">Remove</button></div></div></div>
    <details class="card" ${Object.values(b).some(Boolean) ? 'open' : ''}><summary>Bank details (optional)</summary>
      <label class="fld"><span>Bank name</span><input id="b-name" value="${esc(b.name)}"></label>
      <label class="fld"><span>Account holder name</span><input id="b-holder" value="${esc(b.holder)}"></label>
      <label class="fld"><span>Account number</span><input id="b-acc" value="${esc(b.acc)}" inputmode="numeric"></label>
      <div class="grid2"><label class="fld"><span>IFSC code</span><input id="b-ifsc" value="${esc(b.ifsc)}" autocapitalize="characters"></label>
      <label class="fld"><span>Branch</span><input id="b-branch" value="${esc(b.branch)}"></label></div></details>
    <details class="card" style="margin-top:12px"><summary>Invoice numbering for this company</summary>
      <div class="grid2"><label class="fld"><span>Prefix</span><input id="f-prefix" value="${esc(c.prefix)}" placeholder="${esc(S.prefix)}"></label>
      <label class="fld"><span>Next number</span><input id="f-next" value="${esc(c.nextNo || S.startNo)}" inputmode="numeric"></label></div>
      <p class="note">Leave the prefix empty to use the default from Settings.</p></details>`,
    `${isNew ? '' : '<button class="btn danger" id="delBtn">Delete</button>'}<button class="btn primary" id="saveBtn">Save company</button>`);
  let logo = c.logo || '';
  $('#f-logo', el).onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { logo = await resizeImage(f, 320); $('#logoPrev', el).innerHTML = `<img src="${logo}" alt="">`; } catch (err) { toast('Could not read that image.'); }
  };
  $('#logoRm', el).onclick = () => { logo = ''; $('#logoPrev', el).innerHTML = '<span class="muted small">None</span>'; };
  $('#f-gstin', el).oninput = e => { e.target.value = e.target.value.toUpperCase(); const s = stateFromGstin(e.target.value); if (s && !$('#f-state', el).value) $('#f-state', el).value = s; };
  $('#saveBtn', el).onclick = async () => {
    const v = id => $('#' + id, el).value.trim();
    if (!v('f-name')) return toast('Enter the company name.');
    if (!v('f-address')) return toast('Enter the company address.');
    const gstin = v('f-gstin').toUpperCase(), pan = v('f-pan').toUpperCase();
    if (gstin && !GSTIN_RE.test(gstin)) return toast('GSTIN looks invalid. It has 15 characters.');
    if (pan && !PAN_RE.test(pan)) return toast('PAN looks invalid. Example: ABCDE1234F.');
    const nextNo = parseInt(v('f-next'), 10);
    if (!(nextNo >= 1)) return toast('Next number must be 1 or more.');
    Object.assign(c, { name: v('f-name'), address: v('f-address'), state: $('#f-state', el).value || stateFromGstin(gstin), gstin, pan, mobile: v('f-mobile'), email: v('f-email'), logo, prefix: v('f-prefix'), nextNo, bank: { name: v('b-name'), holder: v('b-holder'), acc: v('b-acc'), ifsc: v('b-ifsc').toUpperCase(), branch: v('b-branch') } });
    await DB.put('companies', c); el.close(); toast('Company saved.'); done && done(c);
  };
  $('#delBtn', el)?.addEventListener('click', async () => {
    if (!confirm(`Delete ${c.name}? Saved invoices keep their own copy of the company details.`)) return;
    await DB.del('companies', c.id); el.close(); toast('Company deleted.'); done && done(null);
  });
}
function resizeImage(file, max) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const r = Math.min(1, max / Math.max(img.width, img.height)), cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(img.width * r)); cv.height = Math.max(1, Math.round(img.height * r));
      const ctx = cv.getContext('2d'); const png = file.type === 'image/png';
      if (!png) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); }
      ctx.drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
      res(png ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.88));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('bad image')); };
    img.src = url;
  });
}

/* ---------- Masters: parties ---------- */
async function pgParties() {
  setHeader('Parties', true);
  const items = (await DB.all('parties')).sort((a, b) => a.name.localeCompare(b.name));
  app.innerHTML = listPage('Parties', items, p => `<button class="li" data-id="${p.id}"><div class="l"><b>${esc(p.name)}</b><span>${esc(p.state)}${p.gstin ? ' · ' + esc(p.gstin) : ''}</span></div></button>`, 'Add party', 'No parties yet. Parties you add are saved for future invoices.');
  $('#addBtn').onclick = () => partySheet(null, pgParties);
  $$('.li').forEach(b => b.onclick = async () => partySheet(await DB.get('parties', b.dataset.id), pgParties));
}
function partySheet(p, done) {
  const isNew = !p; p = p || { id: uid() };
  const el = openSheet(isNew ? 'Add party' : 'Edit party', `
    <label class="fld"><span>Party name <i>*</i></span><input id="f-name" value="${esc(p.name)}" autocomplete="off"></label>
    <label class="fld"><span>Address <i>*</i></span><textarea id="f-address">${esc(p.address)}</textarea></label>
    <label class="fld"><span>State <i>*</i></span><select id="f-state">${stateOpts(p.state)}</select></label>
    <div class="grid2"><label class="fld"><span>GSTIN</span><input id="f-gstin" value="${esc(p.gstin)}" autocapitalize="characters" maxlength="15"></label>
    <label class="fld"><span>PAN</span><input id="f-pan" value="${esc(p.pan)}" autocapitalize="characters" maxlength="10"></label></div>`,
    `${isNew ? '' : '<button class="btn danger" id="delBtn">Delete</button>'}<button class="btn primary" id="saveBtn">Save party</button>`);
  $('#f-gstin', el).oninput = e => { e.target.value = e.target.value.toUpperCase(); const s = stateFromGstin(e.target.value); if (s && !$('#f-state', el).value) $('#f-state', el).value = s; };
  $('#saveBtn', el).onclick = async () => {
    const v = id => $('#' + id, el).value.trim();
    const gstin = v('f-gstin').toUpperCase(), pan = v('f-pan').toUpperCase();
    if (!v('f-name')) return toast('Enter the party name.');
    if (!v('f-address')) return toast('Enter the party address.');
    const state = $('#f-state', el).value || stateFromGstin(gstin);
    if (!state) return toast('Select the party’s state.');
    if (gstin && !GSTIN_RE.test(gstin)) return toast('GSTIN looks invalid. It has 15 characters.');
    if (pan && !PAN_RE.test(pan)) return toast('PAN looks invalid. Example: ABCDE1234F.');
    Object.assign(p, { name: v('f-name'), address: v('f-address'), state, gstin, pan });
    await DB.put('parties', p); el.close(); toast('Party saved.'); done && done(p);
  };
  $('#delBtn', el)?.addEventListener('click', async () => {
    if (!confirm(`Delete ${p.name}? Saved invoices keep their own copy.`)) return;
    await DB.del('parties', p.id); el.close(); toast('Party deleted.'); done && done(null);
  });
}

/* ---------- Masters: products ---------- */
async function pgProducts() {
  setHeader('Inventory / Products', true);
  const items = (await DB.all('products')).sort((a, b) => a.name.localeCompare(b.name));
  app.innerHTML = listPage('Products', items, p => `<button class="li" data-id="${p.id}"><div class="l"><b>${esc(p.name)}</b><span>${p.hsn ? 'HSN ' + esc(p.hsn) + ' · ' : ''}${esc(p.unit)}</span></div><div class="r small muted">${p.qd}/${p.rd}/${p.ad} dp</div></button>`, 'Add product', 'No products yet. Add products once and pick them on every invoice.');
  $('#addBtn').onclick = () => productSheet(null, pgProducts);
  $$('.li').forEach(b => b.onclick = async () => productSheet(await DB.get('products', b.dataset.id), pgProducts));
}
const decOpts = sel => opts([0, 1, 2, 3, 4].map(n => [n, n + ' decimal' + (n === 1 ? '' : 's')]), sel);
function productSheet(p, done) {
  const isNew = !p; p = p || { id: uid(), unit: S.units[0], qd: S.dQty, rd: S.dRate, ad: S.dAmt, gst: '' };
  const el = openSheet(isNew ? 'Add product' : 'Edit product', `
    <label class="fld"><span>Product name / description <i>*</i></span><input id="f-name" value="${esc(p.name)}" autocomplete="off"></label>
    <div class="grid2"><label class="fld"><span>HSN code</span><input id="f-hsn" value="${esc(p.hsn)}" inputmode="numeric"></label>
    <label class="fld"><span>Default GST rate</span><select id="f-gst">${opts(GST_RATES.map(r => [r, r + '%']), p.gst, 'None')}</select></label></div>
    <label class="fld"><span>Unit</span><div class="row"><select id="f-unit">${opts(p.unit && !S.units.includes(p.unit) ? [...S.units, p.unit] : S.units, p.unit)}</select><button class="btn sm" id="addUnit" type="button" style="flex-shrink:0">New unit</button></div></label>
    <label class="fld"><span>Quantity precision</span><select id="f-qd">${decOpts(p.qd)}</select></label>
    <div class="grid2"><label class="fld"><span>Rate precision</span><select id="f-rd">${decOpts(p.rd)}</select></label>
    <label class="fld"><span>Amount precision</span><select id="f-ad">${decOpts(p.ad)}</select></label></div>`,
    `${isNew ? '' : '<button class="btn danger" id="delBtn">Delete</button>'}<button class="btn primary" id="saveBtn">Save product</button>`);
  $('#addUnit', el).onclick = async () => {
    const u = (prompt('New unit name (for example BAG)') || '').trim().toUpperCase(); if (!u) return;
    if (!S.units.includes(u)) { S.units.push(u); await saveSettings(); }
    $('#f-unit', el).innerHTML = opts(S.units, u);
  };
  $('#saveBtn', el).onclick = async () => {
    const v = id => $('#' + id, el).value.trim();
    if (!v('f-name')) return toast('Enter the product name.');
    Object.assign(p, { name: v('f-name'), hsn: v('f-hsn'), gst: v('f-gst'), unit: v('f-unit'), qd: +v('f-qd'), rd: +v('f-rd'), ad: +v('f-ad') });
    await DB.put('products', p); el.close(); toast('Product saved.'); done && done(p);
  };
  $('#delBtn', el)?.addEventListener('click', async () => {
    if (!confirm(`Delete ${p.name}? Saved invoices are not changed.`)) return;
    await DB.del('products', p.id); el.close(); toast('Product deleted.'); done && done(null);
  });
}

/* =========================================================
   Invoice form
   ========================================================= */
const newItem = () => ({ id: uid(), pid: '', desc: '', hsn: '', unit: S.units[0] || 'PCS', qty: '', rate: '', gst: S.gstRate, qd: S.dQty, rd: S.dRate, ad: S.dAmt });
async function newInvoice() {
  const cos = await DB.all('companies');
  const inv = {
    id: uid(), companyId: '', company: null, partyId: '', billTo: {}, shipOn: false, shipTo: {}, shipPartyId: '',
    numberMode: 'auto', number: '', date: today(), style: S.invStyle || 'classic', vehicle: '', agent: '', delivery: '',
    payTerms: S.payTerms, terms: S.terms, items: [newItem()], gstApplicable: S.gstApplicable, gstMode: 'auto',
    other: '', discount: '', roundOff: true, createdAt: Date.now()
  };
  if (cos.length === 1) await pickCompany(inv, cos[0]);
  return inv;
}
async function pickCompany(inv, c) {
  inv.companyId = c.id; inv.company = JSON.parse(JSON.stringify(c));
  if (inv.numberMode === 'auto' && !inv.lockedNumber) inv.number = (await nextAutoNumber(c, inv.editing ? inv.id : null)).text;
}

async function pgForm() {
  if (!cur) { cur = await newInvoice(); }
  setHeader(cur.editing ? 'Edit invoice' : 'New invoice', true);
  const y = window.scrollY;
  const [cos, pas, prs] = await Promise.all([DB.all('companies'), DB.all('parties'), DB.all('products')]);
  pas.sort((a, b) => a.name.localeCompare(b.name)); prs.sort((a, b) => a.name.localeCompare(b.name));
  const c = cur;
  c._products = prs;
  app.innerHTML = `<div class="stack" id="form">
  <section class="card"><h3>Company</h3>
    ${cos.length ? `<select id="companySel">${opts(cos.sort((a, b) => a.name.localeCompare(b.name)).map(x => [x.id, x.name]), c.companyId, 'Select company')}</select>`
      : `<div class="empty" style="padding:8px 0">Add a company before creating an invoice.<br><button class="btn primary" id="newCo">Add company</button></div>`}
  </section>
  <section class="card"><h3>Invoice</h3>
    <div class="fld"><span>Invoice number</span><div class="seg" id="modeSeg"><button type="button" data-m="auto" class="${c.numberMode === 'auto' ? 'on' : ''}">Automatic</button><button type="button" data-m="manual" class="${c.numberMode === 'manual' ? 'on' : ''}">Manual</button></div></div>
    <div class="grid2"><label class="fld"><span>Number</span><input id="numIn" data-k="number" value="${esc(c.number)}" ${c.numberMode === 'auto' ? 'readonly' : ''} autocomplete="off"></label>
    <label class="fld"><span>Date</span><input type="date" data-k="date" value="${esc(c.date)}"></label></div>
    <label class="fld"><span>Invoice design</span><select data-k="style">${opts(Object.entries(STYLES).map(([k, v]) => [k, v.name]), c.style || 'classic')}</select></label>
    <details class="card" ${c.vehicle || c.agent || c.delivery || c.payTerms || c.terms ? 'open' : ''}><summary>More details (optional)</summary>
      <label class="fld"><span>Vehicle number</span><input data-k="vehicle" value="${esc(c.vehicle)}" autocapitalize="characters"></label>
      <label class="fld"><span>Agent / Broker name</span><input data-k="agent" value="${esc(c.agent)}"></label>
      <label class="fld"><span>Delivery location</span><input data-k="delivery" value="${esc(c.delivery)}"></label>
      <label class="fld"><span>Payment terms</span><textarea data-k="payTerms">${esc(c.payTerms)}</textarea></label>
      <label class="fld"><span>Other terms &amp; conditions</span><textarea data-k="terms">${esc(c.terms)}</textarea></label></details>
  </section>
  <section class="card"><h3>Bill To</h3>
    <select id="partySel">${opts(pas.map(p => [p.id, p.name]), c.partyId, 'Select party')}<option value="__new">+ Add new party</option></select>
    ${c.billTo?.name ? `<div class="note" style="margin:10px 0 0"><b>${esc(c.billTo.name)}</b><br>${esc(c.billTo.address)}<br>${esc(c.billTo.state)}${c.billTo.gstin ? ' · GSTIN ' + esc(c.billTo.gstin) : ''}${c.billTo.pan ? ' · PAN ' + esc(c.billTo.pan) : ''}</div>` : ''}
    <label class="check" style="margin-top:8px"><input type="checkbox" id="shipOn" ${c.shipOn ? 'checked' : ''}> Add Ship To</label>
    ${c.shipOn ? `<div style="margin-top:6px">
      <label class="fld"><span>Fill from saved party</span><select id="shipSel">${opts(pas.map(p => [p.id, p.name]), c.shipPartyId, 'Enter manually')}</select></label>
      <label class="fld"><span>Name <i>*</i></span><input data-k="shipTo.name" value="${esc(c.shipTo.name)}"></label>
      <label class="fld"><span>Address <i>*</i></span><textarea data-k="shipTo.address">${esc(c.shipTo.address)}</textarea></label>
      <div class="grid2"><label class="fld"><span>State</span><select data-k="shipTo.state">${stateOpts(c.shipTo.state)}</select></label>
      <label class="fld"><span>GSTIN</span><input data-k="shipTo.gstin" value="${esc(c.shipTo.gstin)}" autocapitalize="characters"></label></div></div>` : ''}
  </section>
  <section class="card"><h3>Items</h3>
    <div id="items">${c.items.map(itemHTML).join('')}</div>
    <div class="row wrap"><button class="btn sm" id="addItem" type="button">+ Add item</button><button class="btn sm" id="addInv" type="button">Add Inventory</button></div>
  </section>
  <section class="card"><h3>GST</h3>
    <label class="check"><input type="checkbox" id="gstOn" ${c.gstApplicable ? 'checked' : ''}> GST applicable</label>
    ${c.gstApplicable ? `<label class="fld" style="margin-top:6px"><span>GST treatment</span><select data-k="gstMode">${opts([['auto', 'Automatic (by company and party state)'], ['intra', 'CGST + SGST (same state)'], ['inter', 'IGST (different state)']], c.gstMode)}</select></label><div id="gstInfo"></div>` : ''}
  </section>
  <section class="card"><h3>Charges</h3>
    <div class="grid2"><label class="fld"><span>Other charges</span><input data-k="other" data-num="1" value="${esc(c.other)}" inputmode="decimal" placeholder="0"></label>
    <label class="fld"><span>Discount</span><input data-k="discount" data-num="1" value="${esc(c.discount)}" inputmode="decimal" placeholder="0"></label></div>
    <label class="check"><input type="checkbox" id="roundOn" ${c.roundOff !== false ? 'checked' : ''}> Round off to nearest rupee</label>
  </section>
  <div class="totals" id="totals"></div>
  <button class="btn block" id="prevBtn" type="button">Preview invoice</button>
  <div class="actions3"><button class="btn primary" id="saveInv">Save invoice</button><button class="btn" id="shareInv">Share PDF</button><button class="btn" id="dlInv">Download PDF</button></div>
  </div>`;
  bindForm(cos, pas, prs);
  updateTotals();
  window.scrollTo(0, y);
}
function itemHTML(it, i) {
  const gstOn = cur.gstApplicable, prs = cur._products || [];
  const units = !it.unit || S.units.includes(it.unit) ? S.units : [...S.units, it.unit];
  return `<div class="item" data-i="${i}">
    <div class="item-head"><strong>Item ${i + 1}</strong><button class="link danger" type="button" data-act="rm">Remove</button></div>
    <label class="fld"><span>Saved product</span><select data-f="pid">${opts(prs.map(p => [p.id, p.name]), it.pid, 'Choose saved product (optional)')}</select></label>
    <label class="fld"><span>Description <i>*</i></span><input data-f="desc" value="${esc(it.desc)}" placeholder="Product description" autocomplete="off"></label>
    <div class="grid2"><label class="fld"><span>HSN</span><input data-f="hsn" value="${esc(it.hsn)}" inputmode="numeric"></label>
    <label class="fld"><span>Unit</span><select data-f="unit">${opts(units, it.unit)}</select></label></div>
    <div class="grid2"><label class="fld"><span>Quantity</span><input data-f="qty" data-dec="qd" value="${esc(it.qty)}" inputmode="decimal" placeholder="0"></label>
    <label class="fld"><span>Rate</span><input data-f="rate" data-dec="rd" value="${esc(it.rate)}" inputmode="decimal" placeholder="0"></label></div>
    <div class="grid2">${gstOn ? `<label class="fld"><span>GST %</span><select data-f="gst">${opts(GST_RATES.map(r => [r, r + '%']), it.gst)}</select></label>` : '<div></div>'}
    <div class="fld"><span>Amount</span><div class="amt" data-amt></div></div></div></div>`;
}
function bindForm(cos, pas, prs) {
  const f = $('#form');
  $('#newCo')?.addEventListener('click', () => companySheet(null, () => pgForm()));
  $('#companySel')?.addEventListener('change', async e => {
    const c = cos.find(x => x.id === e.target.value);
    if (c) await pickCompany(cur, c); else { cur.companyId = ''; cur.company = null; }
    pgForm();
  });
  $$('#modeSeg button', f).forEach(b => b.onclick = async () => {
    cur.numberMode = b.dataset.m;
    if (cur.numberMode === 'auto') { cur.lockedNumber = false; if (cur.company) { const co = await DB.get('companies', cur.companyId); if (co) cur.number = (await nextAutoNumber(co, cur.editing ? cur.id : null)).text; } }
    else cur.lockedNumber = true;
    pgForm();
  });
  $('#partySel', f).onchange = e => {
    if (e.target.value === '__new') { e.target.value = cur.partyId; return partySheet(null, p => { if (p) { cur.partyId = p.id; cur.billTo = { name: p.name, address: p.address, state: p.state, gstin: p.gstin || '', pan: p.pan || '' }; } pgForm(); }); }
    const p = pas.find(x => x.id === e.target.value);
    cur.partyId = p ? p.id : ''; cur.billTo = p ? { name: p.name, address: p.address, state: p.state, gstin: p.gstin || '', pan: p.pan || '' } : {};
    pgForm();
  };
  $('#shipOn', f).onchange = e => { cur.shipOn = e.target.checked; pgForm(); };
  $('#shipSel', f)?.addEventListener('change', e => {
    const p = pas.find(x => x.id === e.target.value); cur.shipPartyId = p ? p.id : '';
    if (p) cur.shipTo = { name: p.name, address: p.address, state: p.state, gstin: p.gstin || '' };
    pgForm();
  });
  $('#gstOn', f).onchange = e => { cur.gstApplicable = e.target.checked; pgForm(); };
  $('#roundOn', f).onchange = e => { cur.roundOff = e.target.checked; updateTotals(); };
  // generic bound fields
  f.addEventListener('input', e => {
    const k = e.target.dataset.k;
    if (k) { setPath(cur, k, e.target.value); if (k === 'number') cur.lockedNumber = true; updateTotals(); }
  });
  f.addEventListener('change', e => { const k = e.target.dataset.k; if (k === 'gstMode' || k === 'shipTo.state') { setPath(cur, k, e.target.value); updateTotals(); } });
  // items
  const box = $('#items', f);
  box.addEventListener('input', e => {
    const fld = e.target.dataset.f, card = e.target.closest('.item'); if (!fld || !card) return;
    if (fld === 'pid') return;
    cur.items[+card.dataset.i][fld] = e.target.value; updateTotals();
  });
  box.addEventListener('change', e => {
    const fld = e.target.dataset.f, card = e.target.closest('.item'); if (!fld || !card) return;
    const i = +card.dataset.i, it = cur.items[i];
    if (fld === 'pid') {
      const p = prs.find(x => x.id === e.target.value);
      if (p) Object.assign(it, { pid: p.id, desc: p.name, hsn: p.hsn || '', unit: p.unit, qd: p.qd, rd: p.rd, ad: p.ad, gst: p.gst !== '' && p.gst != null ? +p.gst : it.gst });
      else it.pid = '';
      card.outerHTML = itemHTML(it, i); updateTotals();
    } else { it[fld] = e.target.value; updateTotals(); }
  });
  box.addEventListener('focusout', e => {
    const d = e.target.dataset.dec, card = e.target.closest('.item'); if (!d || !card || e.target.value.trim() === '') return;
    const it = cur.items[+card.dataset.i]; const v = rnd(num(e.target.value), it[d]);
    e.target.value = v.toFixed(it[d]); it[e.target.dataset.f] = e.target.value; updateTotals();
  });
  box.addEventListener('click', e => {
    if (e.target.dataset.act !== 'rm') return;
    const i = +e.target.closest('.item').dataset.i;
    if (cur.items.length === 1) cur.items[0] = newItem(); else cur.items.splice(i, 1);
    pgForm();
  });
  $('#addItem', f).onclick = () => { cur.items.push(newItem()); pgForm().then(() => { const cards = $$('#items .item'); cards[cards.length - 1]?.scrollIntoView({ block: 'center' }); }); };
  $('#addInv', f).onclick = () => productSheet(null, p => {
    if (!p) return;
    const empty = cur.items.length === 1 && !cur.items[0].desc && !cur.items[0].qty && !cur.items[0].rate;
    const it = Object.assign(newItem(), { pid: p.id, desc: p.name, hsn: p.hsn || '', unit: p.unit, qd: p.qd, rd: p.rd, ad: p.ad, gst: p.gst !== '' && p.gst != null ? +p.gst : S.gstRate });
    if (empty) cur.items[0] = it; else cur.items.push(it);
    pgForm();
  });
  $('#prevBtn', f).onclick = async () => { const r = await finalize(); if (r) location.hash = '#/preview'; };
  $('#saveInv', f).onclick = saveInvoice;
  $('#shareInv', f).onclick = async () => { const r = await finalize(); if (r) sharePdf(pdfBlob(r), fileName(r), `Invoice ${r.number}`); };
  $('#dlInv', f).onclick = async () => { const r = await finalize(); if (r) { download(pdfBlob(r), fileName(r)); toast('PDF downloaded.'); } };
}
function updateTotals() {
  const box = $('#totals'); if (!box) return;
  const t = calcInvoice(cur);
  $$('#items .item').forEach((card, i) => { const a = $('[data-amt]', card); if (a && t.items[i]) a.textContent = fmt(t.items[i].amount, cur.items[i].ad ?? S.dAmt); });
  const row = (l, v, cls = '') => `<div class="t ${cls}"><span>${l}</span><span>${v}</span></div>`;
  let h = row('Subtotal', fmt(t.subtotal));
  if (t.discount > 0) h += row('Discount', '- ' + fmt(t.discount));
  if (cur.gstApplicable) {
    h += row('Total taxable value', fmt(t.taxable));
    if (t.treatment === 'intra') h += row('CGST', fmt(t.cgst)) + row('SGST', fmt(t.sgst)); else h += row('IGST', fmt(t.igst));
  }
  if (t.other) h += row('Other charges', fmt(t.other));
  if (t.roundOff) h += row('Round off', (t.roundOff > 0 ? '+ ' : '- ') + fmt(Math.abs(t.roundOff)));
  h += row('GRAND TOTAL', '₹ ' + fmt(t.grand), 'g') + `<div class="words">${esc(rupeesInWords(t.grand))}</div>`;
  box.innerHTML = h;
  const gi = $('#gstInfo');
  if (gi) {
    const lbl = t.treatment === 'intra' ? 'CGST + SGST' : 'IGST';
    gi.innerHTML = cur.gstMode === 'auto'
      ? (t.stateKnown ? `<p class="note">Company and party states ${t.treatment === 'intra' ? 'match' : 'differ'}, so ${lbl} is applied.</p>` : `<p class="note warn">${cur.company ? 'Set the company’s state in Companies and pick a party to detect GST automatically. Using IGST for now.' : 'Pick a company and a party to detect GST automatically.'}</p>`)
      : `<p class="note">${lbl} selected manually.</p>`;
  }
}

/* Build a clean record from the form (null + toast if invalid) */
async function finalize() {
  const c = cur;
  if (!c.companyId || !c.company) { toast('Select the company issuing this invoice.'); return null; }
  if (!c.billTo?.name) { toast('Select or add a party to bill.'); return null; }
  if (c.shipOn && (!(c.shipTo.name || '').trim() || !(c.shipTo.address || '').trim())) { toast('Enter the Ship To name and address, or turn Ship To off.'); return null; }
  if (!(c.number || '').trim()) { toast('Enter an invoice number.'); return null; }
  if (!c.date) { toast('Choose the invoice date.'); return null; }
  const items = c.items.filter(it => (it.desc || '').trim() || num(it.qty) || num(it.rate));
  if (!items.length) { toast('Add at least one item.'); return null; }
  for (const [i, it] of items.entries()) {
    if (!(it.desc || '').trim()) { toast(`Item ${i + 1}: enter a description.`); return null; }
    if (!(num(it.qty) > 0)) { toast(`Item ${i + 1}: enter a quantity.`); return null; }
    if (String(it.rate ?? '').trim() === '') { toast(`Item ${i + 1}: enter a rate.`); return null; }
  }
  const rec = JSON.parse(JSON.stringify(c)); delete rec._products;
  rec.items = items; rec.number = rec.number.trim(); rec.totals = calcInvoice(rec); rec.grand = rec.totals.grand;
  return rec;
}

async function saveInvoice() {
  const btn = $('#saveInv'); btn && (btn.disabled = true);
  try {
    const rec = await finalize(); if (!rec) return;
    const co = await DB.get('companies', rec.companyId);
    const used = await usedNumbers(rec.companyId, rec.id);
    if (used.includes(rec.number.toLowerCase())) {
      if (rec.numberMode === 'manual') { toast('This company already has an invoice with that number. Use a different number.', 4000); return; }
      const nx = await nextAutoNumber(co || rec.company, rec.id); rec.number = nx.text; cur.number = nx.text;
    }
    // advance this company's counter when the saved number is the next automatic one
    if (co && rec.numberMode === 'auto') {
      const nx = await nextAutoNumber(co, rec.id);
      if (nx.text.toLowerCase() === rec.number.toLowerCase()) { co.nextNo = nx.n + 1; await DB.put('companies', co); }
    }
    rec.company = co ? JSON.parse(JSON.stringify(co)) : rec.company;
    rec.updatedAt = Date.now(); delete rec.editing; delete rec.lockedNumber;
    const blob = pdfBlob(rec);
    await DB.put('invoices', rec); await DB.put('pdfs', { id: rec.id, blob });
    let msg = 'Invoice saved on this phone.';
    cur = null; toast(msg, 4000); location.hash = '#/view/' + rec.id;
  } catch (e) { console.error(e); toast('Could not save: ' + e.message, 5000); }
  finally { btn && (btn.disabled = false); }
}

/* ---------- Preview / View ---------- */
async function pgPreview() {
  setHeader('Preview', true);
  const rec = cur && await finalize();
  if (!rec) { location.hash = '#/form'; return; }
  app.innerHTML = `<div class="stack"><div class="docwrap">${invoiceHTML(rec)}</div>
    <div class="actions3"><button class="btn primary" id="pSave">Save invoice</button><button class="btn" id="pShare">Share PDF</button><button class="btn" id="pDl">Download PDF</button></div>
    <a class="btn block" href="#/form">Back to editing</a></div>`;
  $('#pSave').onclick = saveInvoice;
  $('#pShare').onclick = () => sharePdf(pdfBlob(rec), fileName(rec), `Invoice ${rec.number}`);
  $('#pDl').onclick = () => { download(pdfBlob(rec), fileName(rec)); toast('PDF downloaded.'); };
}
async function pgView(id) {
  setHeader('Invoice', true);
  const rec = await DB.get('invoices', id); if (!rec) { location.hash = '#/saved'; return; }
  app.innerHTML = `<div class="stack"><div class="row between"><div><b>${esc(rec.number)}</b><div class="muted small">${esc(rec.company?.name)}</div></div><div>${statusChip(rec)}</div></div>
    <div class="docwrap">${invoiceHTML(rec)}</div>
    <div class="actions3"><button class="btn" id="vEdit">Edit</button><button class="btn" id="vShare">Share PDF</button><button class="btn primary" id="vDl">Download PDF</button></div></div>`;
  $('#vEdit').onclick = () => location.hash = '#/edit/' + id;
  $('#vShare').onclick = async () => sharePdf(await getPdf(rec), fileName(rec), `Invoice ${rec.number}`);
  $('#vDl').onclick = async () => { download(await getPdf(rec), fileName(rec)); toast('PDF downloaded.'); };
}

/* ---------- Saved invoices ---------- */
async function pgSaved() {
  setHeader('Saved Invoices', true);
  const all = (await DB.all('invoices')).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
  app.innerHTML = `<div class="stack"><input type="search" id="q" placeholder="Search number, party, company or date" aria-label="Search invoices"><div id="lst" class="list"></div></div>`;
  const draw = () => {
    const q = $('#q').value.trim().toLowerCase();
    const items = all.filter(r => !q || [r.number, r.billTo?.name, r.company?.name, r.date, dmy(r.date)].some(x => String(x || '').toLowerCase().includes(q)));
    $('#lst').innerHTML = items.length ? items.map(r => `<button class="li" data-id="${r.id}"><div class="l"><b>${esc(r.number)} · ${esc(r.billTo?.name)}</b><span>${esc(r.company?.name)} · ${dmy(r.date)}</span>${statusChip(r)}</div><div class="r"><b>₹ ${fmt(r.grand)}</b></div></button>`).join('')
      : `<div class="empty">${all.length ? 'No invoices match your search.' : 'No invoices saved yet.<br><a class="btn mark" href="#/new">Create new invoice</a>'}</div>`;
    $$('#lst .li').forEach(b => b.onclick = () => invoiceActions(all.find(r => r.id === b.dataset.id)));
  };
  $('#q').oninput = draw; draw();
}
function invoiceActions(rec) {
  const el = openSheet(`${rec.number} · ₹ ${fmt(rec.grand)}`, `<div class="stack">
    <button class="btn block" data-a="view">View invoice</button><button class="btn block" data-a="edit">Edit invoice</button>
    <button class="btn block" data-a="dl">Download PDF</button><button class="btn block" data-a="share">Share PDF</button>
    <button class="btn block danger" data-a="del">Delete invoice</button></div>`);
  el.onclick = async e => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) { if (e.target === el || e.target.closest('[data-close]')) el.close(); return; }
    if (a === 'view') { el.close(); location.hash = '#/view/' + rec.id; }
    if (a === 'edit') { el.close(); location.hash = '#/edit/' + rec.id; }
    if (a === 'dl') { download(await getPdf(rec), fileName(rec)); el.close(); }
    if (a === 'share') { el.close(); sharePdf(await getPdf(rec), fileName(rec), `Invoice ${rec.number}`); }
    if (a === 'del') {
      if (!confirm(`Delete invoice ${rec.number}?`)) return;
      await DB.del('invoices', rec.id); await DB.del('pdfs', rec.id); el.close(); toast('Invoice deleted.'); pgSaved();
    }
  };
}

/* =========================================================
   Settings
   ========================================================= */
async function pgSettings() {
  setHeader('Settings', true);
  app.innerHTML = `<div class="stack">
    <section class="card"><h3>Invoice design</h3><div class="stack" id="styleList">${Object.entries(STYLES).map(([k, v]) => `<label class="li"><span class="l"><b>${esc(v.name)}</b><span>${esc(v.desc)}</span></span><input type="radio" name="sStyle" value="${k}" ${(S.invStyle || 'classic') === k ? 'checked' : ''} style="width:24px;height:24px;min-height:0;flex-shrink:0"></label>`).join('')}</div><p class="note" style="margin:10px 0 0">New invoices start with this design. You can change it on each invoice before saving.</p></section>
    <section class="card"><h3>Invoice numbering</h3>
      <div class="grid2"><label class="fld"><span>Default prefix</span><input id="sPrefix" value="${esc(S.prefix)}"></label><label class="fld"><span>Digits</span><select id="sPad">${opts([1, 2, 3, 4, 5, 6].map(n => [n, n]), S.pad)}</select></label></div>
      <label class="fld"><span>First number for new companies</span><input id="sStart" value="${esc(S.startNo)}" inputmode="numeric"></label>
      <p class="note">Example: <b id="ex"></b>. Each company keeps its own counter.</p></section>
    <section class="card"><h3>Default decimal precision</h3>
      <div class="grid2"><label class="fld"><span>Quantity</span><select id="sQ">${decOpts(S.dQty)}</select></label><label class="fld"><span>Rate</span><select id="sR">${decOpts(S.dRate)}</select></label></div>
      <label class="fld"><span>Amount</span><select id="sA">${decOpts(S.dAmt)}</select></label></section>
    <section class="card"><h3>Default GST</h3>
      <label class="check"><input type="checkbox" id="sGst" ${S.gstApplicable ? 'checked' : ''}> GST applicable on new invoices</label>
      <label class="fld"><span>Default GST rate</span><select id="sRate">${opts(GST_RATES.map(r => [r, r + '%']), S.gstRate)}</select></label></section>
    <section class="card"><h3>Defaults for new invoices</h3>
      <label class="fld"><span>Payment terms</span><textarea id="sPay">${esc(S.payTerms)}</textarea></label>
      <label class="fld"><span>Terms &amp; conditions</span><textarea id="sTerms">${esc(S.terms)}</textarea></label></section>
    <button class="btn primary block" id="sSave">Save settings</button>
    <section class="card"><h3>Backup</h3><p class="note">Everything is stored only on this phone. Export a backup file now and then, in case the phone’s browser data is cleared.</p>
      <div class="row wrap"><button class="btn" id="bExp">Export backup</button><label class="btn" for="bImp">Import backup</label><input type="file" id="bImp" accept="application/json" hidden></div></section></div>`;
  const ex = () => { $('#ex').textContent = ($('#sPrefix').value || '') + String(parseInt($('#sStart').value, 10) || 1).padStart(+$('#sPad').value, '0'); };
  ['sPrefix', 'sPad', 'sStart'].forEach(i => $('#' + i).addEventListener('input', ex)); ex();
  $('#sSave').onclick = async () => {
    const st = parseInt($('#sStart').value, 10); if (!(st >= 1)) return toast('First number must be 1 or more.');
    S.invStyle = $('input[name=sStyle]:checked')?.value || 'classic';
    Object.assign(S, { prefix: $('#sPrefix').value, pad: +$('#sPad').value, startNo: st, dQty: +$('#sQ').value, dRate: +$('#sR').value, dAmt: +$('#sA').value, gstApplicable: $('#sGst').checked, gstRate: +$('#sRate').value, payTerms: $('#sPay').value, terms: $('#sTerms').value });
    await saveSettings(); toast('Settings saved.');
  };
  $('#bExp').onclick = async () => {
    const data = {}; for (const s of ['companies', 'parties', 'products', 'invoices']) data[s] = await DB.all(s);
    data.settings = { ...S };
    download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `invoice-backup-${today()}.json`);
  };
  $('#bImp').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!confirm('Import this backup? Records with the same ID are replaced; everything else is kept.')) return;
      for (const s of ['companies', 'parties', 'products', 'invoices']) for (const o of d[s] || []) { if (s === 'invoices') { delete o.driveStatus; delete o.driveFileId; } await DB.put(s, o); }
      if (d.settings) { S = { ...S, ...d.settings }; await saveSettings(); }
      toast('Backup imported.'); pgSettings();
    } catch (err) { toast('That file is not a valid backup.'); }
  };
}
/* =========================================================
   Boot
   ========================================================= */
(async function boot() {
  try {
    await DB.open();
    const s = await DB.get('kv', 'settings'); S = { ...DEFAULTS, ...(s?.v || {}) };
    navigator.storage?.persist?.();
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});
    route();
  } catch (e) {
    app.innerHTML = `<div class="empty">This browser could not open local storage (${esc(e.message)}). Private browsing can cause this.</div>`;
  }
})();
