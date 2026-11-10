// ==========================================
// CONFIG.JS - Central Configuration V12.1
// ==========================================
// ไฟล์นี้เก็บค่าตั้งต้นที่ใช้ร่วมกันทั้งระบบ
// - โหลดก่อน app.js และ report.html script หลัก
// - ถ้าไฟล์นี้โหลดไม่ได้ ทุกไฟล์จะมี fallback ในตัว
// ==========================================

window.APP_CONFIG = {
    // URL ของ Google Apps Script (Web App)
    // ⚠️ ถ้า redeploy Apps Script → อัปเดต URL ที่นี่ที่เดียว
    API_URL: 'https://script.google.com/macros/s/AKfycbxbF133aAvEfhFB-Pqxco2ZG_dHS4J3rtDhei-8SIkguAHSf32IAoU4yw74GIv_NoVQ7w/exec',

    // Version (ใช้ debug / log)
    VERSION: '12.1',
    BUILD_DATE: '2026-11-06',

    // ค่าคงที่ของโดเมน (ใช้ทั่วระบบ)
    NOISE_LIMIT_DBA: 85,      // มาตรฐาน TWA (dBA)
    STS_SHIFT_DB: 15,         // เกณฑ์ STS (dB)
    METER_CEILING_DBA: 120,   // เพดานหลอดวัดในการ์ดเสียง
    CRITICAL_FREQS: ['r500','r1000','r2000','r3000','r4000','r6000',
                     'l500','l1000','l2000','l3000','l4000','l6000'],
    ALL_FREQS: ['r500','r1000','r2000','r3000','r4000','r6000','r8000',
                'l500','l1000','l2000','l3000','l4000','l6000','l8000'],

    // ⚠️ ไม่ใช้แล้ว — ปล่อยไว้ backward-compat
    // BRANCHES: ['ALL', '1', '2', '3'],   // ← populate จาก employees แทน

    // ป้ายข้อความ (ใช้ซ้ำได้)
    LABELS: {
        PASS: 'ผ่าน',
        FAIL: 'ไม่ผ่าน',
        RISK: 'เสี่ยง',
        SAFE: 'ปลอดภัย',
        NO_DATA: '-',
        NORMAL: 'ปกติ',
        OCCUPATIONAL: 'จากงาน',
        NATURAL: 'ตามธรรมชาติ',
        UNDETERMINED: 'ไม่ทราบสาเหตุ',
        UNTESTED: 'ยังไม่ได้ตรวจ'
    },

    // Helper functions (เรียกใช้ได้ทุกที่)
    helpers: {
        // ตรวจว่า TWA เกินมาตรฐานหรือไม่
        isRisk: function (twa) {
            return Number(twa) >= window.APP_CONFIG.NOISE_LIMIT_DBA;
        },

        // คืน class/สีตาม TWA
        getRiskColor: function (twa) {
            return window.APP_CONFIG.helpers.isRisk(twa)
                ? 'var(--danger)'
                : 'var(--success)';
        },

        // คืน label ผลประเมิน
        getResultLabel: function (twa) {
            return window.APP_CONFIG.helpers.isRisk(twa)
                ? window.APP_CONFIG.LABELS.FAIL
                : window.APP_CONFIG.LABELS.PASS;
        },

        // แปลงปี CE → BE
        toBE: function (year) {
            const y = Number(year);
            if (isNaN(y) || y === 0) return '-';
            return y >= 2400 ? y : y + 543;
        },

        // แปลงปี BE → CE
        toCE: function (yearBE) {
            const y = Number(yearBE);
            if (isNaN(y) || y === 0) return null;
            return y >= 2400 ? y - 543 : y;
        }
    }
};

// ✅ log สั้นๆ ตอนโหลด (ช่วย debug)
(function () {
    const cfg = window.APP_CONFIG;
    const url = cfg.API_URL || '';
    const truncated = url.length > 60 ? url.slice(0, 60) + '...' : url;
    console.info(
        `[config.js] V${cfg.VERSION} | API_URL = ${truncated} | ` +
        `NOISE_LIMIT = ${cfg.NOISE_LIMIT_DBA} dBA | STS = ${cfg.STS_SHIFT_DB} dB`
    );
})();