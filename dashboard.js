// ==========================================
// DASHBOARD.JS - Executive Dashboard V15.6 (Bug-fixed)
// การเปลี่ยนแปลงจาก V15.5:
//  [FIX-1] ย้ายการวาดกราฟ Trend ออกจากลูป forEach (เดิมสร้างซ้ำทุกพนักงาน)
//  [FIX-2] แก้การคำนวณ shift: รับค่า 0/ลบ, กัน worstFreq='-', ไม่ให้ shift ติดลบ
//  [FIX-3] แยกนับ "พนักงานในพื้นที่เสียง" vs "พนักงานมี STS ≥ 15 dB"
//  [FIX-4] กันชื่อพนักงานเป็น undefined
//  [FIX-5] เปลี่ยนปี -> ตรวจ cache ก่อน reload
//  [FIX-6] เลือก noise record แบบ worst-case (TWA สูงสุด) แทน .find() ตัวแรก
//  [FIX-7] กรณีไม่มีข้อมูลเพียงพอสำหรับ trend chart
// ==========================================

const NOISE_LIMIT = (window.APP_CONFIG && window.APP_CONFIG.NOISE_LIMIT_DBA) || 85;
const STS_LIMIT   = (window.APP_CONFIG && window.APP_CONFIG.STS_SHIFT_DB) || 15;

let globalDashboardData = { employees: [], tests: [], noise: [], mapping: [], actions: [] };
let selectedDashboardYear = null;

const DASHBOARD_CACHE_KEY  = 'dashboard_cache_v5';
const DASHBOARD_CACHE_TIME = 5 * 60 * 1000;

// ==========================================
// Helpers
// ==========================================
function safeJson(res) {
    try { return res.json(); } catch (e) { return { success: false, data: [] }; }
}
function asArray(x) { return Array.isArray(x) ? x : []; }
function normalizePointKey(s) {
    return String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');
}
function buildFullName(emp) {
    if (!emp) return '(ไม่ระบุชื่อ)';
    const name = [emp.title, emp.first_name, emp.last_name]
        .filter(v => v !== null && v !== undefined && String(v).trim() !== '')
        .join(' ')
        .trim();
    return name || '(ไม่ระบุชื่อ)';
}
function isBlank(v) {
    return v === null || v === undefined || String(v).trim() === '';
}

// ==========================================
// 1. โหลดข้อมูลหลัก
// ==========================================
async function loadDashboard() {
    const cachedData = sessionStorage.getItem(DASHBOARD_CACHE_KEY);

    if (cachedData) {
        try {
            const parsed = JSON.parse(cachedData);
            if (Date.now() - parsed.timestamp < DASHBOARD_CACHE_TIME) {
                globalDashboardData = parsed.data;
                initDashboardYearDropdown();
                renderDashboardUI();
                return;
            }
        } catch (e) {
            sessionStorage.removeItem(DASHBOARD_CACHE_KEY);
        }
    }

    showLoader();
    try {
        const t = Date.now();
        const results = await Promise.allSettled([
            fetch(API_URL + '?action=getEmployees&t=' + t).then(safeJson),
            fetch(API_URL + '?action=getHearingTests&t=' + t).then(safeJson),
            fetch(API_URL + '?action=getNoiseSurveys&t=' + t).then(safeJson),
            fetch(API_URL + '?action=getLocationMapping&t=' + t).then(safeJson),
            fetch(API_URL + '?action=getMedicalActions&t=' + t).then(safeJson)
        ]);

        globalDashboardData = {
            employees: asArray(results[0].status === 'fulfilled' ? results[0].value?.data : []),
            tests:     asArray(results[1].status === 'fulfilled' ? results[1].value?.data : []),
            noise:     asArray(results[2].status === 'fulfilled' ? results[2].value?.data : []),
            mapping:   asArray(results[3].status === 'fulfilled' ? results[3].value?.data : []),
            actions:   asArray(results[4].status === 'fulfilled' ? results[4].value?.data : [])
        };

        sessionStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify({
            timestamp: Date.now(),
            data: globalDashboardData
        }));

        initDashboardYearDropdown();
        renderDashboardUI();
    } catch (e) {
        console.error(e);
        alert('ไม่สามารถเชื่อมต่อฐานข้อมูลได้');
    } finally {
        hideLoader();
    }
}

// ==========================================
// 2. Dropdown ปี
// ==========================================
function initDashboardYearDropdown() {
    const selectEl = document.getElementById('dashboardYearSelect');
    if (!selectEl) return;

    const years = new Set();
    globalDashboardData.noise.forEach(n => {
        if (n.survey_year) years.add(Number(n.survey_year));
    });

    const sortedYears = Array.from(years).sort((a, b) => b - a);

    if (!selectedDashboardYear || !years.has(Number(selectedDashboardYear))) {
        selectedDashboardYear = sortedYears.length > 0 ? sortedYears[0] : new Date().getFullYear() + 543;
    }

    let html = '';
    sortedYears.forEach(y => {
        html += `<option value="${y}" ${String(y) === String(selectedDashboardYear) ? 'selected' : ''}>ปี พ.ศ. ${y}</option>`;
    });
    if (sortedYears.length === 0) {
        html = `<option value="${selectedDashboardYear}">ปี พ.ศ. ${selectedDashboardYear}</option>`;
    }
    selectEl.innerHTML = html;
}

function changeDashboardYear(year) {
    selectedDashboardYear = year;
    // [FIX-5] ถ้าปีที่เลือกไม่มีใน cache ปัจจุบัน ให้ลองโหลดใหม่
    const cachedYears = new Set((globalDashboardData.noise || []).map(n => Number(n.survey_year)));
    if (cachedYears.size > 0 && !cachedYears.has(Number(year))) {
        sessionStorage.removeItem(DASHBOARD_CACHE_KEY);
        loadDashboard();
        return;
    }
    renderDashboardUI();
}

// ==========================================
// 3. คำนวณข้อมูล + วาด UI
// ==========================================
function renderDashboardUI() {
    const { employees, tests, noise, actions } = globalDashboardData;
    const activeEmps = employees.filter(emp => emp.status === 'Active');

    const currentYearNoise = noise.filter(n => Number(n.survey_year) === Number(selectedDashboardYear));
    const currentYearActions = actions.filter(a => {
        const yearBE = a.action_date ? (new Date(a.action_date).getFullYear() + 543) : 0;
        return yearBE === Number(selectedDashboardYear);
    });

    // หาจุดตรวจที่เสี่ยงในปีนี้
    const noisyPointsInYear = new Set();
    currentYearNoise.forEach(n => {
        if (Number(n.twa_dba) >= NOISE_LIMIT) {
            noisyPointsInYear.add(normalizePointKey(n.measurement_point));
        }
    });

    // --- 1. คำนวณ KPI & Top 5 ---
    let empInNoiseAreaCount = 0;
    const riskEmpsList = [];

    activeEmps.forEach(emp => {
        const empPoint = normalizePointKey(emp.measurement_point);
        if (!noisyPointsInYear.has(empPoint)) return;

        empInNoiseAreaCount++;

        // [FIX-6] เลือก record worst-case (TWA สูงสุด) ของจุดนั้น
        const pointNoiseRecords = currentYearNoise.filter(
            n => normalizePointKey(n.measurement_point) === empPoint
        );
        let pointTwa = null;
        let pointInEar = null;
        if (pointNoiseRecords.length > 0) {
            const worst = pointNoiseRecords.reduce((max, cur) =>
                Number(cur.twa_dba) > Number(max.twa_dba) ? cur : max
            );
            pointTwa = Number(worst.twa_dba);
            if (!isBlank(worst.noise_in_ear) && !isNaN(worst.noise_in_ear)) {
                pointInEar = Number(worst.noise_in_ear);
            }
        }

        // ผลตรวจหูของพนักงาน
        const empTests = tests.filter(t =>
            String(t.emp_id) === String(emp.emp_id) &&
            Number(t.exam_year) <= Number(selectedDashboardYear)
        );

        let baselineVal = '-', latestVal = '-', shiftVal = 0, worstFreqStr = '-', bYear = '-', lYear = '-';

        if (empTests.length > 0) {
            const sorted = empTests.slice().sort((a, b) => Number(a.exam_year) - Number(b.exam_year));
            const baseline = sorted[0];
            const latest = sorted[sorted.length - 1];

            const freqs = ['r500','r1000','r2000','r3000','r4000','r6000',
                           'l500','l1000','l2000','l3000','l4000','l6000'];
            let maxShift = -Infinity;
            let worstFreq = null;

            freqs.forEach(f => {
                const bRaw = baseline[f];
                const lRaw = latest[f];
                // [FIX-2] กันค่าว่างเท่านั้น (ยอมรับ 0 และค่าลบ)
                if (isBlank(bRaw) || isBlank(lRaw)) return;
                const bVal = Number(bRaw);
                const lVal = Number(lRaw);
                if (isNaN(bVal) || isNaN(lVal)) return;

                const diff = lVal - bVal;
                if (diff > maxShift) {
                    maxShift = diff;
                    worstFreq = f;
                }
            });

            if (worstFreq !== null) {
                // [FIX-2] shift ติดลบ = ดีขึ้น → แสดงเป็น 0
                shiftVal = maxShift > 0 ? maxShift : 0;
                const earLabel = worstFreq.startsWith('r') ? 'ขวา' : 'ซ้าย';
                const freqNum = worstFreq.slice(1);
                worstFreqStr = `${earLabel} ${freqNum} Hz`;
                baselineVal = baseline[worstFreq] ?? '-';
                latestVal = latest[worstFreq] ?? '-';
            }
            bYear = baseline.exam_year;
            lYear = latest.exam_year;
        }

        riskEmpsList.push({
            emp_id: emp.emp_id,
            // [FIX-4] ใช้ buildFullName กัน undefined
            name: buildFullName(emp),
            dept: emp.department || '-',
            shift: shiftVal,
            isSTS: shiftVal >= STS_LIMIT,
            point: emp.measurement_point || '-',
            baselineYear: bYear,
            latestYear: lYear,
            baselineVal,
            latestVal,
            worstFreq: worstFreqStr,
            pointTwa,
            pointInEar
        });
    });

    const empWithSTSCount = riskEmpsList.filter(e => e.isSTS).length;

    // [FIX-1] กราฟ Trend วาดนอก forEach
    renderTrendChart(noise, activeEmps);

    // --- อัปเดต KPI ---
    document.getElementById('kpiTotalEmp').innerText = activeEmps.length;

    // [FIX-3] KPI ใช้ STS เป็นตัวหลัก, sub แสดงจำนวนในพื้นที่เสียง
    document.getElementById('kpiRiskEmp').innerText = empWithSTSCount;
    const riskSub = document.getElementById('kpiRiskEmp').parentElement.querySelector('.kpi-sub');
    if (riskSub) {
        riskSub.innerText = `Shift ≥ ${STS_LIMIT} dB (ในพื้นที่เสียง ${empInNoiseAreaCount} คน)`;
    }

    const noiseEl = document.getElementById('kpiNoiseAreas');
    const noiseSub = noiseEl.parentElement.querySelector('.kpi-sub');
    if (currentYearNoise.length === 0) {
        noiseEl.innerText = '-';
        if (noiseSub) noiseSub.innerText = 'ไม่มีข้อมูลตรวจวัดในปีนี้';
    } else {
        noiseEl.innerText = noisyPointsInYear.size;
        if (noiseSub) noiseSub.innerText = 'จุดตรวจที่ TWA ≥ 85 dBA';
    }

    const totalActions = currentYearActions.length;
    const completedActions = currentYearActions.filter(a =>
        a.completed_date && String(a.completed_date).trim() !== ''
    ).length;
    const actionPercent = totalActions > 0 ? Math.round((completedActions / totalActions) * 100) : 0;
    document.getElementById('kpiActionProgress').innerText = `${actionPercent}%`;

    // --- Alert ---
    const alertBox = document.getElementById('alertBox');
    if (alertBox) {
        if (empInNoiseAreaCount > 0) {
            alertBox.style.display = 'flex';
            document.getElementById('alertMessage').innerHTML =
                `พบพนักงาน <strong>${empInNoiseAreaCount} คน</strong> ทำงานในพื้นที่เสียง ≥ ${NOISE_LIMIT} dBA ในปี พ.ศ. ${selectedDashboardYear}`;
        } else {
            alertBox.style.display = 'none';
        }
    }

    // --- Heatmap ---
    renderHeatmap(currentYearNoise, activeEmps);

    // --- Action Status ---
    renderActionStatus(currentYearActions, totalActions, completedActions, actionPercent);

    // --- Top 5 Risk Table ---
    renderTopRiskTable(riskEmpsList);
}

// ==========================================
// 3.1 กราฟ Trend (แยกฟังก์ชัน)
// ==========================================
function renderTrendChart(noise, activeEmps) {
    const trendCanvas = document.getElementById('riskTrendChart');
    if (!trendCanvas) return;

    const allNoiseYears = [...new Set(noise.map(n => Number(n.survey_year)))]
        .filter(y => !isNaN(y))
        .sort((a, b) => a - b);

    const selectedYr = Number(selectedDashboardYear);
    const validYears = allNoiseYears.filter(y => y <= selectedYr).slice(-5);

    // [FIX-7] ไม่มีข้อมูลเพียงพอ
    if (validYears.length === 0) {
        if (window.riskTrendChartInstance) {
            window.riskTrendChartInstance.destroy();
            window.riskTrendChartInstance = null;
        }
        const wrapper = trendCanvas.parentElement;
        if (wrapper) {
            wrapper.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted);"><i class="fa-solid fa-chart-line fa-2x"></i><br>ยังไม่มีข้อมูลเพียงพอสำหรับแสดงแนวโน้ม</div>';
        }
        return;
    }

    const labels = [];
    const dataCounts = [];

    validYears.forEach(yr => {
        labels.push(`ปี ${yr}`);
        const noiseInYr = noise.filter(n => Number(n.survey_year) === yr);
        const noisyPts = new Set();
        noiseInYr.forEach(n => {
            if (Number(n.twa_dba) >= NOISE_LIMIT) noisyPts.add(normalizePointKey(n.measurement_point));
        });
        let count = 0;
        activeEmps.forEach(emp => {
            if (noisyPts.has(normalizePointKey(emp.measurement_point))) count++;
        });
        dataCounts.push(count);
    });

    if (typeof Chart === 'undefined') return;
    if (window.riskTrendChartInstance) window.riskTrendChartInstance.destroy();

    const ctx = trendCanvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(239, 68, 68, 0.4)');
    gradient.addColorStop(1, 'rgba(239, 68, 68, 0.05)');

    window.riskTrendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'จำนวนพนักงานกลุ่มเสี่ยง (คน)',
                data: dataCounts,
                borderColor: '#ef4444',
                backgroundColor: gradient,
                borderWidth: 3,
                pointBackgroundColor: '#ffffff',
                pointBorderColor: '#ef4444',
                pointBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 7,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    titleFont: { family: 'Kanit', size: 14 },
                    bodyFont: { family: 'Sarabun', size: 14 },
                    padding: 10,
                    cornerRadius: 8,
                    displayColors: false
                }
            },
            scales: {
                x: { grid: { display: false }, ticks: { font: { family: 'Sarabun' } } },
                y: {
                    beginAtZero: true,
                    grid: { color: '#f1f5f9', drawBorder: false },
                    ticks: {
                        stepSize: 1,
                        font: { family: 'Sarabun' },
                        callback: v => v + ' คน'
                    }
                }
            }
        }
    });
}

// ==========================================
// 3.2 Heatmap
// ==========================================
function renderHeatmap(currentYearNoise, activeEmps) {
    const heatmapContainer = document.getElementById('heatmapContainer');
    if (!heatmapContainer) return;

    if (currentYearNoise.length === 0) {
        heatmapContainer.innerHTML = '<div style="color:var(--text-muted); padding: 20px; text-align:center;"><i class="fa-solid fa-folder-open"></i> ไม่มีข้อมูลตรวจวัดเสียงในปีนี้</div>';
        return;
    }

    const pointData = {};
    currentYearNoise.forEach(n => {
        const pt = n.measurement_point;
        if (!pt) return;
        if (!pointData[pt]) pointData[pt] = [];
        pointData[pt].push(Number(n.twa_dba));
    });

    let html = '';
    Object.keys(pointData).sort().forEach(pt => {
        const maxTwa = Math.max(...pointData[pt]);
        const isDanger = maxTwa >= NOISE_LIMIT;
        const isWarning = maxTwa >= 80 && maxTwa < NOISE_LIMIT;

        const empCount = activeEmps.filter(e =>
            normalizePointKey(e.measurement_point) === normalizePointKey(pt)
        ).length;

        let bgClass = 'safe';
        if (isDanger) bgClass = 'danger';
        else if (isWarning) bgClass = 'warning';

        html += `
            <div class="heatmap-card ${bgClass}" title="จุดตรวจ: ${pt}\nค่า TWA: ${maxTwa} dBA\nพนักงาน: ${empCount} คน">
                <div class="heatmap-point">${pt}</div>
                <div class="heatmap-value">${maxTwa}</div>
                <div class="heatmap-emp"><i class="fa-solid fa-users"></i> ${empCount}</div>
            </div>
        `;
    });
    heatmapContainer.innerHTML = html;
}

// ==========================================
// 3.3 Action Status
// ==========================================
function renderActionStatus(currentYearActions, totalActions, completedActions, actionPercent) {
    const actionContainer = document.getElementById('actionStatusContainer');
    if (!actionContainer) return;

    if (totalActions === 0) {
        actionContainer.innerHTML = '<div style="color:var(--text-muted); padding: 20px; text-align:center;"><i class="fa-solid fa-check-circle"></i> ไม่มีมาตรการในปีนี้</div>';
        return;
    }

    const types = ['แจ้งผลพนักงาน', 'นัดตรวจยืนยัน (Confirm)', 'จ่าย PPE'];
    let progressHtml = `
        <div style="margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center;">
            <span style="font-weight: bold; color: var(--primary);">ภาพรวมความคืบหน้า</span>
            <span style="font-weight: bold; font-size: 1.2rem; color: ${actionPercent === 100 ? 'var(--success)' : 'var(--warning)'}">${completedActions}/${totalActions} รายการ</span>
        </div>
        <div style="width: 100%; height: 12px; background: #e2e8f0; border-radius: 10px; overflow: hidden; margin-bottom: 25px;">
            <div style="width: ${actionPercent}%; height: 100%; background: ${actionPercent === 100 ? 'var(--success)' : 'var(--accent)'}; transition: width 0.5s;"></div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 15px;">
    `;

    types.forEach(type => {
        const actsOfType = currentYearActions.filter(a => a.action_type === type);
        if (actsOfType.length === 0) return;
        const done = actsOfType.filter(a => a.completed_date && String(a.completed_date).trim() !== '').length;
        const pct = Math.round((done / actsOfType.length) * 100);
        progressHtml += `
            <div>
                <div style="display: flex; justify-content: space-between; font-size: 0.9rem; margin-bottom: 5px;">
                    <span>${type}</span>
                    <span style="font-weight: bold;">${done}/${actsOfType.length}</span>
                </div>
                <div style="width: 100%; height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden;">
                    <div style="width: ${pct}%; height: 100%; background: var(--primary);"></div>
                </div>
            </div>
        `;
    });

    progressHtml += '</div>';
    actionContainer.innerHTML = progressHtml;
}

// ==========================================
// 3.4 Top 5 Risk Table
// ==========================================
function renderTopRiskTable(riskEmpsList) {
    const topRiskContainer = document.getElementById('topRiskTableContainer');
    if (!topRiskContainer) return;

    riskEmpsList.sort((a, b) => b.shift - a.shift);
    const top5 = riskEmpsList.slice(0, 5);

    if (top5.length === 0) {
        topRiskContainer.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--success);"><i class="fa-solid fa-check-circle"></i> ไม่มีพนักงานในพื้นที่เสียงดังในปีนี้</div>';
        return;
    }

    let tableHtml = `
        <table>
            <thead>
                <tr>
                    <th style="text-align: center; width: 50px;">อันดับ</th>
                    <th>รหัสพนักงาน</th>
                    <th>ชื่อ-นามสกุล</th>
                    <th>แผนก</th>
                    <th>จุดตรวจ (Point)</th>
                    <th style="text-align: center;">ระดับเสียงจุดตรวจ<br>(TWA)</th>
                    <th style="text-align: center;">ระดับเสียงในหู<br>(หลังใส่ PPE)</th>
                    <th style="text-align: center;">ผลต่างการได้ยิน<br>(Shift)</th>
                </tr>
            </thead>
            <tbody>
    `;

    top5.forEach((emp, index) => {
        let twaHtml = '<span style="color:var(--text-muted);">- ไม่มีข้อมูล -</span>';
        if (emp.pointTwa !== null && !isNaN(emp.pointTwa)) {
            const isLoud = emp.pointTwa >= NOISE_LIMIT;
            twaHtml = `
                <span class="badge ${isLoud ? 'badge-danger' : 'badge-success'}" style="font-size: 0.85rem;">
                    <i class="fa-solid ${isLoud ? 'fa-volume-high' : 'fa-volume-low'}"></i>
                    ${emp.pointTwa} dBA
                </span>`;
        }

        let inEarHtml = '<span style="color:var(--text-muted);">- ไม่มีข้อมูล -</span>';
        if (emp.pointInEar !== null && !isNaN(emp.pointInEar)) {
            const isStillLoud = emp.pointInEar >= NOISE_LIMIT;
            inEarHtml = `
                <span class="badge ${isStillLoud ? 'badge-danger' : 'badge-success'}" style="font-size: 0.85rem; background: ${isStillLoud ? '#fee2e2' : '#e0f2fe'}; color: ${isStillLoud ? '#ef4444' : '#0ea5e9'};">
                    <i class="fa-solid fa-ear-listen"></i>
                    ${emp.pointInEar} dBA
                </span>`;
        }

        const shiftHtml = `
            <span class="badge ${emp.isSTS ? 'badge-danger' : 'badge-success'}" style="font-size: 0.9rem;">
                <i class="fa-solid ${emp.isSTS ? 'fa-arrow-up' : 'fa-check'}"></i> ${emp.shift} dB
            </span>`;

        tableHtml += `
            <tr>
                <td style="text-align: center; font-weight: bold; color: ${index === 0 ? 'var(--danger)' : 'inherit'}; font-size: 1.1rem;">#${index + 1}</td>
                <td style="font-weight: bold; color: var(--primary);">${emp.emp_id}</td>
                <td>${emp.name}</td>
                <td>${emp.dept}</td>
                <td>${emp.point}</td>
                <td style="text-align: center;">${twaHtml}</td>
                <td style="text-align: center;">${inEarHtml}</td>
                <td style="text-align: center;">${shiftHtml}</td>
            </tr>
        `;
    });

    tableHtml += '</tbody></table>';
    topRiskContainer.innerHTML = tableHtml;
}