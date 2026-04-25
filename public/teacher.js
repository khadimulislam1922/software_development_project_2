const backendUrl = 'http://localhost:8000';

// --- Teacher Designations Database ---
const designations = {
    "T-01": "Professor (Head)",
    "T-02": "Assistant Professor",
    "T-03": "Assistant Professor",
    "T-04": "Assistant Professor",
    "T-05": "Assistant Professor",
    "T-06": "Assistant Professor",
    "T-07": "Assistant Professor",
    "T-08": "Lecturer"
};

// ==========================================
// ১. INITIALIZATION (Dynamic Loading Fixed)
// ==========================================
window.onload = async function() {
    console.log("Teacher Dashboard Loaded.");
    
    // লগইন পেজ থেকে সেভ করা আইডি আর নাম নিয়ে আসা
    const teacherId = localStorage.getItem('loggedInTeacherId');
    const teacherName = localStorage.getItem('loggedInTeacherName');

    if (!teacherId) {
        window.location.href = 'login.html';
        return;
    }

    // 🚀 HTML-এ ডায়নামিক নাম বসানো
    const nameElem = document.getElementById('teacherNameDisplay') || document.getElementById('teacherName');
    if (nameElem) nameElem.innerText = teacherName || "Faculty Member";

    const designationEl = document.getElementById('teacherDesignation');
    if (designationEl) designationEl.innerText = designations[teacherId] || "Faculty Member";

    const savedPic = localStorage.getItem(`profilePic_${teacherId}`);
    if (savedPic) {
        document.getElementById('profilePic').src = savedPic;
    } else {
        const formattedName = encodeURIComponent(teacherName || teacherId); 
        document.getElementById('profilePic').src = `https://ui-avatars.com/api/?name=${formattedName}&background=0D47A1&color=fff&size=100`;
    }

    if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark-theme');
        document.getElementById('themeBtn').innerText = '☀️';
    }

    // 🚀 কোর্স লোড করা
    await loadTeacherCourses(teacherId);
    await loadManualDropdownCourses(teacherId); // ম্যানুয়াল সেশনের কোর্সও এখানেই লোড করে দিচ্ছি
};

// ==========================================
// ২. PROFILE & THEME FUNCTIONS
// ==========================================
function changeProfilePic(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const base64Image = e.target.result;
            document.getElementById('profilePic').src = base64Image;
            const teacherId = localStorage.getItem('loggedInTeacherId');
            localStorage.setItem(`profilePic_${teacherId}`, base64Image); 
        };
        reader.readAsDataURL(file);
    }
}

function toggleTheme() {
    const body = document.body;
    const themeBtn = document.getElementById('themeBtn');
    
    body.classList.toggle('dark-theme');

    if (body.classList.contains('dark-theme')) {
        localStorage.setItem('theme', 'dark');
        themeBtn.innerText = '☀️';
    } else {
        localStorage.setItem('theme', 'light');
        themeBtn.innerText = '🌙';
    }
}

function logout() {
    localStorage.clear(); 
    window.location.href = 'login.html';
}

// ==========================================
// ৩. COURSE DATA LOADING
// ==========================================
async function loadTeacherCourses(tId) {
    try {
        const response = await fetch(`${backendUrl}/api/teacher/my-courses/${tId}`);
        const courses = await response.json();
        
        const liveSelect = document.getElementById('liveCourseSelect');
        const ctSelect = document.getElementById('courseSelect'); 
        const profileList = document.getElementById('assignedCoursesList'); 
        
        if (courses.length > 0) {
            if(liveSelect) liveSelect.innerHTML = '';
            if(ctSelect) ctSelect.innerHTML = '';
            if(profileList) profileList.innerHTML = ''; 
            
            courses.forEach(c => {
                const code = c.course_code;
                const option = `<option value="${code}">${code}</option>`;
                if(liveSelect) liveSelect.innerHTML += option;
                if(ctSelect) ctSelect.innerHTML += option;
                
                if(profileList) {
                    profileList.innerHTML += `
                        <li style="background: var(--card-bg-color); padding: 10px 15px; border-radius: 6px; border-left: 4px solid var(--accent-color); font-size: 14px; font-weight: 500; border: 1px solid var(--border-color); color: var(--text-main);">
                            ✨ ${code}
                        </li>`;
                }
            });
            console.log("Courses loaded successfully!");
        } else {
            if(profileList) profileList.innerHTML = '<li style="color: #ff6b6b; font-size: 13px;">🚫 No courses assigned yet.</li>';
        }
    } catch (error) {
        console.error("Error loading courses:", error);
    }
}

// ==========================================
// ৪. EXCEL UPLOAD & DOWNLOAD
// ==========================================
async function uploadExcel() {
    const fileInput = document.getElementById('excelFile');
    const courseCode = document.getElementById('courseSelect').value;

    if (!fileInput.files[0]) return alert("Please select an Excel file first!");

    const formData = new FormData();
    formData.append('excel_file', fileInput.files[0]);
    formData.append('course_code', courseCode);

    try {
        document.getElementById('uploadExcelBtn').innerText = "Calculating..."; 

        const response = await fetch(`${backendUrl}/api/teacher/upload-ct`, {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.error) {
            alert(data.error);
        } else {
            alert(data.message); 
            fileInput.value = ""; 
        }
    } catch (error) {
        alert("Failed to upload file!");
    } finally {
        document.getElementById('uploadExcelBtn').innerText = "Upload & Calculate CT";
    }
}

window.downloadAttendanceReport = function() {
    const courseCode = document.getElementById('courseSelect').value; 
    
    if (!courseCode || courseCode === "") {
        return alert("❌ Please select a course from Reports section to download!");
    }

    // নতুন ডায়নামিক এক্সেল লিংকে পাঠিয়ে দেওয়া
    window.location.href = `${backendUrl}/api/teacher/export/${courseCode}`;
};

// ==========================================
// ৫. LIVE ATTENDANCE MONITORING
// ==========================================
let liveInterval;
let isLive = false;

function toggleLiveMonitor() {
    const btn = document.getElementById('liveBtn');
    const tableSection = document.getElementById('liveTableSection');
    const courseCode = document.getElementById('liveCourseSelect').value;
    
    if(!courseCode) {
        alert("No course selected!");
        return;
    }

    if (!isLive) {
        isLive = true;
        btn.innerText = "Stop Monitor";
        btn.style.backgroundColor = "#c62828"; 
        tableSection.style.display = "block";
        
        fetchLiveLogs(); 
        liveInterval = setInterval(fetchLiveLogs, 2000); // প্রতি ২ সেকেন্ডে ডাটা টানবে
    } else {
        isLive = false;
        btn.innerText = "Start Live Monitor";
        btn.style.backgroundColor = "#2e7d32"; 
        tableSection.style.display = "none";
        clearInterval(liveInterval);
    }
}

async function fetchLiveLogs() {
    const courseCode = document.getElementById('liveCourseSelect').value;
    if(!courseCode) return; 

    try {
        const response = await fetch(`${backendUrl}/api/teacher/live-attendance/${encodeURIComponent(courseCode)}`);
        const data = await response.json();
        
        const tbody = document.getElementById('liveTableBody');
        tbody.innerHTML = ''; 
        
        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:10px; color:var(--text-muted);">No punches yet today.</td></tr>';
            return;
        }

        data.forEach(log => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = "1px solid var(--border-color)";
            tr.innerHTML = `
                <td style="padding: 8px 10px; font-weight: bold; color: var(--text-main);">${log.roll_number}</td>
                <td style="padding: 8px 10px; color: var(--text-main);">${log.name || 'Unknown'}</td>
                <td style="padding: 8px 10px; color: var(--accent-color); font-weight: 500;">${log.time}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (error) {
        console.error("Live fetch error:", error);
    }
}

// ==========================================
// ৬. TEACHER PASSWORD CHANGE
// ==========================================
window.toggleTeacherPasswordForm = function() {
    const form = document.getElementById('teacherPasswordForm');
    if (form.style.display === 'none' || form.style.display === '') {
        form.style.display = 'block';
    } else {
        form.style.display = 'none';
    }
};

window.changeTeacherPassword = async function() {
    const oldPassword = document.getElementById('tOldPassword').value;
    const newPassword = document.getElementById('tNewPassword').value;
    const teacherId = localStorage.getItem('loggedInTeacherId');

    if (!oldPassword || !newPassword) {
        return alert("Please enter both current and new passwords!");
    }

    try {
        const response = await fetch(`${backendUrl}/api/teacher/change-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ teacher_id: teacherId, oldPassword: oldPassword, newPassword: newPassword })
        });

        const data = await response.json();

        if (data.error) {
            alert(data.error);
        } else {
            alert(data.message); 
            localStorage.setItem('loggedInTeacherPass', newPassword); 
            document.getElementById('tOldPassword').value = '';
            document.getElementById('tNewPassword').value = '';
            toggleTeacherPasswordForm();
        }
    } catch (error) {
        console.error("Error:", error);
        alert("Failed to change password!");
    }
};

// ==========================================
// 8. MANUAL SESSION CONTROL
// ==========================================

async function loadManualDropdownCourses(teacherId) {
    const manualSelect = document.getElementById('manualCourseSelect');
    if (!manualSelect) return;

    try {
        // 🚀 ফিক্সড: API URL এখন সার্ভারের সাথে ম্যাচ করছে
        const res = await fetch(`${backendUrl}/api/teacher/my-courses/${teacherId}`);
        const courses = await res.json();

        manualSelect.innerHTML = '<option value="" disabled selected>📚 Select Course</option>';

        courses.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.course_code;
            opt.textContent = c.course_code;
            manualSelect.appendChild(opt);
        });
    } catch (error) {
        console.error("Failed to load courses for manual session:", error);
    }
}

window.toggleManualSession = async function(action) {
    const teacherId = localStorage.getItem('loggedInTeacherId');
    
    let requestBody = { teacher_id: teacherId, action: action };

    if (action === 'start') {
        const courseCode = document.getElementById('manualCourseSelect').value;
        const deviceId = document.getElementById('manualDeviceSelect').value;

        if (!courseCode || courseCode === "") {
            return alert("❌ Please select a course to START the session!");
        }
        
        requestBody.course_code = courseCode;
        requestBody.device_id = deviceId;
    }

    try {
        const response = await fetch(`${backendUrl}/api/teacher/session/toggle`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });
        
        const data = await response.json();
        
        if (data.error) {
            alert(data.error); 
        } else {
            alert(data.message); 
        }
    } catch (error) {
        console.error(error);
        alert("❌ Server Error! Failed to toggle session.");
    }
};