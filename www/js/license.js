/* Gói cước (tham khảo app BEPO). Nguồn sự thật: bảng subscriptions trên Supabase TRUNG TÂM (chỉ nhà cung cấp sửa được).
     • Máy chủ cửa hàng hỏi trung tâm (get_my_subscription), nhớ kết quả và ghi vào cài đặt dùng chung `license` để máy phụ biết hạn.
     • Chưa có tài khoản: dùng thử cục bộ localTrialDays ngày kể từ lần đầu chạy. Có tài khoản: hạn hiệu lực = hạn LỚN HƠN giữa gói và dùng thử cục bộ.
     • Hết hạn → KHOÁ MỀM: vẫn đăng nhập, xem và xuất báo cáo, vào được màn Gói cước; chỉ chặn thao tác phát sinh nghiệp vụ mới (bán, nhập kho, thu chi…).
     • Chống chỉnh lùi đồng hồ: lưu mốc thời gian lớn nhất từng thấy (kể cả giờ máy chủ) và luôn dùng mốc đó.
     • Chưa cấu hình máy chủ trung tâm (app-config.js trống) → app miễn phí, không khoá gì.
   Giới hạn thật: mã nguồn nằm trên máy khách nên người rành kỹ thuật vẫn gỡ được đoạn kiểm tra — đây là rào cản cơ bản, không phải chống crack tuyệt đối. */
import { S } from './store.js';
import { setWriteGuard } from './engine/auth.js';
import * as Central from './cloud/central.js';

const DAY = 86400000;
export const PLAN_MONTHS = [1, 6, 12];
let lastPersist = 0;

export const enabled = () => Central.configured();
export const trialDays = () => { const n = Number(Central.cfg().localTrialDays); return Number.isFinite(n) && n >= 0 ? n : 14; };

/** "Bây giờ" đáng tin: không bao giờ nhỏ hơn mốc lớn nhất từng thấy. */
export function now() {
  const t = Date.now(), hw = Number(S.meta.clockHw) || 0;
  if (t > hw) { if (t - lastPersist > 60000 || !hw) { lastPersist = t; S.setMeta('clockHw', t); } return t; }
  return hw;
}
function seeHw(ms) { if (Number.isFinite(ms) && ms > (Number(S.meta.clockHw) || 0)) S.setMeta('clockHw', ms); }

/** Gọi sau khi cửa hàng đã thiết lập: ghi mốc bắt đầu dùng thử cục bộ (một lần). */
export function ensureTrialStart() {
  if (!enabled() || S.meta.trialStart) return;
  S.setMeta('trialStart', now());
}

function current() {
  const lic = S.meta.license && S.meta.license.expires_at ? S.meta.license : null;
  const sync = S.meta.sync;
  const isSecondary = !!(sync && sync.enabled && sync.role !== 'owner');     // máy phụ: chỉ theo hạn của máy chủ cửa hàng
  const local = (!isSecondary && S.meta.trialStart) ? { plan_months: 0, status: 'trial', expires_at: S.meta.trialStart + trialDays() * DAY, local: true } : null;
  if (lic && local) return lic.expires_at >= local.expires_at ? lic : local;
  return lic || local || null;
}

export function status() {
  if (!enabled()) return { state: 'unknown', locked: false, enabled: false };
  const lic = current();
  if (!lic) return { state: 'unknown', locked: false, enabled: true };
  const left = lic.expires_at - now();
  const state = left <= 0 ? 'expired' : left < 7 * DAY ? 'expiring' : 'ok';
  return { enabled: true, state, locked: state === 'expired', daysLeft: Math.max(0, Math.ceil(left / DAY)), plan: lic.plan_months, kind: lic.local ? 'local' : lic.status, expiresAt: lic.expires_at, checkedAt: lic.checked_at || 0 };
}
export const locked = () => status().locked;

export function describe() {
  const s = status();
  if (!s.enabled) return 'Bản miễn phí — không giới hạn thời gian';
  if (s.state === 'unknown') return 'Chưa có thông tin gói cước';
  const kind = s.kind === 'local' ? 'Dùng thử' : s.kind === 'trial' ? 'Dùng thử (tài khoản)' : s.plan ? `Gói ${s.plan} tháng` : 'Gói cước';
  if (s.state === 'expired') return s.plan || s.kind === 'active' ? `${kind} — đã hết hạn` : 'Hết thời gian dùng thử — chưa đăng ký gói cước';
  return `${kind} — còn ${s.daysLeft} ngày (hết hạn ${new Date(s.expiresAt).toLocaleDateString('vi-VN')})`;
}

/** Hỏi trung tâm (chỉ máy chủ cửa hàng, đã đăng nhập). Mất mạng thì giữ kết quả cũ. Trả về status(). */
export async function refresh() {
  if (!enabled() || !Central.isSignedIn()) return status();
  const sync = S.meta.sync;
  if (sync && sync.enabled && sync.role !== 'owner') return status();
  try {
    const d = await Central.rpc('get_my_subscription');
    if (d && d.expires_at) {
      seeHw(Date.parse(d.server_now));
      const pub = { plan_months: d.plan_months, status: d.status, expires_at: Date.parse(d.expires_at), checked_at: Date.now() };
      const old = S.meta.license;
      if (!old || old.expires_at !== pub.expires_at || old.plan_months !== pub.plan_months || old.status !== pub.status) S.setMeta('license', pub);
      else S.meta.license = Object.assign({}, old, { checked_at: pub.checked_at });   // chỉ mốc kiểm tra thay đổi: không đẩy lên đồng bộ
    }
  } catch (e) { /* mất mạng / chưa đăng nhập: dùng bản đã nhớ */ }
  return status();
}

/** Bật khoá mềm cho lõi nghiệp vụ. Gọi một lần khi khởi động. */
export function init() {
  setWriteGuard(() => {
    const s = status();
    return s.locked ? 'Gói cước đã hết hạn — vào Thêm → Gói cước & tài khoản để gia hạn. (Vẫn xem và xuất báo cáo được.)' : '';
  });
}
