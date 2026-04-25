const backendUrl = 'http://localhost:8000';

// --- ১. পেজ লোড হওয়ার সাথে সাথে সব ইনিশিয়ালাইজ করা ---
window.onload = function() {
    console.log("Admin Control Room Initialized.");
    
    // ড্রপডাউন লোড করা (টিচার ও কোর্স লিস্ট)
    loadAssignDropdowns();
    
    // রানিং ক্লাস মনিটর শুরু করা
    checkRunningClasses();
    setInterval(checkRunningClasses, 5000); 
};

// --- ২. ড্রপডাউনগুলোতে ডাটা লোড করা (টিচার ও কোর্স) ---
async function loadAssignDropdowns() {
    console.log("Fetching courses and teachers for dropdowns..."); 
    
    try {
        // কোর্স লিস্ট ফেচ করা
        const courseRes = await fetch(`${backendUrl}/api/admin/all-courses`);
        const courses = await courseRes.json();
        const courseSelect = document.getElementById('assignCourse');
        
        if (courseSelect) {
            courseSelect.innerHTML = '<option value="" disabled selected>Select a Course</option>'; 
            courses.forEach(c => {
                courseSelect.innerHTML += `<option value="${c.course_code}">${c.course_code} - ${c.course_name}</option>`;
            });
            console.log(`✅ ${courses.length} Courses loaded into dropdown.`);
        }

        // টিচার লিস্ট ফেচ করা
        const teacherRes = await fetch(`${backendUrl}/api/admin/all-teachers`);
        const teachers = await teacherRes.json();
        const teacherSelect = document.getElementById('assignTeacher');
        
        if (teacherSelect) {
            teacherSelect.innerHTML = '<option value="" disabled selected>Select a Teacher</option>'; 
            teachers.forEach(t => {
                teacherSelect.innerHTML += `<option value="${t.teacher_id}">${t.name} (${t.teacher_id})</option>`;
            });
            console.log(`✅ ${teachers.length} Teachers loaded into dropdown.`);
        }

    } catch (error) {
        console.error("❌ Error loading dropdowns:", error);
    }
}

// --- ৩. টিচারকে কোর্স অ্যাসাইন করা (সবচেয়ে গুরুত্বপূর্ণ) ---
async function assignTeacherToCourse() {
    const tSelect = document.getElementById('assignTeacher');
    const cSelect = document.getElementById('assignCourse');

    const tId = tSelect.value.trim().toUpperCase(); 
    let cCode = cSelect.value.trim(); // এটি এখন 'ECE-3111 - Microprocessor' ফরম্যাটে আসবে

    // ১. নাম থেকে শুধু কোড আলাদা করা (যেমন: ECE-3111)
    if(cCode.includes(' - ')) {
        cCode = cCode.split(' - ')[0];
    }

    if (!tId || !cCode) {
        return alert("Please select both a Teacher and a Course!");
    }

    try {
        const response = await fetch(`${backendUrl}/api/admin/assign-course`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                teacher_id: tId, 
                course_code: cCode // হাইফেনসহ ডাটা যাচ্ছে
            })
        });
        
        const data = await response.json();
        alert(`✅ Success: Assigned ${cCode} to ${tId}`);
        
    } catch (error) {
        alert("❌ Failed to assign!");
    }
}

// --- ৪. এক্সেল ফাইল বাল্ক আপলোড (Student/Teacher list) ---
async function adminBulkUpload(event) {
    if(event) event.preventDefault();

    const selectedUploadType = document.getElementById('uploadType').value; 
    const fileInput = document.getElementById('adminExcelFile');
    const btn = event.target; // বাটনটি সরাসরি পাওয়ার জন্য

    if (!fileInput.files[0]) {
        return alert("Please select an Excel file first!");
    }

    const formData = new FormData();
    formData.append('excel_file', fileInput.files[0]);
    formData.append('upload_type', selectedUploadType);

    try {
        btn.innerText = "⏳ Syncing...";
        btn.disabled = true;

        const response = await fetch(`${backendUrl}/api/admin/bulk-upload`, {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        if (data.error) {
            alert("❌ " + data.error);
        } else {
            alert("✅ " + data.message);
            fileInput.value = ""; 
        }
    } catch (error) {
        alert("❌ Network Error!");
    } finally {
        btn.innerText = "Upload & Sync";
        btn.disabled = false;
    }
}

// --- ৫. রানিং ক্লাস মনিটর (ডামি ডাটা দিয়ে দেখানো) ---
async function checkRunningClasses() {
    const container = document.getElementById('runningClassesContainer');
    if(!container) return;

    // আপাতত ডামি ডাটা, পরে API থেকে আসবে
    const mockRunningClasses = [
        { code: "ECE-3111", room: "Room 302", teacher: "Prof. Anwar Hossain" }
    ];

    container.innerHTML = ''; 
    mockRunningClasses.forEach(cls => {
        const badge = document.createElement('div');
        badge.className = 'running-class-badge';
        badge.innerHTML = `
            <div class="dot"></div>
            <strong>${cls.code}</strong> (${cls.room}) - ${cls.teacher}
        `;
        container.appendChild(badge);
    });
}

// --- ৬. থিম চেঞ্জ ---
function toggleAdminTheme() {
    document.body.classList.toggle('dark-theme');
}


// ==========================================
// 🔴 LIVE ACTIVE CLASSES (ADMIN MONITORING)
// ==========================================
async function loadActiveClasses() {
    try {
        const res = await fetch(`${backendUrl}/api/admin/active-classes`);
        const classes = await res.json();
        
        const container = document.getElementById('activeClassesContainer');
        if(!container) return;

        container.innerHTML = ''; 

        if (classes.length === 0) {
            container.innerHTML = '<p style="color: rgba(255,255,255,0.8); text-align: center;">No active classes running right now. 😴</p>';
            return;
        }

        // 🚀 Room Mapping Logic (Series to Room Number)
        const roomMap = {
            'DEV_21': '401',
            'DEV_22': '402',
            'DEV_23': '403',
            'DEV_24': '404'
        };

        classes.forEach(cls => {
            const div = document.createElement('div');
            div.className = "live-session-item";
            
            // DEV_21 কে 401 বানাবে, যদি লিস্টে না থাকে তাহলে ডিফল্টটা দেখাবে
            const roomName = roomMap[cls.room] || cls.room.replace('DEV_', ''); 
            
            div.innerHTML = `
                <div>
                    <h4>${cls.course_code}</h4>
                    <p>👨‍🏫 ${cls.teacher_name} (${cls.teacher_id})</p>
                </div>
                <div style="text-align: right;">
                    <span style="background: rgba(255, 71, 87, 0.9); color: white; padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: bold; letter-spacing: 1px;">🔴 LIVE</span>
                    <p style="font-weight: bold; margin-top: 8px;">Room: ${roomName}</p>
                    <p style="font-size: 12px; opacity: 0.8;">🕒 Started: ${cls.start_time}</p>
                </div>
            `;
            container.appendChild(div);
        });
    } catch (error) { console.error("Failed to load active classes", error); }
}

if (document.getElementById('activeClassesContainer')) {
    loadActiveClasses();
    setInterval(loadActiveClasses, 5000);
}

// ==========================================
// 🔓 UNASSIGN COURSE LOGIC
// ==========================================
async function loadAssignedCourses() {
    try {
        const res = await fetch(`${backendUrl}/api/admin/assigned-courses`);
        const courses = await res.json();
        
        const select = document.getElementById('unassignCourseSelect');
        if(!select) return;

        select.innerHTML = '<option value="" disabled selected>Select course to unassign...</option>';
        courses.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.course_code;
            opt.textContent = `${c.course_code} (Assigned to: ${c.teacher_name})`;
            select.appendChild(opt);
        });
    } catch (error) { console.error("Failed to load assigned courses", error); }
}

// পেজ লোড হলে ড্রপডাউনগুলো ভরবে
window.addEventListener('DOMContentLoaded', () => {
    loadAssignedCourses();
    // এখানে তোমার আগের loadCourses() এবং loadTeachers() কল করা থাকলে সেগুলো থাকবে
});

async function unassignCourse() {
    const courseCode = document.getElementById('unassignCourseSelect').value;
    
    if (!courseCode) {
        return alert("❌ Please select a course to unassign!");
    }

    if (!confirm(`Are you sure you want to unassign the teacher from ${courseCode}?`)) {
        return;
    }

    try {
        const response = await fetch(`${backendUrl}/api/admin/unassign-course`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ course_code: courseCode })
        });
        
        const data = await response.json();
        if (data.error) {
            alert(data.error);
        } else {
            alert(data.message);
            loadAssignedCourses(); // লিস্ট রিফ্রেশ করবে
        }
    } catch (error) {
        alert("Server error while unassigning course.");
    }
}


// ==========================================
// 🚀 ADMIN PROFILE, LOGOUT & SECURITY
// ==========================================

// পেজ লোড হওয়ার সময় ইমেইল আর ছবি সেট করা
window.addEventListener('DOMContentLoaded', () => {
    const adminEmail = localStorage.getItem('loggedInAdmin');
    if (!adminEmail) {
        window.location.href = 'login.html'; // লগইন ছাড়া ঢুকলে কিক আউট
        return;
    }
    
    // ইমেইল সেট করা
    const emailDisplay = document.getElementById('adminEmailDisplay');
    if(emailDisplay) emailDisplay.innerText = adminEmail;

    // সেভ করা প্রোফাইল পিকচার থাকলে লোড করা (টিচারদের মত লোকাল স্টোরেজ ব্যবহার করে)
    const savedPic = localStorage.getItem(`adminPic_${adminEmail}`);
    const profilePicElem = document.getElementById('adminProfilePic');
    if (savedPic && profilePicElem) {
        profilePicElem.src = savedPic;
    } else if (profilePicElem) {
        profilePicElem.src = `https://ui-avatars.com/api/?name=Admin&background=0d47a1&color=fff&size=100`;
    }
});

// লগআউট ফাংশন
function logoutAdmin() {
    localStorage.removeItem('loggedInAdmin');
    window.location.href = 'login.html';
}

// প্রোফাইল পিকচার চেঞ্জ করা
function changeAdminPic(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const base64Image = e.target.result;
            document.getElementById('adminProfilePic').src = base64Image;
            const adminEmail = localStorage.getItem('loggedInAdmin');
            localStorage.setItem(`adminPic_${adminEmail}`, base64Image); 
        };
        reader.readAsDataURL(file);
    }
}

// পাসওয়ার্ড চেঞ্জ মডাল ওপেন/ক্লোজ
function toggleAdminPassModal() {
    const modal = document.getElementById('adminPassModal');
    if (modal.style.display === 'none' || modal.style.display === '') {
        modal.style.display = 'flex';
    } else {
        modal.style.display = 'none';
        document.getElementById('adminOldPass').value = '';
        document.getElementById('adminNewPass').value = '';
    }
}

// পাসওয়ার্ড আপডেট করা
async function updateAdminPassword() {
    const adminEmail = localStorage.getItem('loggedInAdmin');
    const oldPass = document.getElementById('adminOldPass').value;
    const newPass = document.getElementById('adminNewPass').value;

    if (!oldPass || !newPass) {
        return alert("Please enter both passwords!");
    }

    try {
        const res = await fetch(`${backendUrl}/api/admin/change-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: adminEmail, oldPassword: oldPass, newPassword: newPass })
        });
        
        const data = await res.json();
        if (data.error) {
            alert(data.error);
        } else {
            alert(data.message);
            toggleAdminPassModal();
        }
    } catch (error) {
        alert("Server error while changing password.");
    }
}
