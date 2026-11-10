// ==========================================
// EMPLOYEE.JS - Employee Data & Analysis V12.2 (Config-Linked & Fixed)
// ==========================================

// ✅ ใช้ window. นำหน้าเพื่อไม่ให้ชนกับไฟล์อื่น
window.STS_LIMIT   = window.STS_LIMIT   || (window.APP_CONFIG && window.APP_CONFIG.STS_SHIFT_DB) || 15;
window.NOISE_LIMIT = window.NOISE_LIMIT || (window.APP_CONFIG && window.APP_CONFIG.NOISE_LIMIT_DBA) || 85;

let audiogramChartInstance = null;
let globalNoiseData = [];
let globalMappingData = [];

function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function normalizePointKey(s) {
    if (!s) return '';
    // ตัดช่องว่างหัวท้าย, แปลงเป็นตัวพิมพ์ใหญ่, และยุบช่องว่างที่ติดกันให้เหลือ 1 ตัว
    let str = String(s).trim().toUpperCase().replace(/\s+/g, ' ');
    // 🌟 ลบช่องว่างระหว่างตัวอักษรกับตัวเลข (เช่น "SQ 31" -> "SQ31")
    str = str.replace(/([A-Z]+)\s+(\d+)/g, '$1$2');
    return str;
}
function isMappingActiveRow(m) {
    const v = m.active;
    if (v === undefined || v === '' || v === null) return true;
    return String(v).toUpperCase() === 'TRUE' || v === true || v === 1;
}

async function postApi(payload) {
    try {
        const resp = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(payload),
            redirect: 'follow'
        });
        try { return await resp.json(); } catch (_) { return { success: true, message: 'ส่งข้อมูลแล้ว' }; }
    } catch (e) { return { success: false, error: e.message }; }
}

async function checkDuplicateId(empId) {
    const errorMsg = document.getElementById('id_error_msg');
    const inputField = document.getElementById('n_emp_id');
    if (!errorMsg || !inputField) return;
    if (!empId || empId.trim() === '') {
        errorMsg.style.display = 'none';
        inputField.style.borderColor = '#cbd5e1';
        return;
    }
    try {
        const res = await fetch(API_URL + '?action=getEmployees');
        const json = await res.json();
        if (json.success) {
            const isDuplicate = json.data.some(emp => String(emp.emp_id).trim() === String(empId).trim());
            errorMsg.style.display = isDuplicate ? 'block' : 'none';
            inputField.style.borderColor = isDuplicate ? 'red' : '#10b981';
        }
    } catch (e) { console.error('Error checking ID:', e); }
}

function initEmployeePage() {
    hideAllEmployeeSections();
    const search = document.getElementById('searchInput');
    if (search) search.value = '';
    const form = document.getElementById('formNewEmployee');
    if (form) form.reset();
    const wrapper = document.getElementById('addEmployeeWrapper');
    if (wrapper) wrapper.style.display = 'block';
}

function hideAllEmployeeSections() {
    ['employeeProfile', 'addEmployeeWrapper', 'noResult'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
}

async function lookupDepartment(code, targetInputId) {
    const targetInput = document.getElementById(targetInputId);
    const positionInput = document.getElementById('n_position');
    if (!code) {
        if (targetInput) targetInput.value = '';
        if (positionInput) positionInput.value = '';
        return;
    }
    if (typeof departmentCache === 'undefined' || departmentCache.length === 0) {
        try {
            const res = await fetch(API_URL + '?action=getDepartments');
            const json = await res.json();
            if (json.success) window.departmentCache = json.data;
        } catch (e) { console.error(e); }
    }
    const dept = (window.departmentCache || []).find(d => String(d.dept_code) === String(code).trim());
    if (dept) {
        if (targetInput) targetInput.value = dept.dept_name || '';
        if (positionInput) positionInput.value = dept.division || '';
    } else {
        if (targetInput) targetInput.value = '(ไม่พบรหัสแผนกนี้)';
        if (positionInput) positionInput.value = '';
    }
}

function validateHearingInput(inputElement) {
    const val = inputElement.value;
    const existingError = inputElement.parentNode.querySelector('.input-error-msg');
    if (existingError) existingError.remove();
    inputElement.classList.remove('input-error');
    if (val === '' || isNaN(val)) return;
    const n = Number(val);
    let msg = '';
    if (n % 5 !== 0) {
        const lower = Math.floor(n / 5) * 5;
        const upper = Math.ceil(n / 5) * 5;
        msg = `⚠️ ต้องเป็นเศษ 5 (เช่น ${lower} หรือ ${upper})`;
    } else if (n < -10 || n > 120) {
        msg = '⚠️ ค่าต้องอยู่ระหว่าง -10 ถึง 120 dB';
    }
    if (msg) {
        inputElement.classList.add('input-error');
        const errorMsg = document.createElement('div');
        errorMsg.className = 'input-error-msg';
        errorMsg.style.color = 'var(--danger)';
        errorMsg.style.fontSize = '0.75rem';
        errorMsg.style.marginTop = '4px';
        errorMsg.style.fontWeight = 'bold';
        errorMsg.textContent = msg;
        inputElement.parentNode.appendChild(errorMsg);
    }
}

function showAddEmployeeForm() {
    hideAllEmployeeSections();
    const search = document.getElementById('searchInput');
    if (search) search.value = '';
    const form = document.getElementById('formNewEmployee');
    if (form) form.reset();
    const inputField = document.getElementById('n_emp_id');
    const errorMsg = document.getElementById('id_error_msg');
    if (inputField) inputField.style.borderColor = '#cbd5e1';
    if (errorMsg) errorMsg.style.display = 'none';
    const wrapper = document.getElementById('addEmployeeWrapper');
    if (wrapper) wrapper.style.display = 'block';
    
    populateMeasurementPoints();
}

function hideAddEmployeeForm() { hideAllEmployeeSections(); }

async function searchEmployee() {
    const keyword = document.getElementById('searchInput').value.trim().toLowerCase();
    if (!keyword) return alert('กรุณากรอกรหัส หรือชื่อ');
    hideAllEmployeeSections();
    showLoader();
    try {
        const [resEmp, resNoise, resMapping] = await Promise.all([
            fetch(API_URL + '?action=getEmployees'),
            fetch(API_URL + '?action=getNoiseSurveys'),
            fetch(API_URL + '?action=getLocationMapping')
        ]);
        const jsonEmp = await resEmp.json();
        const jsonNoise = await resNoise.json();
        const jsonMapping = await resMapping.json();
        
        // 🌟 ทำความสะอาดข้อมูล Noise ทันทีที่รับมา
        if (jsonNoise.success) {
            globalNoiseData = jsonNoise.data.map(n => ({
                ...n,
                clean_point_key: normalizePointKey(n.measurement_point || n.area_id)
            }));
        }
        
        // 🌟 ทำความสะอาดข้อมูล Mapping ทันทีที่รับมา
        if (jsonMapping.success) {
            globalMappingData = jsonMapping.data.map(m => ({
                ...m,
                clean_emp_loc_key: normalizePointKey(m.emp_location)
            }));
        }

        if (jsonEmp.success) {
            const emp = jsonEmp.data.find(e =>
                String(e.emp_id).toLowerCase() === keyword ||
                `${e.first_name} ${e.last_name}`.toLowerCase().includes(keyword)
            );
            if (emp) {
                currentEmpData = emp;
                renderEmployeeProfile(emp);
                loadHearingHistory(emp.emp_id);
                document.getElementById('employeeProfile').style.display = 'block';
            } else {
                document.getElementById('noResult').style.display = 'block';
            }
        }
    } catch (e) {
        console.error(e);
        alert('ไม่สามารถดึงข้อมูลได้');
    } finally { hideLoader(); }
}

function renderEmployeeProfile(emp) {
    document.getElementById('empNameDisplay').innerText = `${emp.title || ''}${emp.first_name} ${emp.last_name}`;
    document.getElementById('v_emp_id').innerText = emp.emp_id;
    document.getElementById('v_dept').innerText = emp.department || emp.dept_code || '-';
    document.getElementById('v_position').innerText = emp.position || '-';
    document.getElementById('v_status').innerText = emp.status || '-';
    const vBirth = document.getElementById('v_birth_date');
    const vAge = document.getElementById('v_age');
    const vType = document.getElementById('v_emp_type');
    const vStart = document.getElementById('v_start_date');
    const vMed = document.getElementById('v_medical_history');
    if (vBirth) vBirth.innerText = formatDate(emp.birth_date);
    if (vAge) vAge.innerText = emp.age || '-';
    if (vType) vType.innerText = emp.emp_type || '-';
    if (vStart) vStart.innerText = formatDate(emp.start_date);
    if (vMed) vMed.innerText = emp.medical_history || '-';
    const vPoint = document.getElementById('v_measurement_point');
    if (vPoint) vPoint.innerText = emp.measurement_point || '-';
}

function openEditEmployeeModal() {
    if (!currentEmpData) return;
    const emp = currentEmpData;
    document.getElementById('e_emp_id').value = emp.emp_id;
    document.getElementById('e_title').value = emp.title || 'นาย';
    document.getElementById('e_first_name').value = emp.first_name || '';
    document.getElementById('e_last_name').value = emp.last_name || '';
    document.getElementById('e_birth_date').value = emp.birth_date || '';
    document.getElementById('e_age').value = emp.age || '';
    document.getElementById('e_emp_type').value = emp.emp_type || 'Direct';
    document.getElementById('e_start_date').value = emp.start_date || '';
    document.getElementById('e_status').value = emp.status || 'Active';
    document.getElementById('e_medical_history').value = emp.medical_history || '';
    
    populateMeasurementPoints(emp.measurement_point || '');
    
    document.getElementById('editEmployeeModal').style.display = 'flex';
}
function closeEditEmployeeModal() { document.getElementById('editEmployeeModal').style.display = 'none'; }

function openHearingModal() {
    const modal = document.getElementById('hearingModal');
    const form = document.getElementById('formAddHearing');
    if (!modal || !form) return;
    form.reset();
    document.getElementById('h_emp_id').value = currentEmpData.emp_id;
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;
    document.getElementById('h_date').value = todayStr;
    calculateBEYear(todayStr, 'h_year');
    modal.querySelectorAll('.input-error-msg').forEach(el => el.remove());
    modal.querySelectorAll('input').forEach(el => {
        el.style.borderColor = '#cbd5e1';
        el.classList.remove('input-error');
    });
    modal.style.display = 'flex';
}
function closeHearingModal() { document.getElementById('hearingModal').style.display = 'none'; }

async function loadHearingHistory(empId) {
    try {
        const res = await fetch(`${API_URL}?action=getTestsByEmp&emp_id=${empId}`);
        const json = await res.json();
        if (json.success && json.data.length > 0) {
            currentHistoryData = json.data.sort((a, b) => Number(a.exam_year) - Number(b.exam_year));
            const latest = currentHistoryData[currentHistoryData.length - 1];
            const typeLabel = latest.test_type === 'Confirm' ? 'ยืนยัน' : (latest.test_type === 'Pre-employment' ? 'ก่อนเริ่มงาน' : 'ประจำปี');
            
            document.getElementById('latestHearingInfo').innerHTML = `
                <span style="color: var(--success); font-size: 1.2rem;">
                    <i class="fa-solid fa-calendar-check"></i> ปี ${latest.exam_year} (${typeLabel})
                </span>
                <span style="font-size: 0.9rem; font-weight: normal; color: var(--text-muted); margin-left: 10px;">
                    ตรวจเมื่อ: ${formatDate(latest.exam_date)}
                </span>`;
                
            const rFreqs = ['r500','r1000','r2000','r3000','r4000','r6000','r8000'];
            const lFreqs = ['l500','l1000','l2000','l3000','l4000','l6000','l8000'];
            document.getElementById('latestTestTableContainer').innerHTML = `
                <table class="matrix-table" style="width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: center;">
                    <thead>
                        <tr>
                            <th style="padding: 8px; background: #f8fafc;"></th>
                            <th colspan="7" class="bg-red" style="padding: 8px;">หูขวา (Right ear)</th>
                            <th colspan="7" class="bg-blue" style="padding: 8px;">หูซ้าย (Left ear)</th>
                        </tr>
                        <tr>
                            <th style="padding: 8px; background: #f8fafc;">Hz</th>
                            <th class="bg-red">500</th><th class="bg-red">1k</th><th class="bg-red">2k</th><th class="bg-red">3k</th><th class="bg-red">4k</th><th class="bg-red">6k</th><th class="bg-red">8k</th>
                            <th class="bg-blue">500</th><th class="bg-blue">1k</th><th class="bg-blue">2k</th><th class="bg-blue">3k</th><th class="bg-blue">4k</th><th class="bg-blue">6k</th><th class="bg-blue">8k</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td style="font-weight: bold; background: #f8fafc; padding: 8px;">dB</td>
                            ${rFreqs.map(f => `<td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">${latest[f] !== '' ? latest[f] : '-'}</td>`).join('')}
                            ${lFreqs.map(f => `<td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: 600;">${latest[f] !== '' ? latest[f] : '-'}</td>`).join('')}
                        </tr>
                    </tbody>
                </table>`;
                
            const selBase = document.getElementById('selBaseline'), selComp = document.getElementById('selCompare');
            selBase.innerHTML = ''; selComp.innerHTML = '';
            
            currentHistoryData.forEach((h, idx) => {
                const tLabel = h.test_type === 'Confirm' ? 'ยืนยัน' : (h.test_type === 'Pre-employment' ? 'ก่อนเริ่มงาน' : 'ประจำปี');
                const label = `ปี ${h.exam_year} (${tLabel})`;
                selBase.innerHTML += `<option value="${idx}">${label}</option>`;
                selComp.innerHTML += `<option value="${idx}" ${idx === currentHistoryData.length - 1 ? 'selected' : ''}>${label}</option>`;
            });
            
            renderAudiogram(currentHistoryData);
            calculateShift();
        } else {
            currentHistoryData = [];
            document.getElementById('latestHearingInfo').innerHTML = '<span style="color: #888;">ยังไม่มีประวัติการตรวจ</span>';
            document.getElementById('latestTestTableContainer').innerHTML = '';
            const container = document.getElementById('matrixTableContainer');
            if (container) container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">ไม่มีประวัติการตรวจ</div>';
            if (audiogramChartInstance) { audiogramChartInstance.destroy(); audiogramChartInstance = null; }
            document.getElementById('selBaseline').innerHTML = '';
            document.getElementById('selCompare').innerHTML = '';
            document.getElementById('shiftResult').innerHTML = '';
        }
    } catch (e) { console.error(e); }
}

document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); searchEmployee(); }
        });
    }
    const hearingInputs = document.querySelectorAll('input[id^="h_r"], input[id^="h_l"], input[id^="n_r"], input[id^="n_l"]');
    hearingInputs.forEach(input => {
        input.addEventListener('blur', function () { validateHearingInput(this); });
        input.addEventListener('input', function () {
            const existingError = this.parentNode.querySelector('.input-error-msg');
            if (existingError) existingError.remove();
            this.classList.remove('input-error');
            this.style.borderColor = '#cbd5e1';
        });
    });

    // 1. Edit Employee Form
    const formEdit = document.getElementById('formEditEmp');
    if (formEdit) {
        formEdit.addEventListener('submit', async (e) => {
            e.preventDefault();
            const oldId = currentEmpData.emp_id;
            const newId = document.getElementById('e_emp_id').value;
            if (oldId !== newId) {
                if (!confirm(`⚠️ คุณกำลังเปลี่ยนรหัสจาก "${oldId}" เป็น "${newId}"\nประวัติการตรวจทั้งหมดจะถูกย้ายตามไปด้วย ยืนยันหรือไม่?`)) return;
            }
            const data = {
                old_emp_id: oldId,
                emp_id: newId,
                title: document.getElementById('e_title').value,
                first_name: document.getElementById('e_first_name').value,
                last_name: document.getElementById('e_last_name').value,
                birth_date: document.getElementById('e_birth_date').value,
                age: document.getElementById('e_age').value,
                emp_type: document.getElementById('e_emp_type').value,
                start_date: document.getElementById('e_start_date').value,
                status: document.getElementById('e_status').value,
                medical_history: document.getElementById('e_medical_history').value,
                dept_code: currentEmpData.dept_code || '',
                department: currentEmpData.department || '',
                position: currentEmpData.position || '',
                measurement_point: document.getElementById('e_measurement_point').value.trim()
            };
            showLoader();
            const result = await postApi({ action: 'saveEmployee', data });
            hideLoader();
            if (result.success === false) return alert('❌ ' + (result.error || 'บันทึกไม่สำเร็จ'));
            alert(result.message || 'อัปเดตข้อมูลสำเร็จ!');
            closeEditEmployeeModal();
            searchEmployee();
        });
    }

    // 2. New Employee Form
    const formNew = document.getElementById('formNewEmployee');
    if (formNew) {
        formNew.addEventListener('submit', async (e) => {
            e.preventDefault();
            const errors = formNew.querySelectorAll('.input-error-msg');
            if (errors.length > 0) {
                alert(`❌ ไม่สามารถบันทึกได้!\nพบช่องที่กรอกค่าไม่ถูกต้อง ${errors.length} ช่อง`);
                errors[0].previousElementSibling.focus();
                return;
            }
            const newEmpId = document.getElementById('n_emp_id').value.trim();
            const firstName = document.getElementById('n_first_name').value.trim();
            const lastName = document.getElementById('n_last_name').value.trim();
            const deptCode = document.getElementById('n_dept_code').value.trim();
            const deptName = document.getElementById('n_dept_name').value.trim();
            const position = document.getElementById('n_position').value.trim();
            const examDate = document.getElementById('n_date').value;
            const examYear = document.getElementById('n_year').value;
            const birthDate = document.getElementById('n_birth_date').value;
            const age = document.getElementById('n_age').value;
            const empType = document.getElementById('n_emp_type').value;
            const startDate = document.getElementById('n_start_date').value;
            const medHist = document.getElementById('n_medical_history')?.value || '';
            
            const measurementPoint = document.getElementById('n_measurement_point')?.value.trim() || '';

            const errorMsg = document.getElementById('id_error_msg');
            if (errorMsg && errorMsg.style.display === 'block') return alert('❌ ไม่สามารถบันทึกได้! รหัสพนักงานนี้มีอยู่ในระบบแล้ว');
            if (!newEmpId) return alert('❌ กรุณากรอกรหัสพนักงาน');
            if (!firstName || !lastName) return alert('❌ กรุณากรอกชื่อและนามสกุล');
            if (!deptCode || !deptName || deptName === '(ไม่พบรหัสแผนกนี้)') return alert('❌ กรุณากรอกรหัสแผนกให้ถูกต้อง');
            if (!position) return alert('❌ ไม่พบข้อมูลตำแหน่งสำหรับแผนกนี้');
            if (!examDate || !examYear) return alert('❌ กรุณาระบุวันที่ตรวจสุขภาพ (Baseline)');
            if (!measurementPoint) return alert('❌ กรุณาเลือกจุดตรวจ / เครื่องจักร (Measurement Point)');

            const freqs = ['n_r500','n_r1000','n_r2000','n_r3000','n_r4000','n_r6000','n_r8000','n_l500','n_l1000','n_l2000','n_l3000','n_l4000','n_l6000','n_l8000'];
            for (const f of freqs) {
                const el = document.getElementById(f);
                if (!el || String(el.value).trim() === '') return alert(`❌ กรุณากรอกค่าการได้ยินให้ครบทุกช่อง (ขาดช่อง ${f.toUpperCase().replace('N_', '')})`);
            }
            showLoader();
            try {
                const resCheck = await fetch(API_URL + '?action=getEmployees');
                const jsonCheck = await resCheck.json();
                if (jsonCheck.success) {
                    const isDuplicate = jsonCheck.data.some(emp => String(emp.emp_id).trim() === newEmpId);
                    if (isDuplicate) { hideLoader(); return alert(`❌ ไม่สามารถบันทึกได้!\nรหัสพนักงาน "${newEmpId}" มีอยู่ในระบบแล้ว`); }
                }
                const titleRadio = document.querySelector('input[name="n_title_radio"]:checked');
                const title = titleRadio ? titleRadio.value : 'นาย';
                const empData = {
                    old_emp_id: '', emp_id: newEmpId, title: title, first_name: firstName, last_name: lastName,
                    dept_code: deptCode, department: deptName, position: position,
                    status: 'Active', birth_date: birthDate, age: age, emp_type: empType, start_date: startDate,
                    medical_history: medHist, measurement_point: measurementPoint
                };
                const resEmp = await postApi({ action: 'saveEmployee', data: empData });
                if (resEmp.success === false) { hideLoader(); return alert('❌ ' + (resEmp.error || 'บันทึกพนักงานไม่สำเร็จ')); }

                const hearingData = {
                    emp_id: newEmpId, exam_year: examYear, exam_date: examDate, test_type: 'Pre-employment',
                    r500: document.getElementById('n_r500').value, r1000: document.getElementById('n_r1000').value,
                    r2000: document.getElementById('n_r2000').value, r3000: document.getElementById('n_r3000').value,
                    r4000: document.getElementById('n_r4000').value, r6000: document.getElementById('n_r6000').value, r8000: document.getElementById('n_r8000').value,
                    l500: document.getElementById('n_l500').value, l1000: document.getElementById('n_l1000').value,
                    l2000: document.getElementById('n_l2000').value, l3000: document.getElementById('n_l3000').value,
                    l4000: document.getElementById('n_l4000').value, l6000: document.getElementById('n_l6000').value, l8000: document.getElementById('n_l8000').value
                };
                const resHear = await postApi({ action: 'saveHearingTest', data: hearingData });
                hideLoader();
                if (resHear.success === false) { alert('⚠️ บันทึกพนักงานสำเร็จ แต่บันทึก Baseline ไม่สำเร็จ: ' + (resHear.error || '')); return; }
                const wantToPrint = confirm('✅ เพิ่มพนักงานใหม่และบันทึก Baseline สำเร็จ!\n\nต้องการพิมพ์รายงานผลตรวจเลยหรือไม่?');
                formNew.reset(); hideAddEmployeeForm();
                if (wantToPrint) printEmployeeReport(newEmpId, true);
            } catch (err) { hideLoader(); console.error(err); alert('❌ เกิดข้อผิดพลาดในการเชื่อมต่อ'); }
        });
    }
    // 3. Add Hearing Form
    const formHearing = document.getElementById('formAddHearing');
    if (formHearing) {
        formHearing.addEventListener('submit', async (e) => {
            e.preventDefault();
            const errors = document.querySelectorAll('#formAddHearing .input-error-msg');
            if (errors.length > 0) {
                alert(`❌ ไม่สามารถบันทึกได้!\nพบช่องที่กรอกค่าไม่ถูกต้อง ${errors.length} ช่อง`);
                errors[0].previousElementSibling.focus();
                return;
            }
            const testType = document.getElementById('h_test_type').value;
            const empId = document.getElementById('h_emp_id').value;
            const hearingFields = ['h_r500','h_r1000','h_r2000','h_r3000','h_r4000','h_r6000','h_r8000','h_l500','h_l1000','h_l2000','h_l3000','h_l4000','h_l6000','h_l8000'];
            for (const f of hearingFields) {
                const el = document.getElementById(f);
                if (!el || String(el.value).trim() === '') return alert(`❌ กรุณากรอกค่าการได้ยินให้ครบทุกช่อง (ขาดช่อง ${f.toUpperCase().replace('H_', '')})`);
            }
            const data = {
                emp_id: empId, exam_year: document.getElementById('h_year').value, exam_date: document.getElementById('h_date').value, test_type: testType,
                r500: document.getElementById('h_r500').value, r1000: document.getElementById('h_r1000').value,
                r2000: document.getElementById('h_r2000').value, r3000: document.getElementById('h_r3000').value,
                r4000: document.getElementById('h_r4000').value, r6000: document.getElementById('h_r6000').value, r8000: document.getElementById('h_r8000').value,
                l500: document.getElementById('h_l500').value, l1000: document.getElementById('h_l1000').value,
                l2000: document.getElementById('h_l2000').value, l3000: document.getElementById('h_l3000').value,
                l4000: document.getElementById('h_l4000').value, l6000: document.getElementById('h_l6000').value, l8000: document.getElementById('h_l8000').value
            };
            showLoader();
            const result = await postApi({ action: 'saveHearingTest', data });
            hideLoader();
            if (result.success === false) return alert('❌ ' + (result.error || 'บันทึกไม่สำเร็จ'));
            const wantToPrint = confirm('✅ บันทึกผลตรวจใหม่สำเร็จ!\n\nต้องการพิมพ์รายงานผลตรวจเลยหรือไม่?');
            closeHearingModal(); loadHearingHistory(empId);
            if (wantToPrint) printEmployeeReport(empId, true);
        });
    }
});

function getMappedMeasurementPoint(empLocation) {
    if (!empLocation) return '';
    const key = normalizePointKey(empLocation);
    const mapping = globalMappingData.find(m => {
        if (!isMappingActiveRow(m)) return false;
        return normalizePointKey(m.emp_location) === key;
    });
    return mapping ? String(mapping.mapped_measurement_point || '').trim() : String(empLocation).trim();
}

function calculateShift() {
    if (!currentHistoryData || currentHistoryData.length === 0) return;
    const baseIdx = parseInt(document.getElementById('selBaseline').value);
    const compIdx = parseInt(document.getElementById('selCompare').value);
    const base = currentHistoryData[baseIdx];
    const comp = currentHistoryData[compIdx];
    if (!base || !comp) return;
    
    const freqs = ['r500','r1000','r2000','r3000','r4000','r6000', 'l500','l1000','l2000','l3000','l4000','l6000'];
    let maxShift = 0;
    freqs.forEach(f => {
        const diff = (Number(comp[f]) || 0) - (Number(base[f]) || 0);
        if (diff > maxShift) maxShift = diff;
    });
    const isRisk = maxShift >= window.STS_LIMIT;
    const color = isRisk ? 'text-danger' : 'text-success';
    document.getElementById('shiftResult').innerHTML = `
        เทียบปี <b>${base.exam_year}</b> กับ <b>${comp.exam_year}</b>:
        ผลต่างสูงสุด <span class="${color}">${maxShift} dB</span> ${isRisk ? '(⚠️ เสี่ยง)' : ''}
        <span style="font-size:0.8rem; color:#666; display:block; margin-top:5px;">* คำนวณจาก 6 ความถี่หลัก (ไม่รวม 8000 Hz), ค่าบวก = แย่ลง</span>`;
    
    // ✅ แก้บั๊กแล้ว: ส่ง 3 ตัวแปรให้ฟังก์ชัน renderHistoryTable
    renderHistoryTable(currentHistoryData, base, comp);
}

function renderHistoryTable(history, baseline, comp) {
    const container = document.getElementById('matrixTableContainer');
    if (!container || history.length === 0 || !currentEmpData) return;

    const compYear = Number(comp.exam_year);
    const baseYear = Number(baseline.exam_year);
    
    // ==========================================
    // 1. คำนวณช่วงห่างของอายุ (Age Correction)
    // ==========================================
    const currentAge = Number(currentEmpData.age) || 0;
    const birthYear = currentEmpData.birth_date ? new Date(currentEmpData.birth_date).getFullYear() + 543 : 0;
    
    let baseAge = 0, compAge = 0;
    if (birthYear > 0) {
        baseAge = baseYear - birthYear;
        compAge = compYear - birthYear;
    } else {
        const currentYear = new Date().getFullYear() + 543;
        baseAge = currentAge - (currentYear - baseYear);
        compAge = currentAge - (currentYear - compYear);
    }
    const ageDiff = Math.max(0, compAge - baseAge); 

    // ==========================================
    // 2. ค้นหาข้อมูลเสียง (แบบมีเงื่อนไข + Fallback)
    // ==========================================
    const empLocation = String(currentEmpData.measurement_point || '').trim();
    const mappedPoint = getMappedMeasurementPoint(empLocation); 
    const deptCode = String(currentEmpData.dept_code || '').trim();

    // ขั้นที่ 1: หาข้อมูลทั้งหมดที่จุดตรวจตรงกันก่อน (ไม่กรองปี)
    let allNoiseForPoint = globalNoiseData.filter(n => {
        const noisePointKey = n.clean_point_key || normalizePointKey(n.measurement_point || n.area_id);
        return noisePointKey === mappedPoint;
    });

    // ถ้าไม่เจอจุดตรวจตรงๆ ให้ลองหาจากแผนก (Representative)
    if (allNoiseForPoint.length === 0) {
        allNoiseForPoint = globalNoiseData.filter(n => {
            const sameDept = String(n.area_id || '').trim() === deptCode;
            const isRep = String(n.is_representative || '').toUpperCase() === 'YES';
            return sameDept && isRep;
        });
    }

    // ขั้นที่ 2: กรองด้วยเงื่อนไขเดิม (y <= compYear && y > (compYear - 3))
    let recentNoise = allNoiseForPoint.filter(n => {
        const y = Number(n.survey_year);
        return y <= compYear && y > (compYear - 3);
    });

    // 🌟 ขั้นที่ 3: Fallback - ถ้ากรองตามเงื่อนไขเดิมแล้วไม่เจอ ให้ดึง 3 ปีล่าสุดที่มีในระบบแทน
    if (recentNoise.length === 0 && allNoiseForPoint.length > 0) {
        // เรียงจากปีใหม่สุดไปเก่าสุด แล้วตัดมา 3 อันดับแรก
        allNoiseForPoint.sort((a, b) => Number(b.survey_year) - Number(a.survey_year));
        recentNoise = allNoiseForPoint.slice(0, 3);
    } else {
        // ถ้าเจอตามเงื่อนไขเดิมแล้ว ให้เรียงจากใหม่ไปเก่าตามปกติ
        recentNoise.sort((a, b) => Number(b.survey_year) - Number(a.survey_year));
    }

    const rFreqs = ['r500','r1000','r2000','r3000','r4000','r6000','r8000'];
    const lFreqs = ['l500','l1000','l2000','l3000','l4000','l6000','l8000'];

    // ==========================================
    // 3. วาดตาราง HTML
    // ==========================================
    container.innerHTML = `
    <div class="matrix-table-container">
        <table class="matrix-table">
            <thead>
                <tr>
                    <th rowspan="2" style="background:white; border:none; text-align:left; padding-left:10px;">การตรวจ</th>
                    <th colspan="7" class="bg-red">หูขวา (Right ear)</th>
                    <th colspan="7" class="bg-blue">หูซ้าย (Left ear)</th>
                </tr>
                <tr>
                    <th class="bg-red">500</th><th class="bg-red">1000</th><th class="bg-red">2000</th><th class="bg-red">3000</th><th class="bg-red">4000</th><th class="bg-red">6000</th><th class="bg-red">8000</th>
                    <th class="bg-blue">500</th><th class="bg-blue">1000</th><th class="bg-blue">2000</th><th class="bg-blue">3000</th><th class="bg-blue">4000</th><th class="bg-blue">6000</th><th class="bg-blue">8000</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td class="bg-green" style="text-align: left;">ปีฐาน (${baseline.exam_year})</td>
                    ${rFreqs.map(f => `<td class="val-cell">${baseline[f] !== undefined && baseline[f] !== '' ? baseline[f] : '-'}</td>`).join('')}
                    ${lFreqs.map(f => `<td class="val-cell blue-bg">${baseline[f] !== undefined && baseline[f] !== '' ? baseline[f] : '-'}</td>`).join('')}
                </tr>
                
                <tr>
                    <td class="bg-pink" style="text-align: left;">ผลตรวจปี (${comp.exam_year})</td>
                    ${rFreqs.map(f => `<td class="val-cell">${comp[f] !== undefined && comp[f] !== '' ? comp[f] : '-'}</td>`).join('')}
                    ${lFreqs.map(f => `<td class="val-cell blue-bg">${comp[f] !== undefined && comp[f] !== '' ? comp[f] : '-'}</td>`).join('')}
                </tr>

                <tr>
                    <td class="bg-secondary" style="text-align: left; color:#475569; font-size:0.85rem;" title="อายุเพิ่มขึ้น ${ageDiff} ปี (หักปีละ 0.5 dB)">
                        ปรับแก้ตามอายุ<br>+${ageDiff} ปี (0.5 dB/ปี)
                    </td>
                    ${rFreqs.map(() => `<td class="val-cell" style="background:#f1f5f9; color:#64748b;">${(ageDiff * 0.5).toFixed(1)}</td>`).join('')}
                    ${lFreqs.map(() => `<td class="val-cell blue-bg" style="background:#e0f2fe; color:#0369a1;">${(ageDiff * 0.5).toFixed(1)}</td>`).join('')}
                </tr>
                
                <tr>
                    <td class="bg-yellow" style="text-align: left;">ผลต่างดิบ<br><small style="font-size:0.7rem;color:#888;">(ล่าสุด - ปีฐาน)</small></td>
                    ${rFreqs.map(f => {
                        const diff = (Number(comp[f]) || 0) - (Number(baseline[f]) || 0);
                        const cls = diff < 0 ? 'text-shift-neg' : (diff > 0 ? 'text-shift-pos' : '');
                        return `<td class="val-cell ${cls}" style="opacity:0.7;">${diff > 0 ? '+' : ''}${diff}</td>`;
                    }).join('')}
                    ${lFreqs.map(f => {
                        const diff = (Number(comp[f]) || 0) - (Number(baseline[f]) || 0);
                        const cls = diff < 0 ? 'text-shift-neg' : (diff > 0 ? 'text-shift-pos' : '');
                        return `<td class="val-cell blue-bg ${cls}" style="opacity:0.7;">${diff > 0 ? '+' : ''}${diff}</td>`;
                    }).join('')}
                </tr>

                <tr>
                    <td class="bg-warning" style="text-align: left; font-weight:bold; color:#b45309;">ผลต่างสุทธิ<br><small style="font-size:0.7rem;">(หักอายุแล้ว)</small></td>
                    ${rFreqs.map(f => {
                        const rawDiff = (Number(comp[f]) || 0) - (Number(baseline[f]) || 0);
                        const netDiff = Math.round(rawDiff - (ageDiff * 0.5)); 
                        const cls = netDiff < 0 ? 'text-shift-neg' : (netDiff > 0 ? 'text-shift-pos' : '');
                        return `<td class="val-cell ${cls}" style="font-weight:bold;">${netDiff > 0 ? '+' : ''}${netDiff}</td>`;
                    }).join('')}
                    ${lFreqs.map(f => {
                        const rawDiff = (Number(comp[f]) || 0) - (Number(baseline[f]) || 0);
                        const netDiff = Math.round(rawDiff - (ageDiff * 0.5));
                        const cls = netDiff < 0 ? 'text-shift-neg' : (netDiff > 0 ? 'text-shift-pos' : '');
                        return `<td class="val-cell blue-bg ${cls}" style="font-weight:bold;">${netDiff > 0 ? '+' : ''}${netDiff}</td>`;
                    }).join('')}
                </tr>
                
                <!-- แถวตรวจสภาพแวดล้อม -->
                <tr>
                    <td class="bg-pink" style="text-align: left; vertical-align:top; padding-top:10px;">ตรวจสภาพแวดล้อม<br>(3 ปีย้อนหลัง)</td>
                    <td colspan="14" style="background:#fce7f3; text-align: left; padding: 10px;">
                        ${recentNoise.length > 0 ? recentNoise.map(n => {
                            const twa = Number(n.twa_dba);
                            const isDanger = twa >= window.NOISE_LIMIT;
                            const color = isDanger ? 'var(--danger)' : 'var(--success)';
                            const ppeText = n.ppe_type ? ` | PPE: <b>${esc(n.ppe_type)}</b>` : ' | ไม่ได้ใส่ PPE';
                            
                            // แสดงข้อความกำกับเล็กน้อยถ้าเป็นข้อมูล Fallback (หลุดช่วง 3 ปีที่ตรวจหู)
                            const isFallback = Number(n.survey_year) > compYear;
                            const fallbackLabel = isFallback ? ' <span style="font-size:0.75rem; color:#b45309;">(ข้อมูลล่าสุดของจุดตรวจ)</span>' : '';

                            return `<div style="margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px dashed #fbcfe8; font-size: 0.9rem;">
                                <strong>ปี ${esc(n.survey_year)}:</strong>${fallbackLabel} 
                                เครื่องจักร/จุดตรวจ <b>${esc(n.measurement_point)}</b> | 
                                ค่า TWA: <span style="color:${color}; font-weight:bold;">${twa} dBA</span> 
                                ${isDanger ? '<span style="color:var(--danger);">(⚠️ เกินมาตรฐาน)</span>' : '(ปกติ)'} 
                                ${ppeText}
                            </div>`;
                        }).join('') : `<span style="font-size: 0.9rem; color:#666;">
                            ไม่พบข้อมูลตรวจวัดเสียงของจุดตรวจนี้ <br>
                            <small>(ค้นหาโดยใช้รหัส: ${esc(mappedPoint)})</small>
                        </span>`}
                    </td>
                </tr>

                <tr>
                    <td class="bg-green" style="vertical-align: middle;">สรุปผลประเมิน</td>
                    <td colspan="14" style="background:#10b981; text-align: left; padding: 10px;">
                        <div style="font-size: 0.95rem; color: var(--text-main);">
                            ${comp.note ? `<strong>บันทึกเดิม:</strong> ${esc(comp.note)}` : '<span style="color:#888;">- ยังไม่มีบันทึกแพทย์ -</span>'}
                        </div>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
    
    <!-- ส่วนพิมพ์บันทึกแพทย์ -->
    <div class="medical-note-section" style="margin-top: 20px; background: #f8fafc; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0;">
        <h4 style="margin-bottom: 10px; color: var(--primary); font-family: 'Kanit';"><i class="fa-solid fa-pen-clip"></i> บันทึกสรุปผลประเมินโดยแพทย์</h4>
        <textarea id="doctorSummaryInput" placeholder="พิมพ์สรุปผลประเมิน..." style="width: 100%; min-height: 80px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 10px; font-family: 'Sarabun'; outline: none; font-size: 0.95rem;">${esc(comp.note || '')}</textarea>
        <div style="text-align: right; margin-top: 10px;">
            <button onclick="saveMedicalSummary('${esc(comp.test_id)}')" class="btn-primary" style="padding: 10px 20px; font-size: 0.95rem;"><i class="fa-solid fa-save"></i> บันทึกบันทึกแพทย์</button>
        </div>
    </div>`;
}

async function saveMedicalSummary(testId) {
    const note = document.getElementById('doctorSummaryInput').value;
    const empId = currentEmpData ? currentEmpData.emp_id : '';
    if (!empId) { alert('ไม่พบรหัสพนักงาน'); return; }
    showLoader();
    const result = await postApi({ action: 'saveMedicalFollowUp', data: { test_id: testId, note } });
    hideLoader();
    if (result.success === false) return alert('❌ ' + (result.error || 'บันทึกไม่สำเร็จ'));
    alert('บันทึกข้อความแพทย์สำเร็จ!');
    loadHearingHistory(empId);
}

function renderAudiogram(history) {
    const canvas = document.getElementById('audiogramChart');
    if (!canvas) return;
    if (audiogramChartInstance) audiogramChartInstance.destroy();
    audiogramChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: history.map(h => `ปี ${h.exam_year}`),
            datasets: [
                { label: 'หูขวา 4000Hz', data: history.map(h => Number(h.r4000) || 0), borderColor: '#3b82f6', tension: 0.3 },
                { label: 'หูซ้าย 4000Hz', data: history.map(h => Number(h.l4000) || 0), borderColor: '#ef4444', tension: 0.3 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { reverse: true, min: -10, max: 120 } } }
    });
}

function printEmployeeReport(targetEmpId = null, autoPrint = false) {
    const empIdToPrint = targetEmpId || (currentEmpData ? currentEmpData.emp_id : null);
    if (!empIdToPrint) return alert('ไม่พบข้อมูลพนักงานสำหรับพิมพ์รายงาน');
    let selectedYearParam = '';
    const selCompare = document.getElementById('selCompare');
    if (selCompare && selCompare.selectedIndex !== -1) {
        const selectedIndex = selCompare.selectedIndex;
        if (currentHistoryData && currentHistoryData[selectedIndex]) {
            const yearCE = currentHistoryData[selectedIndex].exam_year;
            selectedYearParam = `&year=${yearCE}`;
        }
    }
    const printParam = autoPrint ? '&print=true' : '';
    const url = `report.html?emp_id=${empIdToPrint}${selectedYearParam}${printParam}`;
    window.open(url, '_blank');
}

// 🌟 ฟังก์ชันดึงรายชื่อจุดตรวจ (emp_location) มาใส่ Dropdown
async function populateMeasurementPoints(selectedEmpLoc = '') {
    try {
        const res = await fetch(API_URL + '?action=getLocationMapping');
        const json = await res.json();
        
        if (json.success && json.data) {
            const mappingData = json.data;
            const uniqueLocations = new Set();
            
            // หา emp_location ที่ไม่ซ้ำกัน
            mappingData.forEach(m => {
                if (!isMappingActiveRow(m)) return;
                const loc = String(m.emp_location || '').trim();
                if (loc) uniqueLocations.add(loc);
            });

            const sortedLocs = Array.from(uniqueLocations).sort();

            // สร้าง Options
            let optionsHTML = '<option value="">-- กรุณาเลือกเครื่องจักร --</option>';
            sortedLocs.forEach(loc => {
                const selected = (loc === selectedEmpLoc) ? 'selected' : '';
                optionsHTML += `<option value="${esc(loc)}" ${selected}>${esc(loc)}</option>`;
            });

            // ใส่ใน Dropdown ทั้ง 2 ฟอร์ม
            const nPointSelect = document.getElementById('n_measurement_point');
            const ePointSelect = document.getElementById('e_measurement_point');
            if (nPointSelect) nPointSelect.innerHTML = optionsHTML;
            if (ePointSelect) ePointSelect.innerHTML = optionsHTML;

            // ถ้ามีค่าเริ่มต้น ให้ Trigger หาค่า Mapped Point
            if (selectedEmpLoc) {
                updateMappedPointDisplay(selectedEmpLoc, 'n_mapped_point');
            }
        }
    } catch (e) {
        console.error('Failed to load mapping for dropdown:', e);
    }
}

// 🌟 ฟังก์ชันค้นหา mapped_measurement_point จาก emp_location ที่เลือก
function updateMappedPointDisplay(empLoc, hiddenInputId) {
    const hiddenInput = document.getElementById(hiddenInputId);
    if (!hiddenInput) return;

    if (!empLoc) {
        hiddenInput.value = '';
        return;
    }

    // ดึงข้อมูลจาก Global (ถ้ามี) หรือดึงจาก API
    if (typeof globalMappingData !== 'undefined' && globalMappingData.length > 0) {
        const mapping = globalMappingData.find(m => 
            normalizePointKey(m.emp_location) === normalizePointKey(empLoc)
        );
        
        if (mapping) {
            hiddenInput.value = String(mapping.mapped_measurement_point || '').trim();
        } else {
            hiddenInput.value = '';
        }
    } else {
        // ถ้ายังไม่มี globalMappingData ให้ดึง API
        fetch(API_URL + '?action=getLocationMapping')
            .then(res => res.json())
            .then(json => {
                if (json.success && json.data) {
                    const mapping = json.data.find(m => 
                        normalizePointKey(m.emp_location) === normalizePointKey(empLoc)
                    );
                    hiddenInput.value = mapping ? String(mapping.mapped_measurement_point || '').trim() : '';
                }
            });
    }
}