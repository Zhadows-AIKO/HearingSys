// ==========================================
// NOISE.JS - Noise Management V12.2 (Bug-fixed)
// ==========================================

window.NOISE_LIMIT = window.NOISE_LIMIT || (window.APP_CONFIG && window.APP_CONFIG.NOISE_LIMIT_DBA) || 85;
window.METER_MAX   = window.METER_MAX   || (window.APP_CONFIG && window.APP_CONFIG.METER_CEILING_DBA) || 120;

let globalNoise = [];
let noiseMappingData = []; 
let currentViewMode = 'latest'; // 'latest' หรือ 'history'
let selectedHistoryYear = ''; // เก็บปีที่เลือกในโหมดประวัติ

function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function isMappingActiveRow(m) {
    const v = m.active;
    if (v === undefined || v === '' || v === null) return true;
    return String(v).toUpperCase() === 'TRUE' || v === true || v === 1;
}

function isProductionRow(m) {
    const lt = String(m.location_type || '').trim().toLowerCase();
    if (lt === 'production') return true;
    if (lt === 'admin')      return false;
    const div = String(m.division || '').toLowerCase();
    return div.includes('ผลิต') || div.includes('production');
}

function normalizePointKey(s) {
    return String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

async function postApi(payload) {
    try {
        const resp = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(payload),
            redirect: 'follow'
        });
        try { return await resp.json(); } catch (_) { return { success: true }; }
    } catch (e) { return { success: false, error: e.message }; }
}


// ==========================================
// 1. NOISE PAGE (ตารางสรุป + ปุ่มควบคุม)
// ==========================================
async function loadNoiseData() {
    showLoader();
    const container = document.getElementById('noiseCardGrid');
    if (!container) return hideLoader();

    try {
        const t = new Date().getTime();
        const [resNoise, resMapping, resEmp] = await Promise.all([
            fetch(API_URL + '?action=getNoiseSurveys&t=' + t),
            fetch(API_URL + '?action=getLocationMapping&t=' + t),
            fetch(API_URL + '?action=getEmployees&t=' + t)
        ]);
        
        const jsonNoise = await resNoise.json();
        const jsonMapping = await resMapping.json();
        const jsonEmp = await resEmp.json();

        const noiseData = (jsonNoise.success && Array.isArray(jsonNoise.data)) ? jsonNoise.data : [];
        const mappingData = (jsonMapping.success && Array.isArray(jsonMapping.data)) ? jsonMapping.data : [];
        const empData = (jsonEmp.success && Array.isArray(jsonEmp.data)) ? jsonEmp.data : [];

        globalNoise = noiseData.slice().sort((a, b) => Number(b.survey_year) - Number(a.survey_year));

        // 1. จัดกลุ่มข้อมูล Mapping
        const segMap = {};
        const segEmps = {}; 
        const segToEmpLocations = {}; 
        const pointToSegMap = {}; // Map สำหรับหาว่าจุดไหนอยู่ SEG อะไร (เอาไว้โหมด History)

        mappingData.forEach(m => {
            if (!isMappingActiveRow(m)) return;
            const isProd = isProductionRow(m);
            const seg = String(m.note || 'Unknown').trim();
            const point = String(m.mapped_measurement_point || '').trim();
            const empLoc = String(m.emp_location || '').trim();

            if (isProd) {
                if (!segMap[seg]) segMap[seg] = { points: new Set() };
                if (point && point !== '-') {
                    segMap[seg].points.add(point);
                    pointToSegMap[normalizePointKey(point)] = seg;
                }
                if (!segEmps[seg]) segEmps[seg] = new Set();
                
                if (empLoc && empLoc !== '-') {
                    if (!segToEmpLocations[seg]) segToEmpLocations[seg] = new Set();
                    segToEmpLocations[seg].add(empLoc);
                }
            }
        });

        // 2. นับจำนวนพนักงานใน SEG
        empData.forEach(emp => {
            if (emp.status !== 'Active') return;
            const loc = normalizePointKey(emp.measurement_point);
            const mapping = mappingData.find(m => normalizePointKey(m.emp_location) === loc && isMappingActiveRow(m));
            if (mapping && isProductionRow(mapping)) {
                const seg = String(mapping.note || 'Unknown').trim();
                if (segEmps[seg]) segEmps[seg].add(emp.emp_id); 
            }
        });

        // 3. จัดเตรียมข้อมูล Noise
        const latestNoiseByPoint = {};
        const historyByYear = {};
        const allYearsSet = new Set();

        noiseData.forEach(n => {
            const point = normalizePointKey(n.measurement_point);
            if (!point) return;
            
            if (!latestNoiseByPoint[point] || Number(n.survey_year) > Number(latestNoiseByPoint[point].survey_year)) {
                latestNoiseByPoint[point] = n;
            }

            const year = n.survey_year || 'ไม่ระบุ';
            allYearsSet.add(year);
            if (!historyByYear[year]) historyByYear[year] = [];
            historyByYear[year].push(n);
        });

        const sortedYears = Array.from(allYearsSet).sort((a, b) => String(b).localeCompare(String(a)));
        
        if (currentViewMode === 'history' && (!selectedHistoryYear || !historyByYear[selectedHistoryYear])) {
            selectedHistoryYear = sortedYears.length > 0 ? sortedYears[0] : '';
        }

        let yearOptions = `<option value="">-- ข้อมูลย้อนหลัง --</option>`;
        sortedYears.forEach(y => {
            yearOptions += `<option value="${y}" ${String(y) === String(selectedHistoryYear) ? 'selected' : ''}>ประวัติปี พ.ศ. ${y}</option>`;
        });

        const controlBarHTML = `
            <div style="margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                <button onclick="openNoiseModal()" class="btn-primary" style="padding: 12px 20px; font-size: 1rem; white-space: nowrap;">
                    <i class="fa-solid fa-plus"></i> บันทึกผลตรวจรอบปีใหม่
                </button>
                
                <div style="display: flex; align-items: center; gap: 10px; background: white; padding: 5px 15px; border-radius: 8px; border: 1px solid #cbd5e1; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                    <label style="margin: 0; font-weight: bold; color: var(--primary); font-family:'Kanit'; white-space: nowrap;"><i class="fa-regular fa-calendar"></i> มุมมอง:</label>
                    <select onchange="changeHistoryYear(this.value)" style="padding: 8px; border: none; font-family:'Sarabun'; font-size: 1rem; outline: none; cursor: pointer; background: transparent;">
                        ${yearOptions}
                    </select>
                </div>
            </div>
        `;

        // 4. สร้าง HTML ตาราง
        let tableHTML = '';
        const tableHeaderHTML = `
            <thead style="background:#f8fafc; border-bottom: 2px solid #e2e8f0;">
                <tr>
                    <th style="text-align:center; padding:12px 10px; width: 10%;">SEG</th>
                    <th style="text-align:left; padding:12px 10px; width: 18%;">จุดตรวจ<br>(Measurement Point)</th>
                    <th style="text-align:left; padding:12px 10px; width: 20%;">เครื่องจักร/แผนก<br>(emp_location)</th>
                    <th style="text-align:center; padding:12px 10px; width: 12%;">ผลตรวจ<br>(TWA)</th>
                    <th style="text-align:center; padding:12px 10px; width: 12%;">ผลการประเมิน</th>
                    <th style="text-align:left; padding:12px 10px; width: 15%;">การปรับปรุง (PPE)</th>
                    <th style="text-align:center; padding:12px 10px; width: 9%;">ในหู<br>(dBA)</th>
                    <th style="text-align:center; padding:12px 10px; width: 9%;">จัดการ</th>
                </tr>
            </thead>
        `;

        let tableRows = '';

        // ฟังก์ชันสำหรับ Sort SEG (เช่น "SEG 1" < "SEG 2" < "SEG 10")
        const sortSeg = (a, b) => {
            const numA = parseInt(String(a).replace(/\D/g, '')) || 0;
            const numB = parseInt(String(b).replace(/\D/g, '')) || 0;
            return numA - numB;
        };

        // ==========================================
        // โหมด: ข้อมูลล่าสุด (Dropdown ว่าง)
        // ==========================================
        if (currentViewMode === 'latest') {
            const sortedSegs = Object.keys(segMap).sort(sortSeg);

            sortedSegs.forEach(seg => {
                const pointsArray = Array.from(segMap[seg].points);
                const empCount = segEmps[seg] ? segEmps[seg].size : 0;
                if (pointsArray.length === 0) return;

                pointsArray.sort((a, b) => String(a).localeCompare(String(b)));

                pointsArray.forEach((pt, idx) => {
                    const noise = latestNoiseByPoint[normalizePointKey(pt)];
                    let twaVal = '-', isRisk = false, evalBadge = '<span class="badge" style="background:#f1f5f9; color:#64748b;">-</span>', advice = '-', inEar = '-', dateStr = '-';
                    
                    const machinesInSeg = segToEmpLocations[seg] ? Array.from(segToEmpLocations[seg]).join('<br>') : '-';
                    
                    if (noise) {
                        twaVal = Number(noise.twa_dba);
                        isRisk = twaVal >= window.NOISE_LIMIT;
                        dateStr = noise.survey_date || '-';
                        evalBadge = isRisk ? '<span class="badge badge-danger"><i class="fa-solid fa-triangle-exclamation"></i> ไม่ผ่าน</span>' : '<span class="badge badge-success"><i class="fa-solid fa-check"></i> ผ่าน</span>';
                        advice = isRisk ? (noise.ppe_type ? `<span style="color:var(--accent)"><i class="fa-solid fa-ear-listen"></i> ${esc(noise.ppe_type)}</span>` : '<span style="color:var(--danger); font-weight:bold;">ต้องจัดหา PPE</span>') : '<span style="color:var(--success)">- ไม่ต้องใส่ -</span>';
                        if (noise.noise_in_ear) inEar = `${esc(noise.noise_in_ear)} <span style="font-size:0.8rem; color:#64748b;">dBA</span>`;
                    }

                    const empBadge = empCount > 0 ? `<span style="color:#1e3a8a; font-size:0.8rem;"><i class="fa-solid fa-users"></i> ${empCount} คน</span>` : `<span style="color:#94a3b8; font-size:0.8rem;"><i class="fa-solid fa-users-slash"></i> 0 คน</span>`;

                    tableRows += `
                        <tr style="border-bottom: 1px solid #e2e8f0; transition: background 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'">
                            ${idx === 0 ? `<td rowspan="${pointsArray.length}" style="text-align:center; vertical-align:middle; font-weight:bold; background:#eff6ff; color:var(--primary); font-size:1.05rem;">${esc(seg)} <br> ${empBadge}</td>` : ''}
                            <td style="font-weight:bold; vertical-align:middle;">${esc(pt)}</td>
                            <td style="vertical-align:middle; font-size:0.85rem; color:#475569;">${machinesInSeg}</td>
                            <td style="text-align:center; vertical-align:middle; font-weight:bold; font-size:1.1rem; color:${isRisk ? 'var(--danger)' : (noise ? 'var(--success)' : '#94a3b8')};">${noise ? twaVal + ' <span style="font-size:0.8rem; font-weight:normal; color:#64748b;">dBA</span>' : '-'}</td>
                            <td style="text-align:center; vertical-align:middle;">${evalBadge}</td>
                            <td style="vertical-align:middle; font-size:0.85rem;">${advice}</td>
                            <td style="text-align:center; vertical-align:middle; font-weight:bold; color:var(--primary);">${inEar}</td>
                            <td style="text-align:center; vertical-align:middle; font-size:0.8rem; color:#64748b;">
                                ${esc(dateStr)}<br>
                                <button class="btn-primary btn-sm" onclick="editNoiseByPoint('${esc(pt)}')" style="padding: 4px 8px; margin-top: 5px;"><i class="fa-solid fa-pen"></i> แก้ไข</button>
                            </td>
                        </tr>
                    `;
                });
            });
            
            // แถว ADMIN (ต่อท้ายสุด)
            let totalAdminCount = 0;
            empData.forEach(emp => {
                if (emp.status !== 'Active') return;
                const loc = String(emp.measurement_point || '').trim().toUpperCase();
                const dept = String(emp.department || '').toLowerCase();
                if (loc === 'ADMIN' || loc.includes('ADMIN') || dept.includes('ธุรการ') || dept.includes('สำนักงาน')) totalAdminCount++;
            });

            if (totalAdminCount > 0) {
                tableRows += `
                    <tr style="background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                        <td style="text-align:center; vertical-align:middle; font-weight:bold; color:#64748b; font-size:1.05rem;">ADMIN <br><span style="color:#1e3a8a; font-size:0.8rem;"><i class="fa-solid fa-users"></i> ${totalAdminCount} คน</span></td>
                        <td style="text-align:center; vertical-align:middle; color:#64748b; font-style:italic;">ไม่มีจุดตรวจ</td>
                        <td style="text-align:center; vertical-align:middle; color:#64748b;">ส่วนกลาง/ธุรการ</td>
                        <td style="text-align:center; vertical-align:middle; color:#94a3b8;">-</td>
                        <td style="text-align:center; vertical-align:middle;"><span class="badge" style="background:#f1f5f9; color:#64748b;">ไม่มีจุดตรวจ</span></td>
                        <td style="vertical-align:middle; font-size:0.85rem; color:#64748b;"><i class="fa-solid fa-circle-info"></i> อยู่ในกลุ่มเฝ้าระวังตาม SEG</td>
                        <td style="text-align:center; vertical-align:middle; color:#94a3b8;">-</td>
                        <td style="text-align:center; vertical-align:middle; color:#94a3b8;">-</td>
                    </tr>
                `;
            }
        } 
        // ==========================================
        // โหมด: ประวัติย้อนหลัง (เลือกปี)
        // ==========================================
        else {
            const yearData = historyByYear[selectedHistoryYear] || [];
            if (yearData.length > 0) {
                const uniquePointsMap = new Map();
                yearData.forEach(n => {
                    const pointKey = normalizePointKey(n.measurement_point);
                    if (!uniquePointsMap.has(pointKey)) {
                        uniquePointsMap.set(pointKey, n);
                    }
                });
                
                let uniqueYearData = Array.from(uniquePointsMap.values());
                
                uniqueYearData.sort((a, b) => {
                    const segA = pointToSegMap[normalizePointKey(a.measurement_point)] || a.seg || 'Unknown';
                    const segB = pointToSegMap[normalizePointKey(b.measurement_point)] || b.seg || 'Unknown';
                    
                    const numA = parseInt(String(segA).replace(/\D/g, '')) || 0;
                    const numB = parseInt(String(segB).replace(/\D/g, '')) || 0;
                    
                    if (numA !== numB) return numA - numB;
                    return String(a.measurement_point || '').localeCompare(String(b.measurement_point || ''));
                });

                uniqueYearData.forEach(n => {
                    const twa = Number(n.twa_dba);
                    const isRisk = twa >= window.NOISE_LIMIT;
                    const pointKey = normalizePointKey(n.measurement_point);
                    
                    const segLabel = pointToSegMap[pointKey] || n.seg || '-';
                    const machinesInSeg = segToEmpLocations[segLabel] ? Array.from(segToEmpLocations[segLabel]).join('<br>') : '-';
                    
                    tableRows += `
                        <tr style="border-bottom: 1px solid #e2e8f0; transition: background 0.2s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'">
                            <td style="text-align:center; vertical-align:middle; font-weight:bold; background:#eff6ff; color:var(--primary); font-size:1.05rem;">${esc(segLabel)}</td>
                            <td style="font-weight:bold; vertical-align:middle;">${esc(n.measurement_point || '-')}</td>
                            <td style="vertical-align:middle; font-size:0.85rem; color:#475569;">${machinesInSeg}</td>
                            <td style="text-align:center; vertical-align:middle; font-weight:bold; font-size:1.1rem; color:${isRisk ? 'var(--danger)' : 'var(--success)'};">${isNaN(twa) ? '-' : twa} <span style="font-size:0.8rem; font-weight:normal; color:#64748b;">dBA</span></td>
                            <td style="text-align:center; vertical-align:middle;">
                                ${isRisk ? '<span class="badge badge-danger"><i class="fa-solid fa-triangle-exclamation"></i> ไม่ผ่าน</span>' : '<span class="badge badge-success"><i class="fa-solid fa-check"></i> ผ่าน</span>'}
                            </td>
                            <td style="vertical-align:middle; font-size:0.85rem;">
                                ${n.ppe_type ? `<span style="color:var(--accent)"><i class="fa-solid fa-ear-listen"></i> ${esc(n.ppe_type)}</span>` : '<span style="color:var(--success)">- ไม่ต้องใส่ -</span>'}
                            </td>
                            <td style="text-align:center; vertical-align:middle; font-weight:bold; color:var(--primary);">${esc(n.noise_in_ear || '-')} <span style="font-size:0.8rem; color:#64748b;">dBA</span></td>
                            <td style="text-align:center; vertical-align:middle; font-size:0.8rem; color:#64748b;">
                                ${esc(n.survey_date || '-')}<br>
                                <button class="btn-primary btn-sm" onclick="editHistoryNoise('${esc(n.measurement_point)}', '${esc(n.survey_year)}')" style="padding: 4px 8px; margin-top: 5px;"><i class="fa-solid fa-pen"></i> แก้ไข</button>
                            </td>
                        </tr>
                    `;
                });
            } else {
                console.warn(`[Noise] No data for selected year: ${selectedHistoryYear}`);
                tableRows = `<tr><td colspan="8" style="text-align:center; padding: 30px; color:#64748b;"><i class="fa-solid fa-folder-open fa-2x" style="margin-bottom:10px; color:#cbd5e1;"></i><br>ไม่พบข้อมูลในปี ${esc(selectedHistoryYear)}</td></tr>`;
            }
        }

        if (tableRows === '' && currentViewMode === 'latest') {
             setTimeout(() => {
                container.innerHTML = controlBarHTML + '<div style="text-align:center; width:100%; padding:50px; color:var(--text-muted);">ยังไม่มีข้อมูลการตรวจวัดเสียง</div>';
                hideLoader();
            }, 50);
            return;
        }

        tableHTML = `
            <div style="width: 100%; overflow-x: auto; background: white; border-radius: var(--radius); box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
                <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem; table-layout: auto;">
                    ${tableHeaderHTML}
                    <tbody>${tableRows}</tbody>
                </table>
            </div>
        `;

        setTimeout(() => {
            container.innerHTML = controlBarHTML + tableHTML;
            hideLoader();
        }, 50);

    } catch (e) {
        console.error(e);
        container.innerHTML = '<div style="text-align:center; width:100%; padding:50px; color:red;">โหลดข้อมูลไม่สำเร็จ</div>';
        hideLoader();
    }
}

// ==========================================
// Dropdown เปลี่ยนโหมด (แก้ไขลบตัวที่ซ้ำซ้อนออกแล้ว)
// ==========================================
function changeHistoryYear(year) {
    if (year === '') {
        currentViewMode = 'latest';
        selectedHistoryYear = '';
    } else {
        currentViewMode = 'history';
        selectedHistoryYear = year;
    }
    loadNoiseData();
}

function switchNoiseView(mode) {
    currentViewMode = mode;
    loadNoiseData();
}

// ==========================================
// 2. FORM NOISE (กรองเฉพาะจุดที่ยังไม่ได้ลงข้อมูล)
// ==========================================
async function openNoiseModal() {
    const container = document.getElementById('noiseCardGrid');
    const formView = document.getElementById('noiseFormView');
    const form = document.getElementById('formNoise');
    
    if (container) container.style.display = 'none';
    if (formView) formView.style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });

    form.reset();
    const currentYearBE = new Date().getFullYear() + 543;
    document.getElementById('n_survey_year').value = currentYearBE;

    const tbody = document.getElementById('noiseFormTableBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding: 20px;"><i class="fa-solid fa-spinner fa-spin"></i> กำลังเตรียมข้อมูล...</td></tr>';

    setTimeout(async () => {
        showLoader();
        try {
            const t = new Date().getTime();
            const [resMap, resNoise] = await Promise.all([
                fetch(API_URL + '?action=getLocationMapping&t=' + t),
                fetch(API_URL + '?action=getNoiseSurveys&t=' + t)
            ]);
            
            const jsonMap = await resMap.json();
            const jsonNoise = await resNoise.json();
            
            if (jsonMap.success && jsonMap.data) noiseMappingData = jsonMap.data;
            const noiseData = (jsonNoise.success && jsonNoise.data) ? jsonNoise.data : [];
            
            generateFormFromMapping(currentYearBE, noiseData); 
            
        } catch (e) {
            console.error("Error openNoiseModal:", e);
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding: 20px; color:red;">
                    <i class="fa-solid fa-triangle-exclamation"></i> โหลดข้อมูลไม่สำเร็จ: ${e.message}
                </td></tr>`;
            }
        } finally {
            hideLoader();
        }
    }, 100);
}

async function changeSurveyYear(yearBE) {
    const tbody = document.getElementById('noiseFormTableBody');
    if (!tbody || !yearBE) return;

    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding: 20px;"><i class="fa-solid fa-spinner fa-spin"></i> กำลังตรวจสอบข้อมูลปี ' + yearBE + '...</td></tr>';
    
    try {
        const resNoise = await fetch(API_URL + '?action=getNoiseSurveys&t=' + new Date().getTime());
        const jsonNoise = await resNoise.json();
        const noiseData = (jsonNoise.success && jsonNoise.data) ? jsonNoise.data : [];
        
        globalNoise = noiseData;

        generateFormFromMapping(yearBE, noiseData);

    } catch (e) {
        console.error("Error changing survey year:", e);
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding: 20px; color:red;">โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง</td></tr>';
    }
}

function generateFormFromMapping(selectedYearBE, allNoiseData) {
    const tbody = document.getElementById('noiseFormTableBody');
    if (!tbody) return;

    if (!noiseMappingData || noiseMappingData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 20px;">ไม่พบข้อมูลในตาราง 5_LocationMapping</td></tr>';
        return;
    }

    const pointsWithDataThisYear = new Set();
    allNoiseData.forEach(n => {
        if (String(n.survey_year) === String(selectedYearBE)) {
            pointsWithDataThisYear.add(normalizePointKey(n.measurement_point));
        }
    });

    const uniquePointsMap = new Map();

    noiseMappingData.forEach(m => {
        if (!isMappingActiveRow(m)) return;
        const isProd = isProductionRow(m);
        const point = String(m.mapped_measurement_point || '').trim();
        const zoneStr = String(m.zone || 'ZZZ_ไม่มีโซน').trim(); 

        if (!isProd) return;
        if (!point || point === '-') return;
        if (pointsWithDataThisYear.has(normalizePointKey(point))) return; 

        const pointKey = normalizePointKey(point);
        if (!uniquePointsMap.has(pointKey)) {
            uniquePointsMap.set(pointKey, { point: point, zone: zoneStr });
        }
    });

    const pointsToRender = Array.from(uniquePointsMap.values());

    pointsToRender.sort((a, b) => {
        const zoneCompare = String(a.zone).localeCompare(String(b.zone));
        if (zoneCompare !== 0) return zoneCompare;
        return String(a.point).localeCompare(String(b.point));
    });

    let html = '';

    pointsToRender.forEach((item) => {
        html += `
        <tr data-point="${esc(item.point)}">
            <td style="font-weight:bold; padding-left: 10px; vertical-align:middle;">${esc(item.point)}</td>
            
            <td style="text-align:center; vertical-align:middle;">
                <input type="number" step="0.5" class="zone-hrs" value="8" style="width: 80px; text-align:center; border:1px solid #ccc; padding:4px;"> ชม.
            </td>
            
            <td style="text-align:center; vertical-align:middle;">
                <input type="number" step="0.1" class="zone-level" placeholder=" " style="border: 2px solid #3b82f6; background: #eff6ff; width: 100%; text-align:center; font-weight:bold; padding: 6px;">
            </td>
            
            <td style="text-align:center; vertical-align:middle;">
                <input type="number" step="0.1" class="zone-twa" readonly style="background:#e0f2fe; width: 100%; text-align:center; font-weight:bold; border:none; padding: 6px; color: var(--primary);">
            </td>
            
            <td style="text-align:center; vertical-align:middle;">
                <input type="text" class="zone-result" readonly style="background:#e2e8f0; width: 100%; text-align:center; font-weight:bold; border:none; padding: 6px;">
            </td>
            
            <td style="text-align:center; vertical-align:middle;">
                <select class="zone-ppe" style="border: 1px solid #ccc; padding: 6px; width: 100%;">
                    <option value="">- ไม่ใส่ -</option>
                    <option value="EAR MUFF 25">EAR MUFF 25</option>
                    <option value="EAR MUFF 27">EAR MUFF 27</option>
                    <option value="EAR MUFF 31">EAR MUFF 31</option>
                    <option value="FORM PLUG 30">FORM PLUG 30</option>
                </select>
            </td>
            
            <td style="text-align:center; vertical-align:middle;">
                <input type="number" class="zone-nrr" readonly style="background:#f8fafc; width: 100%; text-align:center; font-weight:bold; border:none; padding: 6px;">
            </td>
            
            <td style="text-align:center; vertical-align:middle;">
                <input type="number" step="0.1" class="zone-in-ear" readonly style="background:#e0f2fe; width: 100%; text-align:center; font-weight:bold; border:none; padding: 6px; color: var(--primary);">
            </td>
        </tr>`;
    });

    if (html === '') {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align:center; padding: 30px; background:#ecfdf5; color:#065f46; border-radius: 8px;">
                    <i class="fa-solid fa-check-circle fa-2x" style="margin-bottom:10px;"></i><br>
                    <b>ยินดีด้วยครับ!</b> พบว่าทุกจุดตรวจในระบบ ได้รับการบันทึกข้อมูลครบถ้วนแล้วในปี พ.ศ. ${esc(selectedYearBE)}
                    <br><br>
                    <span style="font-size:0.85rem; color:#047857;">(หากต้องการแก้ไขข้อมูลเดิม กรุณาไปที่ตารางหน้าแรกและกดปุ่ม "แก้ไข" ที่รายการนั้นครับ)</span>
                </td>
            </tr>`;
    } else {
        tbody.innerHTML = html;
        attachNoiseCalculations();
    }
}

function attachNoiseCalculations() {
    const rows = document.querySelectorAll('#noiseFormTableBody tr');

    rows.forEach(row => {
        if (row.dataset.adminOnly === 'true') return;

        const hrsInput = row.querySelector('.zone-hrs');
        const levelInput = row.querySelector('.zone-level');
        const twaInput = row.querySelector('.zone-twa');
        const resultInput = row.querySelector('.zone-result');
        
        const ppeSelect = row.querySelector('.zone-ppe');
        const nrrInput = row.querySelector('.zone-nrr');
        const inEarInput = row.querySelector('.zone-in-ear');

        if (!hrsInput || !levelInput) return;

        const calculateNoise = () => {
            const level = Number(levelInput.value) || 0;
            const hrs = Number(hrsInput.value) || 0;
            let twa = 0;

            if (level > 0 && hrs > 0) {
                const insideLog = (hrs / 8) * Math.pow(10, level / 10);
                twa = 10 * Math.log10(insideLog);
                twaInput.value = twa.toFixed(1);
            } else {
                twaInput.value = '';
            }

            if (twa > 0) {
                if (twa >= window.NOISE_LIMIT) {
                    resultInput.value = 'ไม่ผ่าน';
                    resultInput.style.color = 'var(--danger)';
                } else {
                    resultInput.value = 'ผ่าน';
                    resultInput.style.color = 'var(--success)';
                }
            } else {
                resultInput.value = '';
                resultInput.style.color = '#000';
            }

            const ppeText = ppeSelect.value.toUpperCase();
            let nrr = 0;
            let ppeFactor = 25;

            if (ppeText.includes('EAR MUFF')) {
                ppeFactor = 75;
                const match = ppeText.match(/(\d+)/);
                if (match) nrr = Number(match[1]);
            } else if (ppeText.includes('FORM PLUG')) {
                ppeFactor = 50;
                const match = ppeText.match(/(\d+)/);
                if (match) nrr = Number(match[1]);
            }

            nrrInput.value = nrr > 0 ? nrr : '';

            if (twa > 0 && nrr > 0) {
                const attenuation = (ppeFactor * nrr) / 100;
                const effectiveAttenuation = attenuation - 7;
                inEarInput.value = (twa - effectiveAttenuation).toFixed(1);
            } else if (twa > 0) {
                inEarInput.value = twa.toFixed(1);
            } else {
                inEarInput.value = '';
            }
        };

        levelInput.addEventListener('input', calculateNoise);
        hrsInput.addEventListener('input', calculateNoise);
        ppeSelect.addEventListener('change', calculateNoise);
    });
}

function closeNoiseModal() {
    const container = document.getElementById('noiseCardGrid');
    const formView = document.getElementById('noiseFormView');
    
    if (formView) formView.style.display = 'none';
    
    if (container) {
        container.style.display = 'block';
        loadNoiseData();
    }
}

// ==========================================
// 3. SUBMIT FORM
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const formNoise = document.getElementById('formNoise');
    if (formNoise) {
        formNoise.addEventListener('submit', async (e) => {
            e.preventDefault();

            const surveyDate  = document.getElementById('n_survey_date').value;
            const surveyYear  = document.getElementById('n_survey_year').value;
            const surveyor    = document.getElementById('n_surveyor').value.trim();
            const surveyType  = (document.getElementById('n_survey_type')?.value || 'Area');

            if (!surveyDate) return alert('กรุณาระบุวันที่ตรวจ');
            if (!surveyYear) return alert('กรุณาระบุปีที่ตรวจ');
            if (!surveyor)   return alert('กรุณาระบุชื่อผู้ตรวจวัด');

            const rows = document.querySelectorAll('#noiseFormTableBody tr');
            const payload = [];

            rows.forEach(row => {
                if (row.dataset.adminOnly === 'true') return;
                const levelEl = row.querySelector('.zone-level');
                if (!levelEl) return;
                const levelVal = levelEl.value.trim();
                if (levelVal === '') return;

              payload.push({
                    measurement_point: row.dataset.point,
                    duration_hr:  row.querySelector('.zone-hrs').value.trim(),
                    noise_level:  levelVal,
                    twa_dba:      row.querySelector('.zone-twa').value,
                    result:       row.querySelector('.zone-result').value,
                    ppe_type:     row.querySelector('.zone-ppe').value,
                    nrr:          row.querySelector('.zone-nrr').value,
                    noise_in_ear: row.querySelector('.zone-in-ear').value,
                    survey_type:  surveyType,
                    survey_year:  surveyYear,
                    survey_date:  surveyDate,
                    surveyor:     surveyor
                });
            });

            if (payload.length === 0) {
                return alert('❌ กรุณากรอกระดับเสียงอย่างน้อย 1 พื้นที่ก่อนบันทึกครับ');
            }

            try {
                showLoader();
                const submitBtn = formNoise.querySelector('button[type="submit"]');
                if (submitBtn) submitBtn.disabled = true;

                const result = await postApi({ action: 'saveBulkNoiseSurvey', data: payload });
                
                if (result.success === false) {
                    alert('❌ ' + (result.error || 'บันทึกไม่สำเร็จ'));
                    return;
                }

                alert(`✅ ${result.message || `บันทึกข้อมูลสำเร็จ (${payload.length} พื้นที่)`}`);
                
                // 🌟 ล้าง Cache ของ Dashboard (อัปเดตคีย์เป็น v5 ให้ตรงกับ dashboard.js ตัวใหม่)
                sessionStorage.removeItem('dashboard_cache_v5');
                sessionStorage.removeItem('dashboard_cache_v1'); // เผื่อเครื่องเก่ามีค้าง
                
                // ล้างตัวแปร Global
                globalNoise = [];
                noiseMappingData = [];

                closeNoiseModal();
                await loadNoiseData();
            } catch (err) {
                console.error(err);
                alert('เกิดข้อผิดพลาด: ' + err.message);
            } finally {
                hideLoader();
                const submitBtn = formNoise.querySelector('button[type="submit"]');
                if (submitBtn) submitBtn.disabled = false;
            }
        });
    }
});

// ==========================================
// 4. EDIT NOISE
// ==========================================
async function openEditNoiseModal(index) {
    const n = globalNoise[index];
    if (!n) return;
    
    const container = document.getElementById('noiseCardGrid');
    const formView = document.getElementById('noiseFormView');
    const tbody = document.getElementById('noiseFormTableBody');
    
    if (container) container.style.display = 'none';
    if (formView) formView.style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });

    document.getElementById('formNoise').reset();
    document.getElementById('noise_action_type').value = 'edit';
    document.getElementById('n_survey_year').value = n.survey_year || '';
    document.getElementById('n_survey_date').value = n.survey_date || '';
    document.getElementById('n_surveyor').value = n.surveyor || '';
    const stEl = document.getElementById('n_survey_type');
    if (stEl) stEl.value = n.survey_type || 'Area';

    let segForEdit = String(n.seg || '').trim();
    if (!segForEdit) {
        const m = noiseMappingData.find(r =>
            normalizePointKey(r.mapped_measurement_point) === normalizePointKey(n.measurement_point)
        );
        if (m) segForEdit = String(m.note || '').trim();
    }

    tbody.innerHTML = `
        <tr data-seg="${esc(segForEdit)}" data-point="${esc(n.measurement_point)}">
            <td style="text-align:center; vertical-align:middle; font-weight:bold; color:var(--primary); font-size:1.1rem;">${esc(segForEdit || '-')}</td>
            <td style="font-weight:bold; padding-left: 10px; vertical-align:middle;">${esc(n.measurement_point)}</td>
            <td style="text-align:center; vertical-align:middle;">
                <input type="number" step="0.5" class="zone-hrs" value="${esc(n.duration_hr || 8)}" style="width: 80px; text-align:center; border:1px solid #ccc; padding:4px;"> ชม.
            </td>
            <td style="text-align:center; vertical-align:middle;">
                <input type="number" step="0.1" class="zone-level" value="${esc(n.noise_level || '')}" style="border: 2px solid #3b82f6; background: #eff6ff; width: 100%; text-align:center; font-weight:bold; padding: 6px;">
            </td>
            <td style="text-align:center; vertical-align:middle;">
                <input type="number" step="0.1" class="zone-twa" value="${esc(n.twa_dba)}" readonly style="background:#e0f2fe; width: 100%; text-align:center; font-weight:bold; border:none; padding: 6px; color: var(--primary);">
            </td>
            <td style="text-align:center; vertical-align:middle;">
                <input type="text" class="zone-result" value="${esc(n.result)}" readonly style="background:#e2e8f0; width: 100%; text-align:center; font-weight:bold; border:none; padding: 6px;">
            </td>
            <td style="text-align:center; vertical-align:middle;">
                <select class="zone-ppe" style="border: 1px solid #ccc; padding: 6px; width: 100%;">
                    <option value="" ${!n.ppe_type ? 'selected' : ''}>- ไม่ใส่ -</option>
                    <option value="EAR MUFF 25" ${n.ppe_type === 'EAR MUFF 25' ? 'selected' : ''}>EAR MUFF 25</option>
                    <option value="EAR MUFF 27" ${n.ppe_type === 'EAR MUFF 27' ? 'selected' : ''}>EAR MUFF 27</option>
                    <option value="EAR MUFF 31" ${n.ppe_type === 'EAR MUFF 31' ? 'selected' : ''}>EAR MUFF 31</option>
                    <option value="FORM PLUG 30" ${n.ppe_type === 'FORM PLUG 30' ? 'selected' : ''}>FORM PLUG 30</option>
                </select>
            </td>
            <td style="text-align:center; vertical-align:middle;">
                <input type="number" class="zone-nrr" value="${esc(n.nrr || '')}" readonly style="background:#f8fafc; width: 100%; text-align:center; font-weight:bold; border:none; padding: 6px;">
            </td>
            <td style="text-align:center; vertical-align:middle;">
                <input type="number" step="0.1" class="zone-in-ear" value="${esc(n.noise_in_ear || '')}" readonly style="background:#e0f2fe; width: 100%; text-align:center; font-weight:bold; border:none; padding: 6px; color: var(--primary);">
            </td>
        </tr>
    `;
    attachNoiseCalculations();
}

// ==========================================
// 5. ฟังก์ชันแก้ไขข้อมูลย้อนหลัง
// ==========================================
function editHistoryNoise(pointName, year) {
    const index = globalNoise.findIndex(n => 
        normalizePointKey(n.measurement_point) === normalizePointKey(pointName) && 
        String(n.survey_year) === String(year)
    );
    if (index !== -1) {
        openEditNoiseModal(index);
    } else {
        alert('ไม่พบข้อมูลของจุดนี้ในปีที่ระบุ');
    }
}

// ==========================================
// 6. MISSING CHECKUP
// ==========================================
async function openMissingCheckupModal() {
    const modal = document.getElementById('missingCheckupModal');
    modal.style.display = 'flex';

    const currentYearBE = new Date().getFullYear() + 543;
    const yearSelect = document.getElementById('missingCheckupYear');
    yearSelect.innerHTML = '';

    for (let i = 0; i < 5; i++) {
        const y = currentYearBE - i;
        yearSelect.innerHTML += `<option value="${y}">ปี ${y}</option>`;
    }

    const branchSel = document.getElementById('missingCheckupBranch');
    if (branchSel && branchSel.options.length <= 1) {
        try {
            const res = await fetch(API_URL + '?action=getEmployees');
            const emps = (await res.json()).data || [];
            const branchSet = new Set();
            emps.forEach(e => {
                const b = String(e.branch_name || '').trim();
                if (b) branchSet.add(b);
            });
            const opts = [...branchSet].sort().map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join('');
            branchSel.innerHTML = '<option value="ALL">ทุกสาขา</option>' + opts;
        } catch (e) { console.error('populate branch fail', e); }
    }

    loadMissingCheckupList();
}

function closeMissingCheckupModal() {
    document.getElementById('missingCheckupModal').style.display = 'none';
}

async function loadMissingCheckupList() {
    const tbody = document.getElementById('missingCheckupTableBody');
    const selectedYearBE = Number(document.getElementById('missingCheckupYear').value);
    const selectedBranch = document.getElementById('missingCheckupBranch').value;
    const selectedYearCE = selectedYearBE - 543;

    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px;"><i class="fa-solid fa-spinner fa-spin"></i> กำลังโหลด...</td></tr>';

    try {
        const [resEmp, resTests, resMap] = await Promise.all([
            fetch(API_URL + '?action=getEmployees'),
            fetch(API_URL + '?action=getHearingTests'),
            fetch(API_URL + '?action=getLocationMapping')
        ]);
        const employees = (await resEmp.json()).data || [];
        const allTests  = (await resTests.json()).data || [];
        const mapping   = (await resMap.json()).data || [];

        const prodIndex = {};
        mapping.forEach(m => {
            if (!isMappingActiveRow(m)) return;
            const loc = normalizePointKey(m.emp_location);
            if (!loc) return;
            prodIndex[loc] = isProductionRow(m);
        });

        const productionEmps = employees.filter(emp => {
            if (emp.status !== 'Active') return false;
            const locKey = normalizePointKey(emp.measurement_point);
            let isProduction;
            if (locKey && prodIndex.hasOwnProperty(locKey)) {
                isProduction = prodIndex[locKey];
            } else {
                const deptStr = String(emp.department ?? '');
                const posStr  = String(emp.position ?? '');
                isProduction = deptStr.includes('ผลิต') || posStr.includes('ผลิต');
            }
            const isSameBranch = (selectedBranch === 'ALL')
                || (String(emp.branch_name ?? '').trim() === String(selectedBranch).trim())
                || (String(emp.branch_id ?? '').trim() === String(selectedBranch).trim());
            return isProduction && isSameBranch;
        });

        const missingEmps = [];
        productionEmps.forEach(emp => {
            const testsInSelectedYear = allTests.filter(t =>
                String(t.emp_id).trim() === String(emp.emp_id).trim() &&
                Number(t.exam_year) === selectedYearCE
            );
            if (testsInSelectedYear.length === 0) {
                const empTests = allTests.filter(t => String(t.emp_id).trim() === String(emp.emp_id).trim());
                let latestYearText = '-';
                if (empTests.length > 0) {
                    const sorted = empTests.slice().sort((a, b) => Number(b.exam_year) - Number(a.exam_year));
                    latestYearText = Number(sorted[0].exam_year) + 543;
                }
                missingEmps.push({
                    emp_id: emp.emp_id,
                    name: `${emp.title || ''}${emp.first_name} ${emp.last_name}`,
                    branch: emp.branch_name || emp.branch_id || '-',
                    dept: emp.department || emp.dept_code || '-',
                    latestYear: latestYearText
                });
            }
        });

        if (missingEmps.length === 0) {
            const branchText = selectedBranch === 'ALL' ? 'ทุกสาขา' : selectedBranch;
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--success);"><i class="fa-solid fa-check-circle"></i> พนักงานกลุ่มผลิต (${esc(branchText)}) ได้รับการตรวจหูในปี ${selectedYearBE} ครบแล้ว</td></tr>`;
        } else {
            tbody.innerHTML = missingEmps.map(emp => `
                <tr>
                    <td style="font-weight: bold; color: var(--primary);">${esc(emp.emp_id)}</td>
                    <td>${esc(emp.name)}</td>
                    <td><span class="badge" style="background:#eff6ff; color:#1e3a8a;">${esc(emp.branch)}</span></td>
                    <td>${esc(emp.dept)}</td>
                    <td style="text-align:center;">
                        ${emp.latestYear !== '-'
                            ? `<span style="color:var(--warning); font-weight:bold;">${esc(emp.latestYear)}</span>`
                            : '<span style="color:var(--danger); font-weight:bold;">ยังไม่เคยตรวจ</span>'}
                    </td>
                </tr>
            `).join('');
        }

    } catch (e) {
        console.error(e);
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:red;">โหลดข้อมูลไม่สำเร็จ</td></tr>';
    }
}