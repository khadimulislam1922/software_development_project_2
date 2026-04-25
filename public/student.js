// public/student.js

// --- Global Variable ---
const backendUrl = 'http://localhost:8000'; // তোমার সার্ভারের URL
let currentStudentRoll = null;

// --- 1. Page Initialization ---
window.onload = function() {
    console.log("Student Panel Loaded.");
    
    const themeBtn = document.getElementById('themeBtn');
    
    // Check if theme preference is stored
    const currentTheme = localStorage.getItem('theme');
    if (currentTheme === 'dark') {
        document.body.classList.add('dark-theme');
        if (themeBtn) themeBtn.innerText = '☀️ Theme';
    } else {
        if (themeBtn) themeBtn.innerText = '🌙 Theme';
    }

    // Attempt auto-login if roll & password are stored
    const savedRoll = localStorage.getItem('studentRoll');
    const savedPass = localStorage.getItem('studentPass');
    if (savedRoll && savedPass) {
        document.getElementById('rollInput').value = savedRoll;
        document.getElementById('passwordInput').value = savedPass;
        login(); // Auto trigger login
    }
};

// --- 2. Theme Toggler ---
function toggleTheme() {
    document.body.classList.toggle('dark-theme');
    const themeBtn = document.getElementById('themeBtn');
    
    // Save preference to localStorage and update button text
    if (document.body.classList.contains('dark-theme')) {
        localStorage.setItem('theme', 'dark');
        if (themeBtn) themeBtn.innerText = '☀️ Theme';
    } else {
        localStorage.setItem('theme', 'light');
        if (themeBtn) themeBtn.innerText = '🌙 Theme';
    }
}

// --- 3. Login Function ---
async function login() {
    const roll = document.getElementById('rollInput').value;
    const password = document.getElementById('passwordInput').value;

    if (!roll || !password) return alert("Please enter both roll number and password");

    try {
        const response = await fetch(`${backendUrl}/api/student/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ roll: roll, password: password })
        });
        
        const data = await response.json();

        if (data.error) {
            alert(data.error);
            return;
        }

        // Save session for auto-login
        localStorage.setItem('studentRoll', roll);
        localStorage.setItem('studentPass', password);

        // Hide Login Section, Show Dashboard
        document.getElementById('login-section').style.display = 'none';
        document.getElementById('dashboard-section').style.display = 'block';

        // 1. Save roll for potential auto-login & image upload
        currentStudentRoll = data.profile.roll_number;

        // 2. Populate Header
        document.getElementById('studentName').innerText = data.profile.name;
        document.getElementById('profileRoll').innerText = data.profile.roll_number;
        document.getElementById('profileSeries').innerText = data.profile.series;

        // 3. Populate Profile Card
        document.getElementById('profileNameCard').innerText = data.profile.name;
        
        // 3.5 Populate Profile Picture (Fixing Image Path)
        let dpUrl = data.profile.profile_pic || 'default_student.png';
        if (!dpUrl.startsWith('http') && dpUrl !== 'default_student.png') {
            dpUrl = `${backendUrl}/${dpUrl}`;
        } else if (dpUrl === 'default_student.png') {
            // Use UI Avatars if no picture is uploaded
            const formattedName = encodeURIComponent(data.profile.name);
            dpUrl = `https://ui-avatars.com/api/?name=${formattedName}&background=0D47A1&color=fff&size=120`;
        }
        
        document.getElementById('navProfilePic').src = dpUrl;
        document.getElementById('cardProfilePic').src = dpUrl;

        // 4. Populate Overall Stats
        document.getElementById('cgpaStat').innerText = data.cgpa;
        document.getElementById('totalAttStat').innerText = data.totalVarsityAttendance + "%";

        // 5. Populate Running Courses Table
        const tbody = document.getElementById('courseTableBody');
        tbody.innerHTML = ''; // Clear previous data
        
        if (data.runningCourses && data.runningCourses.length > 0) {
            data.runningCourses.forEach(course => {
                const statusClass = course.attendance >= 50 ? 'status-good' : 'status-bad';
                
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="font-weight: bold; color: var(--primary-blue);">${course.code}</td>
                    <td>${course.name}</td>
                    <td style="font-weight: 500; color: var(--text-sub);">${course.credit}</td>
                    
                    <td class="${statusClass}" title="${course.attended_classes} / ${course.total_classes} Classes" style="cursor: help;">
                        <span>${course.attendance}%</span>
                    </td>
                    
                    <td style="font-weight: 600; cursor: help;" title="Best 3 CTs: ${course.best_ct_marks}">
                        ${course.ct_avg} <span style="color: var(--text-sub); font-size: 12px; font-weight: normal;">/ 20</span>
                    </td> 
                `;
                tbody.appendChild(tr);
            });
        } else {
            // colspan="5" করা হয়েছে যেহেতু এখন কলাম ৫টি
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px; color:var(--text-sub);">No courses running at the moment.</td></tr>';
        }

    } catch (error) {
        console.error("Connection Error:", error);
        alert("Failed to connect to the server!");
    }
}

// --- 4. Logout ---
function logout() {
    localStorage.removeItem('studentRoll');
    localStorage.removeItem('studentPass');
    window.location.reload(); 
}

// --- 5. Upload Profile Picture ---
async function uploadProfilePic(event) {
    const file = event.target.files[0];
    if (!file || !currentStudentRoll) return;

    const formData = new FormData();
    formData.append('profile_pic', file);
    formData.append('roll', currentStudentRoll);

    try {
        document.getElementById('uploadBtnText').innerText = "⏳ Uploading..."; 

        const response = await fetch(`${backendUrl}/api/student/upload-dp`, {
            method: 'POST',
            body: formData
        });
        const data = await response.json();

        if (data.error) {
            alert(data.error);
        } else {
            // Update Image on screen immediately
            const newDpUrl = `${backendUrl}/${data.imageUrl}`;
            document.getElementById('navProfilePic').src = newDpUrl;
            document.getElementById('cardProfilePic').src = newDpUrl;
        }
    } catch (error) {
        alert("Upload failed!");
    } finally {
        document.getElementById('uploadBtnText').innerText = "📷 Change Picture";
    }
}

// --- 6. Password Change Logic ---
function togglePasswordForm() {
    const form = document.getElementById('passwordForm');
    if (form.style.display === 'none') {
        form.style.display = 'block';
    } else {
        form.style.display = 'none';
    }
}

async function changePassword() {
    const oldPassword = document.getElementById('oldPassword').value;
    const newPassword = document.getElementById('newPassword').value;

    if (!oldPassword || !newPassword) {
        return alert("Please enter both current and new passwords!");
    }

    try {
        const response = await fetch(`${backendUrl}/api/student/change-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roll: currentStudentRoll, oldPassword: oldPassword, newPassword: newPassword })
        });

        const data = await response.json();

        if (data.error) {
            alert(data.error);
        } else {
            alert(data.message); // Success message
            document.getElementById('oldPassword').value = '';
            document.getElementById('newPassword').value = '';
            
            // Update local storage with new password so auto-login doesn't fail next time
            localStorage.setItem('studentPass', newPassword);
            togglePasswordForm(); 
        }
    } catch (error) {
        console.error("Error:", error);
        alert("Failed to change password!");
    }
}