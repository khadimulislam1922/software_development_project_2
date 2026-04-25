const backendUrl = "http://localhost:8000";

let currentRole = 'student'; 

// 🚀 ট্যাব চেঞ্জ করার লজিক
function switchTab(role) {
    currentRole = role;
    
    // সব ট্যাবের অ্যাকটিভ ক্লাস সরিয়ে দেওয়া
    document.getElementById('tab-student').classList.remove('active');
    document.getElementById('tab-teacher').classList.remove('active');
    document.getElementById('tab-admin').classList.remove('active');
    
    // যেই ট্যাবে ক্লিক করেছে সেটাকে অ্যাকটিভ করা
    document.getElementById(`tab-${role}`).classList.add('active');

    // ইনপুট ফিল্ডের লেবেল আর প্লেসহোল্ডার ডাইনামিক করা
    const lblId = document.getElementById('lbl-id');
    const inputId = document.getElementById('userId');
    const errorMsg = document.getElementById('error-msg');
    
    // ক্লিয়ার ফিল্ডস
    inputId.value = '';
    document.getElementById('userPass').value = '';
    errorMsg.style.display = 'none';

    if (role === 'student') {
        lblId.innerText = 'Roll Number';
        inputId.placeholder = 'e.g. 2210021';
    } else if (role === 'teacher') {
        lblId.innerText = 'Teacher ID';
        inputId.placeholder = 'e.g. T-01';
    } else if (role === 'admin') {
        lblId.innerText = 'Admin Username';
        inputId.placeholder = 'e.g. admin';
    }
}

// 🚀 লগইন প্রোসেস লজিক
async function processLogin() {
    const id = document.getElementById('userId').value.trim();
    const pass = document.getElementById('userPass').value.trim();
    const errorMsg = document.getElementById('error-msg');

    if (!id || !pass) {
        errorMsg.innerText = 'Please enter both ID and Password!';
        errorMsg.style.display = 'block';
        return;
    }

    try {
        // --- 👨‍🎓 STUDENT LOGIN ---
        if (currentRole === 'student') {
            const res = await fetch(`${backendUrl}/api/student/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roll: id, password: pass })
            });
            const data = await res.json();

            if (res.ok) {
                localStorage.setItem('loggedInRoll', id);
                window.location.href = 'student.html';
            } else {
                errorMsg.innerText = data.error || 'Login failed!';
                errorMsg.style.display = 'block';
            }
        } 
        
        // --- 👨‍🏫 TEACHER LOGIN ---
        else if (currentRole === 'teacher') {
            const res = await fetch(`${backendUrl}/api/teacher/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: id.toUpperCase(), password: pass })
            });
            const data = await res.json();

            if (res.ok) {
                // 🚀 ফিক্স: ব্রাউজারে টিচার আইডি এবং নাম দুটোই সেভ করা হলো
                localStorage.setItem('loggedInTeacherId', data.profile.teacher_id);
                localStorage.setItem('loggedInTeacherName', data.profile.name); 
                window.location.href = 'teacher.html';
            } else {
                errorMsg.innerText = data.error || 'Login failed!';
                errorMsg.style.display = 'block';
            }
        } 
        
        // --- 🛡️ ADMIN LOGIN ---
        else if (currentRole === 'admin') {
            const res = await fetch(`${backendUrl}/api/admin/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: id.toLowerCase(), password: pass })
            });
            const data = await res.json();

            if (res.ok) {
                localStorage.setItem('loggedInAdmin', data.email); // ইমেইলটা সেভ রাখলাম
                window.location.href = 'admin.html';
            } else {
                errorMsg.innerText = data.error || '❌ Login failed!';
                errorMsg.style.display = 'block';
            }
        }
        
    } catch (error) {
        console.error(error);
        errorMsg.innerText = 'Server Error! Is your backend running?';
        errorMsg.style.display = 'block';
    }
}

// কীবোর্ডের Enter চাপলেও যেন লগইন হয়
document.getElementById('userPass').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
        processLogin();
    }
});