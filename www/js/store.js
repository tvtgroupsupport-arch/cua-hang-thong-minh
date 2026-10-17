/* Kho dữ liệu: toàn bộ dữ liệu nằm trong bộ nhớ (tra cứu tức thời), mỗi thay đổi được ghi bền vào
   IndexedDB theo từng bản ghi (không ghi lại cả khối lớn). Giao dịch (tx) có hoàn tác: lỗi giữa chừng thì
   mọi thay đổi trong tx được trả về như cũ — không bao giờ để hoá đơn "nửa vời" (trừ kho mà chưa lưu bill). */
import { uid } from './util.js';

export const COLLS = [
  'staff', 'categories', 'products', 'batches', 'stockMoves', 'customers', 'suppliers',
  'sales', 'returns', 'purchases', 'purchaseReturns', 'stocktakes', 'writeOffs', 'ledger',
  'shifts', 'cashEntries', 'cashCats', 'promos', 'holds', 'logs'
];
export const DB_VERSION = 1;
/* Đồng bộ nhiều máy (Supabase): bộ sưu tập nào được đồng bộ. Nhật ký và đơn treo là của riêng từng máy.
   Meta được đồng bộ: cài đặt cửa hàng, số dư quỹ ban đầu. Meta chỉ của máy này (không sao lưu, không đồng bộ): cấu hình kết nối, hàng đợi, bản nháp. */
export const SYNC_COLLS = COLLS.filter(c => c !== 'logs' && c !== 'holds');
const SYNC_SET = new Set(SYNC_COLLS);
export const SYNC_META = ['settings', 'openingBalance', 'license'];
export const LOCAL_META = ['sync', 'syncq', 'syncDraft', 'lastBackup', 'central', 'clockHw', 'trialStart'];

/* ---------- Adapter lưu trữ ---------- */
export function memoryAdapter() {
  const m = new Map();
  return {
    kind: 'memory',
    async load() { return [...m.entries()].map(([k, v]) => [k, v]); },
    async write(puts, dels) { for (const [k, v] of puts) m.set(k, JSON.parse(JSON.stringify(v))); for (const k of dels) m.delete(k); },
    async clear() { m.clear(); }
  };
}

export function idbAdapter(name = 'taphoa') {
  let db = null;
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('rec');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('IndexedDB bị chặn'));
  });
  return {
    kind: 'indexeddb',
    async load() {
      db = await open();
      return new Promise((res, rej) => {
        const out = [], cur = db.transaction('rec').objectStore('rec').openCursor();
        cur.onsuccess = () => { const c = cur.result; if (c) { out.push([c.key, c.value]); c.continue(); } else res(out); };
        cur.onerror = () => rej(cur.error);
      });
    },
    write(puts, dels) {
      return new Promise((res, rej) => {
        const tx = db.transaction('rec', 'readwrite'), st = tx.objectStore('rec');
        for (const [k, v] of puts) st.put(v, k);
        for (const k of dels) st.delete(k);
        tx.oncomplete = () => res();
        tx.onerror = tx.onabort = () => rej(tx.error || new Error('Ghi IndexedDB thất bại'));
      });
    },
    clear() {
      return new Promise((res, rej) => {
        const tx = db.transaction('rec', 'readwrite'); tx.objectStore('rec').clear();
        tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
      });
    }
  };
}

/* ---------- Kho ---------- */
const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

let GV = 0;   // bộ đếm phiên bản toàn cục: luôn tăng, không bao giờ trùng giữa các lần reset
export const S = {
  adapter: null,
  c: {},            // coll -> Map(id -> record)
  meta: {},         // khoá -> giá trị (cài đặt, bộ đếm…)
  ver: {},          // coll -> số phiên bản (để cache chỉ mục biết khi nào dựng lại)
  dirty: new Set(),
  txLog: null, txKeys: null,
  timer: null, flushing: null,
  persistError: null,
  session: { staffId: null },
  listeners: new Set(),
  syncOn: false,                 // đã bật đồng bộ → mọi thay đổi được đưa vào hàng đợi đẩy lên máy chủ
  syncQ: new Map(),              // 'coll/id' -> { c, i, x?, u? }  (x = bia mộ: bản ghi đã xoá)
  qDirty: false,

  reset() {
    this.c = {}; this.ver = {};
    for (const k of COLLS) { this.c[k] = new Map(); this.ver[k] = ++GV; }
    this.ver._meta = ++GV;
    this.meta = {}; this.dirty = new Set(); this.txLog = null; this.session = { staffId: null };
    this.syncOn = false; this.syncQ = new Map(); this.qDirty = false;
  },

  async init(adapter) {
    this.reset();
    this.adapter = adapter;
    const rows = await adapter.load();
    for (const [key, val] of rows) {
      const i = key.indexOf('/'), coll = key.slice(0, i), id = key.slice(i + 1);
      if (coll === '_meta') this.meta[id] = val;
      else if (this.c[coll]) this.c[coll].set(id, val);
    }
    if (this.meta.syncq) { for (const it of (this.meta.syncq.items || [])) this.syncQ.set(it.c + '/' + it.i, it); delete this.meta.syncq; }
    this.syncOn = !!(this.meta.sync && this.meta.sync.enabled);
    for (const k of COLLS) this.ver[k] = ++GV;
    this.ver._meta = ++GV;
  },

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  _emit() { for (const fn of this.listeners) { try { fn(); } catch (e) { console.error(e); } } },

  /* ---- đọc ---- */
  get(coll, id) { return this.c[coll].get(id) || null; },
  list(coll) { return Array.from(this.c[coll].values()); },
  count(coll) { return this.c[coll].size; },
  getMeta(k, def) { return this.meta[k] === undefined ? def : this.meta[k]; },

  /* ---- ghi (chỉ dùng trong engine) ---- */
  _log(coll, id, prev) {
    if (!this.txLog) return;
    const key = coll + '/' + id;
    if (this.txKeys.has(key)) return;
    this.txKeys.add(key); this.txLog.push({ coll, id, prev });
  },
  _dirty(coll, id, noSync) {
    this.ver[coll] = ++GV;
    this.dirty.add(coll + '/' + id);
    if (this.syncOn && !noSync && SYNC_SET.has(coll)) this._queue({ c: coll, i: id });
    if (!this.txLog) this._schedule();
  },
  _queue(item) { this.syncQ.set(item.c + '/' + item.i, item); this.qDirty = true; },
  /** Lấy bản ghi để SỬA TRỰC TIẾP; ghi nhớ bản cũ để hoàn tác nếu giao dịch lỗi. */
  mut(coll, id) {
    const rec = this.c[coll].get(id);
    if (!rec) throw new Error(`Không tìm thấy ${coll}/${id}`);
    this._log(coll, id, clone(rec));
    rec.updatedAt = Date.now();
    this._dirty(coll, id);
    return rec;
  },
  /** Sửa trường SUY RA (tồn kho, số dư nợ, điểm…): lưu bền nhưng KHÔNG đổi mốc updatedAt và KHÔNG đưa vào hàng đợi đồng bộ —
      các trường này được mỗi máy tự tính lại từ sổ biến động, nên hai máy cùng bán một mặt hàng không ghi đè nhau. */
  mutD(coll, id) {
    const rec = this.c[coll].get(id);
    if (!rec) throw new Error(`Không tìm thấy ${coll}/${id}`);
    this._log(coll, id, clone(rec));
    this._dirty(coll, id, true);
    return rec;
  },
  /** Áp bản ghi nhận từ máy chủ (rec = null: xoá). Lưu bền nhưng không đưa lại vào hàng đợi đẩy lên. */
  applyRemote(coll, id, rec) {
    if (rec === null) this.c[coll].delete(id); else this.c[coll].set(id, rec);
    this._dirty(coll, id, true);
  },
  add(coll, rec) {
    if (!rec.id) rec.id = uid();
    if (this.c[coll].has(rec.id)) throw new Error(`Trùng id ${coll}/${rec.id}`);
    rec.createdAt = rec.createdAt || Date.now();
    rec.updatedAt = Date.now();
    this._log(coll, rec.id, null);
    this.c[coll].set(rec.id, rec);
    this._dirty(coll, rec.id);
    return rec;
  },
  del(coll, id) {
    const rec = this.c[coll].get(id);
    if (!rec) return;
    this._log(coll, id, clone(rec));
    this.c[coll].delete(id);
    this._dirty(coll, id);
    if (this.syncOn && SYNC_SET.has(coll)) this._queue({ c: coll, i: id, x: true, u: Date.now() });   // bia mộ: báo các máy khác cũng xoá
  },
  setMeta(k, v) {
    this._log('_meta', k, this.meta[k] === undefined ? null : clone(this.meta[k]));
    this.meta[k] = v;
    this.ver._meta = ++GV;
    this.dirty.add('_meta/' + k);
    if (SYNC_META.includes(k)) {            // cài đặt dùng chung: nhớ mốc sửa để chọn bản mới hơn khi đồng bộ
      this._log('_meta', '_ts', this.meta._ts === undefined ? null : clone(this.meta._ts));
      this.meta._ts = Object.assign({}, this.meta._ts, { [k]: Date.now() }); this.dirty.add('_meta/_ts');
      if (this.syncOn) this._queue({ c: '_meta', i: k });
    }
    if (!this.txLog) this._schedule();
  },
  /** Áp cài đặt dùng chung nhận từ máy chủ (không đưa lại vào hàng đợi). */
  applyRemoteMeta(k, v, ts) {
    this.meta[k] = v; this.meta._ts = Object.assign({}, this.meta._ts, { [k]: ts });
    this.ver._meta = ++GV; this.dirty.add('_meta/' + k); this.dirty.add('_meta/_ts'); this._schedule();
  },
  setSyncOn(on) { this.syncOn = !!on; },
  /** Đưa TOÀN BỘ dữ liệu vào hàng đợi (lần đồng bộ đầu tiên của máy chủ, hoặc "đồng bộ lại toàn bộ"). */
  queueAll() {
    for (const c of SYNC_COLLS) for (const id of this.c[c].keys()) this._queue({ c, i: id });
    for (const k of SYNC_META) if (this.meta[k] !== undefined) this._queue({ c: '_meta', i: k });
    this._schedule();
  },
  /** Bộ đếm tăng dần theo tên: nextSeq('sale-20250101') -> 1,2,3… */
  nextSeq(name) {
    const seqs = Object.assign({}, this.getMeta('seq', {}));
    seqs[name] = (seqs[name] || 0) + 1;
    this.setMeta('seq', seqs);
    return seqs[name];
  },

  /** Giao dịch đồng bộ có hoàn tác. */
  tx(fn) {
    if (this.txLog) return fn();         // lồng nhau: giao dịch ngoài lo hoàn tác
    this.txLog = []; this.txKeys = new Set();
    try {
      const r = fn();
      this.txLog = null; this.txKeys = null;
      this._schedule(); this._emit();
      return r;
    } catch (e) {
      const log = this.txLog; this.txLog = null; this.txKeys = null;
      for (let i = log.length - 1; i >= 0; i--) {
        const { coll, id, prev } = log[i];
        if (coll === '_meta') { if (prev === null) delete this.meta[id]; else this.meta[id] = prev; this.dirty.add('_meta/' + id); this.ver._meta = ++GV; }
        else { if (prev === null) this.c[coll].delete(id); else this.c[coll].set(id, prev); this._dirty(coll, id); }
      }
      this._schedule();
      throw e;
    }
  },

  /* ---- ghi bền ---- */
  _schedule() {
    if (this.timer || !this.adapter) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 150);
  },
  async flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.flushing) { await this.flushing; }
    if ((!this.dirty.size && !this.qDirty) || !this.adapter) return;
    const keys = Array.from(this.dirty); this.dirty = new Set();
    const puts = [], dels = [];
    for (const key of keys) {
      const i = key.indexOf('/'), coll = key.slice(0, i), id = key.slice(i + 1);
      const v = coll === '_meta' ? this.meta[id] : this.c[coll].get(id);
      if (v === undefined || v === null) dels.push(key); else puts.push([key, v]);
    }
    const qWas = this.qDirty;
    if (qWas) { this.qDirty = false; puts.push(['_meta/syncq', { items: Array.from(this.syncQ.values()) }]); }     // hàng đợi đồng bộ cũng được lưu bền (tắt app giữa chừng không mất)
    this.flushing = this.adapter.write(puts, dels).then(() => { this.persistError = null; })
      .catch(e => { this.persistError = e; keys.forEach(k => this.dirty.add(k)); if (qWas) this.qDirty = true; console.error('Lỗi ghi dữ liệu', e); this._emit(); setTimeout(() => this._schedule(), 5000); })
      .finally(() => { this.flushing = null; });
    await this.flushing;
  },

  /* ---- sao lưu / khôi phục ---- */
  dump() {
    const collections = {};
    for (const k of COLLS) collections[k] = this.list(k);
    const meta = clone(this.meta); for (const k of LOCAL_META) delete meta[k];       // cấu hình kết nối đồng bộ chỉ thuộc máy này, không đưa vào tệp sao lưu
    return { app: 'taphoa', version: DB_VERSION, exportedAt: Date.now(), meta, collections };
  },
  async restore(dump) {
    if (!dump || dump.app !== 'taphoa' || !dump.collections) throw new Error('Tệp sao lưu không hợp lệ');
    const adapter = this.adapter, keep = {};
    for (const k of LOCAL_META) if (this.meta[k] !== undefined) keep[k] = this.meta[k];
    await this.flush();
    await adapter.clear();
    this.reset(); this.adapter = adapter;
    this.meta = Object.assign(clone(dump.meta || {}), keep);
    this.syncOn = !!(this.meta.sync && this.meta.sync.enabled);
    for (const k of COLLS) for (const r of (dump.collections[k] || [])) this.c[k].set(r.id, r);
    for (const k of COLLS) { this.ver[k] = ++GV; for (const id of this.c[k].keys()) this.dirty.add(k + '/' + id); }
    for (const k of Object.keys(this.meta)) this.dirty.add('_meta/' + k);
    await this.flush();
    this._emit();
  },
  async wipe() {
    const adapter = this.adapter;
    await this.flush();
    await adapter.clear();
    this.reset(); this.adapter = adapter;
    this._emit();
  }
};
S.reset();
