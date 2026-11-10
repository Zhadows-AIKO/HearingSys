// ==========================================
// APP.JS - Core Functions & Global Variables
// V12.1 (Config-Linked)
// ==========================================

const CFG = window.APP_CONFIG || {};
const API_URL = CFG.API_URL || 'https://script.google.com/macros/s/AKfycbxbF133aAvEfhFB-Pqxco2ZG_dHS4J3rtDhei-8SIkguAHSf32IAoU4yw74GIv_NoVQ7w/exec';

// Global state
let departmentCache = [];
let currentEmpData = null;
let currentHistoryData = [];
let dashboardLoadedOnce = false;
// Cache สำหรับเก็บข้อมูลที่โหลดมาแล้ว
window.APP_CACHE = {
    employees: null,
    mapping: null,
    noise: null,
    assessment: null,
    lastFetch: 0 // เวลาที่โหลดล่าสุด
};

// ==========================================
// Helper: แปลงปี ค.ศ. <-> พ.ศ. (ใช้ Helper จาก config ถ้ามี)
// ==========================================
function toBE(year) {
    if (CFG.helpers && CFG.helpers.toBE) return CFG.helpers.toBE(year);
    const y = Number(year);
    if (isNaN(y) || y === 0) return '-';
    return y >= 2400 ? y : y + 543;
}

function toCE(yearBE) {
    if (CFG.helpers && CFG.helpers.toCE) return CFG.helpers.toCE(yearBE);
    const y = Number(yearBE);
    if (isNaN(y) || y === 0) return null;
    return y >= 2400 ? y - 543 : y;
}

// ==========================================
// Loader
// ==========================================
function showLoader() {
    const el = document.getElementById('loader');
    if (el) el.style.display = 'flex';
}
function hideLoader() {
    const el = document.getElementById('loader');
    if (el) el.style.display = 'none';
}

// ==========================================
// Helpers: ปี พ.ศ. / อายุ / วันที่
// ==========================================
function calculateBEYear(dateString, targetInputId) {
    const target = document.getElementById(targetInputId);
    if (!target) return;
    if (!dateString) { target.value = ''; return; }
    const ceYear = parseInt(dateString.split('-')[0], 10);
    target.value = isNaN(ceYear) ? '' : ceYear + 543;
}

function calculateAge(birthDate, targetInputId) {
    const target = document.getElementById(targetInputId);
    if (!target) return;
    if (!birthDate) { target.value = ''; return; }

    const today = new Date();
    const birth = new Date(birthDate);
    if (isNaN(birth.getTime())) { target.value = ''; return; }

    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;

    target.value = age >= 0 ? age : '';
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const clean = String(dateStr).split('T')[0];
    const parts = clean.split('-');
    if (parts.length !== 3) return dateStr;
    const [y, m, d] = parts;
    const yBE = Number(y) >= 2400 ? Number(y) : Number(y) + 543;
    return `${d}/${m}/${yBE}`;
}

// ==========================================
// Page switching
// ==========================================
function switchPage(pageId, element) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-menu a').forEach(a => a.classList.remove('active'));

    const page = document.getElementById(`page-${pageId}`);
    if (page) page.classList.add('active');
    if (element) element.classList.add('active');

    const titles = {
        dashboard: { icon: 'fa-chart-pie', text: 'มาตรการอนุรักษ์การได้ยิน SSSC' },
        noise:     { icon: 'fa-volume-high', text: 'ข้อมูลเสียงพื้นที่' },
        employee:  { icon: 'fa-user-doctor', text: 'ข้อมูลพนักงาน' }
    };
    const t = titles[pageId] || { icon: 'fa-shield-halved', text: '' };
    const titleEl = document.getElementById('pageTitle');
    if (titleEl) titleEl.innerHTML = `<i class="fa-solid ${t.icon}" style="color:var(--accent)"></i> ${t.text}`;

    if (pageId === 'dashboard' && typeof loadDashboard === 'function') {
        if (!dashboardLoadedOnce) {
            loadDashboard();
            dashboardLoadedOnce = true;
        }
    }
    if (pageId === 'noise' && typeof loadNoiseData === 'function') loadNoiseData();
    if (pageId === 'employee' && typeof initEmployeePage === 'function') {
        currentEmpData = null;
        currentHistoryData = [];
        initEmployeePage();
    }
}

// ==========================================
// Init
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const dateEl = document.getElementById('currentDate');
    if (dateEl) {
        dateEl.innerText = new Date().toLocaleDateString('th-TH', {
            year: 'numeric', month: 'long', day: 'numeric'
        });
    }

    setTimeout(() => {
        const firstLink = document.querySelector('.nav-menu a');
        if (firstLink) firstLink.click();
    }, 0);
});