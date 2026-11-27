// GÖKTÜRK-1 · Geçiş öncesi hatırlatma (iPhone PWA)
// Takvim (.ics) alarmları uygulama kapalıyken de çalar; uygulama açıkken ayrıca anlık bildirim gösterilir.
(function () {
  'use strict';
  const KEY = 'gokturk1-reminders';
  const PRESETS = [60, 45, 30, 20, 15, 10, 5];
  const MIN = 60000, DAY = 86400000;
  const $r = id => document.getElementById(id);
  const tz = { timeZone: 'Europe/Istanbul' };
  const hhmm = d => new Intl.DateTimeFormat('tr-TR', { ...tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  const dayText = d => new Intl.DateTimeFormat('tr-TR', { ...tz, day: 'numeric', month: 'short', weekday: 'short' }).format(d);
  const istHour = d => +new Intl.DateTimeFormat('en-GB', { ...tz, hour: '2-digit', hourCycle: 'h23' }).format(d);
  const isMorning = d => { const h = istHour(d); return h >= 7 && h < 19; };
  const angle = v => v.toFixed(1).replace('.', ',') + '°';

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.leads)) return { morning: !!s.morning, evening: !!s.evening, leads: s.leads, days: s.days || 7, live: !!s.live };
    } catch (e) {}
    return { morning: true, evening: false, leads: [20, 15, 10], days: 7, live: false };
  }
  let cfg = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} }

  function parseLeads(text) {
    const out = [];
    String(text || '').split(/[^0-9]+/).forEach(x => { const n = parseInt(x, 10); if (n >= 1 && n <= 240 && !out.includes(n)) out.push(n); });
    return out;
  }
  const sortLeads = a => [...new Set(a)].sort((x, y) => y - x);

  // ---------- geçiş hesabı (ana koddaki propagate/observer/satrec kullanılır) ----------
  let memo = null;
  function computePasses(days) {
    if (typeof satrec === 'undefined' || !satrec) return [];
    const o = observer(), threshold = +$r('minEl').value || 0;
    const key = [o.lat, o.lon, threshold].join('|');
    if (memo && memo.rec === satrec && memo.key === key && memo.days >= days && Date.now() - memo.at < 10 * MIN) {
      const end = Date.now() + days * DAY;
      return memo.passes.filter(p => p.los > Date.now() - 20 * MIN && p.aos <= end);
    }
    const passes = scan(days, threshold);
    memo = { rec: satrec, key, days, at: Date.now(), passes };
    return passes;
  }
  function scan(days, threshold) {
    const start = Date.now() - 20 * MIN, end = Date.now() + days * DAY;
    const out = []; let cur = null;
    for (let t = start; t <= end + 900000; t += 5000) {
      const p = propagate(new Date(t)); if (!p) continue;
      const above = p.el >= threshold;
      if (above && !cur) cur = { aos: t, max: p.el };
      if (above && cur && p.el > cur.max) cur.max = p.el;
      if (!above && cur) { cur.los = t; if (cur.aos <= end) out.push(cur); cur = null; }
    }
    return out;
  }

  function selected(passes) {
    return passes.filter(p => isMorning(new Date(p.aos)) ? cfg.morning : cfg.evening);
  }

  function reminders(passes) {
    const list = [];
    selected(passes).forEach(p => cfg.leads.forEach(lead => list.push({ at: p.aos - lead * MIN, lead, pass: p })));
    return list.sort((a, b) => a.at - b.at);
  }

  // ---------- takvim (.ics) ----------
  const icsDate = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  function fold(line) {
    const enc = new TextEncoder(); const out = []; let cur = '', len = 0;
    for (const ch of line) {
      const n = enc.encode(ch).length;
      if (len + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; len = 0; }
      cur += ch; len += n;
    }
    out.push(cur);
    return out.join('\r\n ');
  }
  function buildIcs(passes) {
    const o = observer();
    const now = icsDate(Date.now());
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//GOKTURK-1 Gecis Takibi//TR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'X-WR-CALNAME:GÖKTÜRK-1 Geçişleri', 'X-WR-TIMEZONE:Europe/Istanbul'];
    selected(passes).forEach(p => {
      const morning = isMorning(new Date(p.aos));
      const title = '🛰️ GÖKTÜRK-1 · ' + (morning ? 'Sabah' : 'Akşam') + ' geçişi · Maks. ' + angle(p.max);
      const desc = 'Başlangıç (AOS) ' + hhmm(new Date(p.aos)) + ', bitiş (LOS) ' + hhmm(new Date(p.los)) +
        ', en yüksek açı ' + angle(p.max) + '.\nİstasyon ' + o.lat.toFixed(4) + '°, ' + o.lon.toFixed(4) + '°. TLE tahminidir.';
      L.push('BEGIN:VEVENT',
        'UID:gokturk1-' + Math.round(p.aos / 600000) + '-' + o.lat.toFixed(2) + '-' + o.lon.toFixed(2) + '@gokturk1-pwa',
        'DTSTAMP:' + now, 'DTSTART:' + icsDate(p.aos), 'DTEND:' + icsDate(p.los),
        'SUMMARY:' + esc(title), 'DESCRIPTION:' + esc(desc), 'LOCATION:' + esc('Ahlatlıbel · Ankara'),
        'TRANSP:TRANSPARENT', 'CATEGORIES:GÖKTÜRK-1');
      cfg.leads.forEach(lead => L.push('BEGIN:VALARM', 'ACTION:DISPLAY',
        'DESCRIPTION:' + esc('GÖKTÜRK-1 ' + lead + ' dk sonra geçiş · ' + hhmm(new Date(p.aos))),
        'TRIGGER:-PT' + lead + 'M', 'END:VALARM'));
      L.push('END:VEVENT');
    });
    L.push('END:VCALENDAR');
    return L.map(fold).join('\r\n') + '\r\n';
  }

  async function exportIcs() {
    const passes = computePasses(cfg.days);
    const sel = selected(passes);
    if (!cfg.leads.length) return status('Önce en az bir hatırlatma süresi seç.', true);
    if (!sel.length) return status('Seçtiğin aralıkta uygun geçiş yok.', true);
    const ics = buildIcs(passes);
    const name = 'gokturk1-gecisler.ics';
    const file = new File([ics], name, { type: 'text/calendar' });
    // iPhone: .ics dosyası Takvim'in "Tümünü Ekle" ekranını açar
    try {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url; a.download = name; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      status(sel.length + ' geçiş ve ' + (sel.length * cfg.leads.length) + ' alarm hazırlandı. Açılan ekranda "Tümünü Ekle"ye dokun.');
    } catch (e) {
      status('Takvim dosyası açılamadı: ' + e.message, true);
    }
    $r('remShare').hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
    lastFile = file;
  }
  let lastFile = null;
  async function shareIcs() {
    if (!lastFile) await exportIcs();
    try { await navigator.share({ files: [lastFile], title: 'GÖKTÜRK-1 geçişleri' }); } catch (e) {}
  }
  function openDataUrl() {
    const ics = buildIcs(computePasses(cfg.days));
    location.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
  }

  // ---------- uygulama açıkken anlık bildirim ----------
  let timers = [];
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  async function notify(r) {
    const p = r.pass;
    const left = Math.max(0, Math.round((p.aos - Date.now()) / MIN));
    const title = 'GÖKTÜRK-1 · ' + (left > 0 ? left + ' dk sonra geçiş' : 'Geçiş başlıyor');
    const body = (isMorning(new Date(p.aos)) ? 'Sabah' : 'Akşam') + ' geçişi ' + hhmm(new Date(p.aos)) + ' – ' + hhmm(new Date(p.los)) + ' · Maks. ' + angle(p.max);
    banner(title, body);
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const reg = await navigator.serviceWorker?.ready;
        if (reg) reg.showNotification(title, { body, icon: 'icon-192.png', tag: 'pass-' + p.aos });
        else new Notification(title, { body, icon: 'icon-192.png' });
      } catch (e) {}
    }
  }
  function armLive() {
    clearTimers();
    if (!cfg.live) return;
    const now = Date.now();
    reminders(computePasses(1)).forEach(r => {
      const wait = r.at - now;
      if (wait > 0 && wait < 2147483000) timers.push(setTimeout(() => notify(r), wait));
    });
  }
  async function toggleLive(on) {
    if (on && 'Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch (e) {}
    }
    cfg.live = on; save(); armLive(); render();
  }
  function banner(title, body) {
    const b = $r('remBanner');
    b.querySelector('b').textContent = title;
    b.querySelector('span').textContent = body;
    b.hidden = false;
    try { navigator.vibrate?.(300); } catch (e) {}
    clearTimeout(banner.t); banner.t = setTimeout(() => { b.hidden = true; }, 60000);
  }

  // ---------- arayüz ----------
  function status(text, error) {
    const el = $r('remStatus'); el.textContent = text; el.classList.toggle('error', !!error);
  }
  function render() {
    $r('remMorning').checked = cfg.morning;
    $r('remEvening').checked = cfg.evening;
    $r('remDays').value = cfg.days;
    $r('remLive').checked = cfg.live;
    document.querySelectorAll('#remChips .chip').forEach(ch => ch.classList.toggle('on', cfg.leads.includes(+ch.dataset.lead)));
    $r('remCustom').value = cfg.leads.filter(l => !PRESETS.includes(l)).join(', ');
    const passes = computePasses(2);
    const next = reminders(passes).find(r => r.at > Date.now());
    const which = cfg.morning && cfg.evening ? 'Sabah ve akşam geçişleri' : cfg.morning ? 'Sabah geçişleri' : cfg.evening ? 'Akşam geçişleri' : 'Geçiş seçilmedi';
    $r('remSummary').textContent = which + ' · ' + (cfg.leads.length ? cfg.leads.join(', ') + ' dk önce' : 'süre seçilmedi') +
      (next ? ' · Sıradaki hatırlatma ' + dayText(new Date(next.at)) + ' ' + hhmm(new Date(next.at)) + ' (' + next.lead + ' dk önce, geçiş ' + hhmm(new Date(next.pass.aos)) + ')' :
        (typeof satrec !== 'undefined' && satrec ? ' · Önümüzdeki 2 günde uygun geçiş yok' : ' · TLE bekleniyor'));
    const iosNoPush = !('Notification' in window);
    $r('remLiveNote').textContent = iosNoPush
      ? 'Bu tarayıcı bildirim desteklemiyor. iPhone\'da uygulamayı Ana Ekran\'dan açtığında (iOS 16.4+) çalışır; yine de sadece uygulama açıkken.'
      : 'Sadece uygulama açıkken çalışır. Kapalıyken haber almak için takvime ekle.';
  }
  function readForm() {
    cfg.morning = $r('remMorning').checked;
    cfg.evening = $r('remEvening').checked;
    cfg.days = Math.max(1, Math.min(14, +$r('remDays').value || 7));
    const chips = [...document.querySelectorAll('#remChips .chip.on')].map(c => +c.dataset.lead);
    cfg.leads = sortLeads([...chips, ...parseLeads($r('remCustom').value)]);
    save(); armLive(); render();
  }

  function init() {
    $r('remChips').innerHTML = PRESETS.map(l => '<button type="button" class="chip" data-lead="' + l + '">' + l + ' dk</button>').join('');
    document.querySelectorAll('#remChips .chip').forEach(ch => ch.addEventListener('click', () => { ch.classList.toggle('on'); readForm(); }));
    ['remMorning', 'remEvening', 'remDays', 'remCustom'].forEach(id => $r(id).addEventListener('change', readForm));
    $r('remIcs').addEventListener('click', exportIcs);
    $r('remShare').addEventListener('click', shareIcs);
    $r('remData').addEventListener('click', openDataUrl);
    $r('remLive').addEventListener('change', e => toggleLive(e.target.checked));
    $r('remBanner').addEventListener('click', () => { $r('remBanner').hidden = true; });
    render(); armLive();
    // TLE / istasyon / eşik değişince yeniden hesapla
    if (typeof renderPasses === 'function') {
      const orig = renderPasses;
      renderPasses = function () { orig.apply(this, arguments); render(); armLive(); };
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); armLive(); } });
  }

  // Test için dışa açılan küçük arayüz
  window.gokturkReminders = { computePasses, buildIcs, reminders, get cfg() { return cfg; }, set cfg(v) { cfg = v; } };
  init();
})();
