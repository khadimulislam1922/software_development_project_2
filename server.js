const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const excel = require('exceljs');

dotenv.config();
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Database Connection
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'postgres',
    password: process.env.DB_PASSWORD || '', 
    port: process.env.DB_PORT || 5432,
});

// --- Image Upload Setup ---
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, uploadDir) },
    filename: function (req, file, cb) {
        cb(null, req.body.roll + '-' + Date.now() + path.extname(file.originalname));
    }
});


// ==========================================
// --- 1. HARDWARE (ESP32) APIs (OLD) ---
// ==========================================

app.post('/api/hardware/punch', async (req, res) => {
    try {
        const { device_id, finger_id } = req.body;
        if (!device_id || !finger_id) return res.status(400).json({ error: "❌ Missing device_id or finger_id" });

        const userRes = await pool.query('SELECT user_type, user_id FROM fingerprint_mapping WHERE finger_id = $1', [finger_id]);
        if (userRes.rows.length === 0) return res.status(404).json({ error: "❌ Unregistered Fingerprint!" });

        const { user_type, user_id } = userRes.rows[0];

        if (user_type === 'teacher') {
            const activeSession = await pool.query('SELECT * FROM class_sessions WHERE device_id = $1 AND is_active = TRUE', [device_id]);

            if (activeSession.rows.length > 0) {
                const sessionId = activeSession.rows[0].id;
                await pool.query('UPDATE class_sessions SET is_active = FALSE, end_time = CURRENT_TIMESTAMP WHERE id = $1', [sessionId]);
                return res.json({ message: "✅ Class Ended Successfully." });
            } else {
                const teacherCourse = await pool.query('SELECT id FROM teacher_courses WHERE teacher_id = $1 LIMIT 1', [user_id]);
                if (teacherCourse.rows.length === 0) return res.status(400).json({ error: "❌ Teacher has no assigned courses!" });
                
                const courseId = teacherCourse.rows[0].id;
                await pool.query('INSERT INTO class_sessions (teacher_course_id, device_id) VALUES ($1, $2)', [courseId, device_id]);
                return res.json({ message: "🚀 New Class Session Started!" });
            }
        }

        if (user_type === 'student') {
            const activeSession = await pool.query('SELECT id, start_time FROM class_sessions WHERE device_id = $1 AND is_active = TRUE', [device_id]);
            if (activeSession.rows.length === 0) return res.status(400).json({ error: "❌ No Active Class in this room!" });

            const sessionId = activeSession.rows[0].id;
            const startTime = new Date(activeSession.rows[0].start_time);
            const now = new Date();
            const diffInMinutes = Math.floor((now - startTime) / 60000);

            if (diffInMinutes > 50) {
                await pool.query('UPDATE class_sessions SET is_active = FALSE, end_time = CURRENT_TIMESTAMP WHERE id = $1', [sessionId]);
                return res.status(400).json({ error: "❌ Class is already over!" });
            }

            const status = (diffInMinutes <= 20) ? 'Present' : 'Late';
            await pool.query(`
                INSERT INTO attendance (session_id, student_id, status) 
                VALUES ($1, $2, $3)
                ON CONFLICT (session_id, student_id) DO NOTHING
            `, [sessionId, user_id, status]);

            return res.json({ message: `✅ Student Attendance Recorded as: ${status}` });
        }
    } catch (err) {
        console.error("Hardware API Error:", err);
        res.status(500).json({ error: "Server processing error" });
    }
});



// ==========================================
// --- 2. STUDENT APIs ---
// ==========================================

app.post('/api/student/login', async (req, res) => {
    try {
        const { roll, password } = req.body;
        const studentRes = await pool.query('SELECT * FROM students WHERE roll_number = $1', [roll]);
        if (studentRes.rows.length === 0) return res.status(404).json({ error: "❌ Student not found!" });
        
        const student = studentRes.rows[0];
        if (student.password !== password) return res.status(401).json({ error: "❌ Incorrect Password!" });

        // ১. CT Marks ডাটাবেজ থেকে আনা 
        const ctRes = await pool.query('SELECT course_code, best_3_avg, ct_1, ct_2, ct_3, ct_4 FROM ct_marks WHERE roll_number = $1', [roll]);
        const ctMarksMap = {};
        ctRes.rows.forEach(row => { 
            let marks = [Number(row.ct_1), Number(row.ct_2), Number(row.ct_3), Number(row.ct_4)].sort((a,b) => b-a);
            // ড্যাশ আর স্পেসের ঝামেলা এড়াতে নরমালাইজ করা
            let normalizedKey = row.course_code.replace(/-/g, ' '); 
            ctMarksMap[normalizedKey] = {
                avg: row.best_3_avg,
                best_marks: `${marks[0]}/${marks[1]}/${marks[2]}` 
            };
        });

        // ============================================================
        // 🚀 SOLID SEMESTER MAPPING LOGIC
        // ============================================================
        const series = student.series; 
        const prefixes = ['11', '12', '21', '22', '31', '32', '41', '42'];
        
        let coursePrefix = '11';
        let currentIndex = 0;

        if (series === '24') { coursePrefix = '12'; currentIndex = 1; } 
        else if (series === '23') { coursePrefix = '21'; currentIndex = 2; } 
        else if (series === '22') { coursePrefix = '31'; currentIndex = 4; } 
        else if (series === '21') { coursePrefix = '41'; currentIndex = 6; } 
        else { coursePrefix = '11'; currentIndex = 0; } 

        // ------------------------------------------------------------
        // পার্ট ১: ডাইনামিক রানিং কোর্স এবং তাদের অ্যাটেনডেন্স
        // ------------------------------------------------------------
        const coursesRes = await pool.query(
            `SELECT course_code, course_name, credit FROM courses WHERE course_code LIKE $1`, 
            [`%-${coursePrefix}%`]
        );

        const dynamicRunningCourses = await Promise.all(coursesRes.rows.map(async (c) => {
            const code = c.course_code; // যেমন: ECE-3119
            const normalizedCode = code.replace(/-/g, ' '); // যেমন: ECE 3119

            const ctData = ctMarksMap[normalizedCode] || ctMarksMap[code] || { avg: 'N/A', best_marks: '0/0/0' }; 
            
            // 🚀 ফিক্স: ডাটাবেজ থেকে খোঁজার সময় ড্যাশ-স্পেস যাই থাকুক না কেন, ম্যাচ করে নেবে!
            const totalClassesRes = await pool.query(`SELECT COUNT(DISTINCT id) as total FROM class_sessions WHERE REPLACE(course_code, '-', ' ') = $1`, [normalizedCode]);
            const studentAttRes = await pool.query(`SELECT COUNT(DISTINCT session_id) as present FROM attendance_logs WHERE REPLACE(course_code, '-', ' ') = $1 AND roll_number = $2`, [normalizedCode, roll]);
            
            let total = parseInt(totalClassesRes.rows[0].total);
            let present = parseInt(studentAttRes.rows[0].present);
            
            let attPercentage = total === 0 ? 100 : Math.round((present / total) * 100);
            let courseCredit = c.credit ? Number(c.credit).toFixed(2) : "3.00";

            return {
                code: code,
                name: c.course_name,
                credit: courseCredit,
                attendance: attPercentage,
                attended_classes: present, 
                total_classes: total,      
                ct_avg: ctData.avg,
                best_ct_marks: ctData.best_marks 
            };
        }));

        // ------------------------------------------------------------
        // পার্ট ২: ফুল ভার্সিটি লাইফ অ্যাটেনডেন্স
        // ------------------------------------------------------------
        let totalVarsityPercentage = 100; 
        const allPrefixes = prefixes.slice(0, currentIndex + 1);
        
        // 🚀 ফিক্স: ড্যাশ/স্পেস ইগনোর করে কোর্স খোঁজা
        const prefixConditions = allPrefixes.map(p => `REPLACE(course_code, '-', '') LIKE '%${p}%'`).join(' OR ');

        if (prefixConditions) {
            const totalVarsityRes = await pool.query(`SELECT COUNT(DISTINCT id) as total_held FROM class_sessions WHERE ${prefixConditions}`);
            
            const studentVarsityRes = await pool.query(`
                SELECT COUNT(DISTINCT al.session_id) as total_present 
                FROM attendance_logs al 
                JOIN class_sessions cs ON al.session_id = cs.id 
                WHERE al.roll_number = $1 AND (${prefixConditions.replace(/course_code/g, 'cs.course_code')})
            `, [roll]);

            let totalVarsityHeld = parseInt(totalVarsityRes.rows[0].total_held) || 0;
            let totalVarsityPresent = parseInt(studentVarsityRes.rows[0].total_present) || 0;

            if (totalVarsityHeld > 0) {
                totalVarsityPercentage = Math.round((totalVarsityPresent / totalVarsityHeld) * 100);
            }
        }

        res.json({
            profile: student, 
            cgpa: 3.75, 
            totalVarsityAttendance: totalVarsityPercentage, 
            runningCourses: dynamicRunningCourses 
        });
        
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/api/student/upload-dp', upload.single('profile_pic'), async (req, res) => {
    try {
        const roll = req.body.roll;
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });
        const imageUrl = 'uploads/' + req.file.filename;
        await pool.query('UPDATE students SET profile_pic = $1 WHERE roll_number = $2', [imageUrl, roll]);
        res.json({ message: "Profile picture updated!", imageUrl: imageUrl });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/student/change-password', async (req, res) => {
    try {
        const { roll, oldPassword, newPassword } = req.body;
        const studentRes = await pool.query('SELECT password FROM students WHERE roll_number = $1', [roll]);
        if (studentRes.rows.length === 0) return res.status(404).json({ error: "Student not found!" });
        if (studentRes.rows[0].password !== oldPassword) return res.status(401).json({ error: "❌ Incorrect Current Password!" });
        
        await pool.query('UPDATE students SET password = $1 WHERE roll_number = $2', [newPassword, roll]);
        res.json({ message: "✅ Password updated successfully!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});


// ==========================================
// --- 3. ADMIN APIs ---
// ==========================================


// 🚀 Admins Table Create & Seed (ডিফল্ট অ্যাডমিন ইনসার্ট করা)
pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
        email VARCHAR(100) PRIMARY KEY,
        password VARCHAR(255) DEFAULT 'admin123'
    )
`).then(() => {
    pool.query(`INSERT INTO admins (email, password) VALUES ('anwar.hossain@ece.ruet.ac.bd', 'admin123') ON CONFLICT DO NOTHING`);
    pool.query(`INSERT INTO admins (email, password) VALUES ('admin@ece.ruet.ac.bd', 'admin123') ON CONFLICT DO NOTHING`);
}).catch(err => console.error(err));


// 🚀 Admin Login API
app.post('/api/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const adminRes = await pool.query('SELECT * FROM admins WHERE email = $1', [email]);
        
        if (adminRes.rows.length === 0) return res.status(404).json({ error: "❌ You are not an authorized Admin!" });
        if (adminRes.rows[0].password !== password) return res.status(401).json({ error: "❌ Incorrect Password!" });
        
        res.json({ message: "Login Successful", email: email });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 🚀 Admin Password Change API
app.post('/api/admin/change-password', async (req, res) => {
    try {
        const { email, oldPassword, newPassword } = req.body;
        const adminRes = await pool.query('SELECT password FROM admins WHERE email = $1', [email]);
        
        if (adminRes.rows.length === 0) return res.status(404).json({ error: "Admin not found!" });
        if (adminRes.rows[0].password !== oldPassword) return res.status(401).json({ error: "❌ Incorrect Current Password!" });
        
        await pool.query('UPDATE admins SET password = $1 WHERE email = $2', [newPassword, email]);
        res.json({ message: "✅ Password updated successfully!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/all-courses', async (req, res) => {
    try {
        const result = await pool.query('SELECT course_code, course_name FROM courses ORDER BY course_code ASC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/all-teachers', async (req, res) => {
    try {
        const result = await pool.query('SELECT teacher_id, name FROM teachers ORDER BY teacher_id ASC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/bulk-upload', upload.single('excel_file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Please upload an Excel file!" });
        const uploadType = req.body.upload_type; 
        const workbook = xlsx.readFile(req.file.path);
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

        if (uploadType === 'students') {
            for (let row of data) {
                const roll = String(row.Roll);
                const name = row.Name || 'Unknown';
                const series = String(row.Series) || '22';
                const email = row.Email || `${roll}@student.ruet.ac.bd`;
                const password = String(row.Password || '1234');

                await pool.query(`
                    INSERT INTO students (roll_number, name, series, email, password)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (roll_number) DO UPDATE 
                    SET name = EXCLUDED.name, series = EXCLUDED.series, email = EXCLUDED.email, password = EXCLUDED.password
                `, [roll, name, series, email, password]);
            }
            res.json({ message: `✅ ${data.length} Students synced!` });
        } else if (uploadType === 'courses') {
            for (let row of data) {
                const code = String(row.Code);
                const courseName = row.Name || 'Unknown Course';
                const dept = String(row.Dept) || 'ECE';

                await pool.query(`
                    INSERT INTO courses (course_code, course_name, department)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (course_code) DO UPDATE 
                    SET course_name = EXCLUDED.course_name, department = EXCLUDED.department
                `, [code, courseName, dept]);
            }
            res.json({ message: `✅ ${data.length} Courses synced!` });
        }
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    } catch (err) { res.status(500).json({ error: "Database error: " + err.message }); }
});


// ==========================================
// 🚀 ADMIN: ACTIVE CLASSES MONITORING API
// ==========================================
app.get('/api/admin/active-classes', async (req, res) => {
    try {
        const query = `
            SELECT 
                cs.device_id as room, 
                cs.course_code, 
                t.name as teacher_name, 
                cs.teacher_id,
                TO_CHAR(cs.start_time, 'HH12:MI AM') as start_time
            FROM class_sessions cs
            LEFT JOIN teachers t ON cs.teacher_id = t.teacher_id
            WHERE cs.is_active = TRUE
            ORDER BY cs.start_time DESC
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});


// ==========================================
// --- 4. TEACHER & ASSIGNMENT APIs ---
// ==========================================

// Create Table if not exists
pool.query(`
    CREATE TABLE IF NOT EXISTS course_assignments (
        id SERIAL PRIMARY KEY,
        teacher_id VARCHAR(50),
        course_code VARCHAR(50),
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(teacher_id, course_code)
    );
`).catch(err => console.error("Assignment Table Error:", err));


app.post('/api/admin/assign-course', async (req, res) => {
    let { teacher_id, course_code } = req.body;
    teacher_id = teacher_id.toUpperCase().trim();
    course_code = course_code.toUpperCase().trim().replace(/-/g, ' '); // ECE-3119 কে ECE 3119 বানাবে

    try {
        // 🚀 লজিক: চেক করা যে এই কোর্সটা আগে থেকেই অন্য কাউকে অ্যাসাইন করা আছে কি না
        const checkRes = await pool.query('SELECT teacher_id FROM course_assignments WHERE course_code = $1', [course_code]);
        
        if (checkRes.rows.length > 0) {
            const assignedTeacher = checkRes.rows[0].teacher_id;
            
            if (assignedTeacher === teacher_id) {
                return res.status(400).json({ error: `❌ This course is already assigned to you (${teacher_id})!` });
            } else {
                return res.status(400).json({ error: `❌ This course is already assigned to another teacher (${assignedTeacher})!` });
            }
        }

        // যদি ফ্রি থাকে, তাহলে ইনসার্ট করবে
        await pool.query(
            'INSERT INTO course_assignments (teacher_id, course_code) VALUES ($1, $2)',
            [teacher_id, course_code]
        );
        res.json({ message: "✅ Successfully assigned!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});


// টিচার প্যানেলের জন্য কোর্স খুঁজে বের করা (ডুপ্লিকেট ফিক্সড)
app.get('/api/teacher/my-courses/:tId', async (req, res) => {
    const tId = req.params.tId.toUpperCase().trim();
    console.log(`\n🔍 API Called! Searching courses for: '${tId}'`);
    try {
        // 🚀 ফিক্স: DISTINCT ব্যবহার করা হয়েছে যাতে ডুপ্লিকেট না দেখায় 
        // এবং REPLACE দিয়ে ড্যাশ(-) কে স্পেস বানিয়ে দেওয়া হয়েছে
        const result = await pool.query(`
            SELECT DISTINCT REPLACE(TRIM(course_code), '-', ' ') as course_code 
            FROM course_assignments 
            WHERE TRIM(teacher_id) = $1
        `, [tId]);
        
        console.log(`✅ Matched Unique Courses for ${tId}:`, result.rows);
        res.json(result.rows);
    } catch (err) {
        console.error("❌ DB Error:", err.message);
        res.status(500).json({ error: "Database error" });
    }
});

app.post('/api/teacher/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        // email ফিল্ড দিয়ে মূলত teacher_id (যেমন: T-01) পাঠানো হয়
        const teacherRes = await pool.query('SELECT * FROM teachers WHERE teacher_id = $1 OR email = $1', [email]);
        
        if (teacherRes.rows.length === 0) return res.status(404).json({ error: "❌ Teacher not found!" });
        
        // যদি ডাটাবেজে পাসওয়ার্ড না থাকে, তাহলে ডিফল্ট '1234' ধরে নেবে
        const dbPassword = teacherRes.rows[0].password || '1234'; 
        
        if (dbPassword !== password) return res.status(401).json({ error: "❌ Incorrect Password!" });
        
        res.json({ message: "Login Successful", profile: teacherRes.rows[0] });
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/api/teacher/upload-ct', upload.single('excel_file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Upload Excel!" });
        const courseCode = req.body.course_code;
        const workbook = xlsx.readFile(req.file.path);
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS ct_marks (
                id SERIAL PRIMARY KEY, roll_number VARCHAR(50), course_code VARCHAR(50),
                ct_1 NUMERIC DEFAULT 0, ct_2 NUMERIC DEFAULT 0, ct_3 NUMERIC DEFAULT 0, ct_4 NUMERIC DEFAULT 0,
                best_3_avg NUMERIC DEFAULT 0, UNIQUE(roll_number, course_code)
            )
        `);

        for (let row of data) {
            const roll = String(row.Roll);
            const ct1 = Number(row.CT1) || 0, ct2 = Number(row.CT2) || 0, ct3 = Number(row.CT3) || 0, ct4 = Number(row.CT4) || 0;
            const marks = [ct1, ct2, ct3, ct4].sort((a, b) => b - a);
            const best3Avg = ((marks[0] + marks[1] + marks[2]) / 3).toFixed(2); 

            await pool.query(`
                INSERT INTO ct_marks (roll_number, course_code, ct_1, ct_2, ct_3, ct_4, best_3_avg)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (roll_number, course_code) DO UPDATE 
                SET ct_1 = EXCLUDED.ct_1, ct_2 = EXCLUDED.ct_2, ct_3 = EXCLUDED.ct_3, ct_4 = EXCLUDED.ct_4, best_3_avg = EXCLUDED.best_3_avg
            `, [roll, courseCode, ct1, ct2, ct3, ct4, best3Avg]);
        }
        fs.unlinkSync(req.file.path);
        res.json({ message: "✅ Excel uploaded & Best 3 calculated successfully!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/teacher/change-password', async (req, res) => {
    try {
        const { teacher_id, oldPassword, newPassword } = req.body;
        
        // পাসওয়ার্ড কলাম না থাকলে অটোমেটিক তৈরি করে নেবে (সেফটির জন্য)
        await pool.query(`ALTER TABLE teachers ADD COLUMN IF NOT EXISTS password VARCHAR(255) DEFAULT '1234';`);

        const teacherRes = await pool.query('SELECT password FROM teachers WHERE teacher_id = $1', [teacher_id]);
        if (teacherRes.rows.length === 0) return res.status(404).json({ error: "Teacher not found!" });
        
        const currentDbPassword = teacherRes.rows[0].password || '1234'; // ডিফল্ট 1234

        if (currentDbPassword !== oldPassword) return res.status(401).json({ error: "❌ Incorrect Current Password!" });
        
        await pool.query('UPDATE teachers SET password = $1 WHERE teacher_id = $2', [newPassword, teacher_id]);
        res.json({ message: "✅ Password updated successfully!" });
    } catch (err) { 
        res.status(500).json({ error: err.message }); 
    }
});

// ==========================================
// 🚀 ADMIN: GET ALL ASSIGNED COURSES (For Unassigning)
// ==========================================
app.get('/api/admin/assigned-courses', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT ca.course_code, t.name as teacher_name 
            FROM course_assignments ca
            JOIN teachers t ON ca.teacher_id = t.teacher_id
            ORDER BY ca.course_code ASC
        `);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// 🚀 ADMIN: UNASSIGN COURSE
// ==========================================

app.post('/api/admin/unassign-course', async (req, res) => {
    try {
        const { course_code } = req.body;
        
        // কোর্স অ্যাসাইনমেন্ট টেবিল থেকে মুছে ফেলা
        await pool.query('DELETE FROM course_assignments WHERE course_code = $1', [course_code]);
        
        // সেফটির জন্য: যদি এই কোর্সের কোনো লাইভ ক্লাস চলতে থাকে, সেটাও অফ করে দেওয়া
        await pool.query('UPDATE class_sessions SET is_active = FALSE WHERE course_code = $1', [course_code]);
        
        res.json({ message: "✅ Teacher unassigned from the course successfully!" });
    } catch (err) { res.status(500).json({ error: err.message }); }
});



// ==========================================
// --- 5. LIVE ATTENDANCE LOG APIs ---
// ==========================================

pool.query(`
    CREATE TABLE IF NOT EXISTS attendance_logs (
        id SERIAL PRIMARY KEY, roll_number VARCHAR(50), course_code VARCHAR(50),
        punch_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP, punch_date DATE DEFAULT CURRENT_DATE,
        session_id INT
    )
`).catch(err => console.error(err));

pool.query(`ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS session_id INT;`).catch(e => {});

// ==========================================
// --- 5.3 HARDWARE (ESP32) PUNCH API ---
// ==========================================

app.post('/api/attendance/punch', async (req, res) => {
    try {
        const { finger_id, device_id } = req.body; 
        const fId = parseInt(finger_id);

        // ----------------------------------------
        // 👨‍🏫 TEACHER LOGIC (ID: 71 to 78)
        // ----------------------------------------
        if (fId >= 71 && fId <= 78) {
            const tId = `T-0${fId - 70}`; 
            
            // Check 1: Ei series e (device_id) ki onno kono teacher er class cholche?
            const deviceActiveCheck = await pool.query('SELECT * FROM class_sessions WHERE device_id = $1 AND is_active = TRUE', [device_id]);
            if (deviceActiveCheck.rows.length > 0 && deviceActiveCheck.rows[0].teacher_id !== tId) {
                return res.status(400).json({ error: `❌ Room Busy! Another class is running in ${device_id}.` });
            }

            // Check 2: Ei teacher er ki onno kono room e class cholche?
            const activeRes = await pool.query('SELECT * FROM class_sessions WHERE teacher_id = $1 AND is_active = TRUE', [tId]);
            if (activeRes.rows.length > 0) {
                const session = activeRes.rows[0];
                if (session.device_id === device_id) {
                    // Same room e punch korle session END hobe (Multiple classes in a day allowed)
                    await pool.query('UPDATE class_sessions SET is_active = FALSE, end_time = CURRENT_TIMESTAMP WHERE id = $1', [session.id]);
                    return res.json({ message: `⏹️ Session Stopped by Teacher (${tId}).` });
                } else {
                    return res.status(400).json({ error: `❌ You already have an active class in ${session.device_id}!` });
                }
            }

            // Series identification
            const series = device_id.split('_')[1] || '22'; 
            let coursePrefix = '';
            if (series === '22') coursePrefix = '3';
            else if (series === '21') coursePrefix = '4';
            else if (series === '23') coursePrefix = '2';
            else if (series === '24') coursePrefix = '1';
            else if (series === '25') coursePrefix = '1'; // Just an example for 25

            const courseRes = await pool.query(`
                SELECT course_code FROM course_assignments 
                WHERE teacher_id = $1 AND (course_code LIKE $2 OR course_code LIKE $3) LIMIT 1
            `, [tId, `%-${coursePrefix}%`, `% ${coursePrefix}%`]);

            if (courseRes.rows.length === 0) {
                return res.status(400).json({ error: `❌ No assigned course found for ${tId} in Series ${series}!` });
            }

            const courseCode = courseRes.rows[0].course_code;
            
            // Start NEW Session (Ete kore ekdin e 2 bar class nile 2 ta alada row toiri hobe)
            await pool.query('INSERT INTO class_sessions (teacher_id, course_code, device_id) VALUES ($1, $2, $3)', [tId, courseCode, device_id]);
            return res.json({ message: `🚀 Session Started for ${courseCode}` });
        }

        // ----------------------------------------
        // 🎓 STUDENT LOGIC (ID: 2210021 etc)
        // ----------------------------------------
        else {
            const roll = fId.toString();
            
            const sessionRes = await pool.query('SELECT * FROM class_sessions WHERE device_id = $1 AND is_active = TRUE', [device_id]);

            if (sessionRes.rows.length === 0) {
                return res.status(400).json({ error: "❌ Warning: No active class! Wait for Teacher." });
            }

            const session = sessionRes.rows[0];
            
            // 50 Minutes Auto-Off Check
            const diffInMins = Math.floor((new Date() - new Date(session.start_time)) / 60000);
            if (diffInMins >= 50) {
                await pool.query('UPDATE class_sessions SET is_active = FALSE, end_time = CURRENT_TIMESTAMP WHERE id = $1', [session.id]);
                return res.status(400).json({ error: "❌ Class time (50 mins) over! Session auto-ended." });
            }

            // Save Attendance (With session_id included)
            await pool.query('INSERT INTO attendance_logs (roll_number, course_code, session_id) VALUES ($1, $2, $3)', [roll, session.course_code, session.id]);
            return res.json({ message: `✅ Attendance Recorded for: ${roll}` });
        }

    } catch (err) { res.status(500).json({ error: "Server error: " + err.message }); }
});

// ==========================================
// ---5.4 TEACHER MANUAL SESSION CONTROL API ---
// ==========================================
app.post('/api/teacher/session/toggle', async (req, res) => {
    try {
        const { teacher_id, course_code, device_id, action } = req.body;
        
        if (action === 'start') {
            // Room busy check
            const roomCheck = await pool.query('SELECT * FROM class_sessions WHERE device_id = $1 AND is_active = TRUE', [device_id]);
            if (roomCheck.rows.length > 0) return res.status(400).json({ error: "Room is currently busy!" });

            // Teacher busy check
            const teacherCheck = await pool.query('SELECT * FROM class_sessions WHERE teacher_id = $1 AND is_active = TRUE', [teacher_id]);
            if (teacherCheck.rows.length > 0) return res.status(400).json({ error: "You already have an active class!" });

            await pool.query('INSERT INTO class_sessions (teacher_id, course_code, device_id) VALUES ($1, $2, $3)', [teacher_id, course_code, device_id]);
            return res.json({ message: "✅ Session manually started!" });
        } else if (action === 'stop') {
            await pool.query('UPDATE class_sessions SET is_active = FALSE, end_time = CURRENT_TIMESTAMP WHERE teacher_id = $1 AND is_active = TRUE', [teacher_id]);
            return res.json({ message: "⏹️ Session manually stopped!" });
        }
    } catch (err) {
        res.status(500).json({ error: "Error toggling session" });
    }
});


app.get('/api/teacher/live-attendance/:courseCode', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT a.roll_number, TO_CHAR(a.punch_time, 'HH12:MI:SS AM') as time, s.name 
            FROM attendance_logs a LEFT JOIN students s ON a.roll_number = s.roll_number
            WHERE a.course_code = $1 AND a.punch_date = CURRENT_DATE ORDER BY a.punch_time DESC
        `, [req.params.courseCode]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// --- 5.5 DYNAMIC EXCEL DOWNLOAD API ---
// ==========================================
app.get('/api/teacher/export/:courseCode', async (req, res) => {
    try {
        const courseCode = req.params.courseCode;

        // ১. এই কোর্সের কয়টা ক্লাস (সেশন) হয়েছে সেটা বের করা
        const sessionsRes = await pool.query(`
            SELECT id, TO_CHAR(start_time, 'DD-Mon-YY') as date 
            FROM class_sessions 
            WHERE course_code = $1 
            ORDER BY start_time ASC
        `, [courseCode]);
        const sessions = sessionsRes.rows;

        if (sessions.length === 0) return res.status(400).json({ error: "No classes found for this course!" });

        // ২. কোর্স থেকে সিরিজ বের করা (ECE-3119 -> 3rd Year -> 22 Series)
        let yearPrefix = courseCode.replace(/[^0-9]/g, '')[0]; 
        let targetSeries = '22'; 
        if (yearPrefix === '4') targetSeries = '21';
        else if (yearPrefix === '3') targetSeries = '22';
        else if (yearPrefix === '2') targetSeries = '23';
        else if (yearPrefix === '1') targetSeries = '24'; // 🚀 এই লাইনটাই ২৪ সিরিজের জন্য অ্যাড করা হলো!

        // ৩. স্টুডেন্ট লিস্ট এবং অ্যাটেনডেন্স ডাটা আনা
        const studentsRes = await pool.query('SELECT roll_number, name FROM students WHERE roll_number LIKE $1 ORDER BY roll_number ASC', [`${targetSeries}%`]);
        const students = studentsRes.rows;

        const attendanceRes = await pool.query('SELECT roll_number, session_id FROM attendance_logs WHERE course_code = $1', [courseCode]);
        const attendanceData = attendanceRes.rows;

        // ৪. এক্সেল শিট সেটআপ
        const workbook = new excel.Workbook();
        const worksheet = workbook.addWorksheet(`${courseCode} Attendance`);

        // ডায়নামিক কলাম বানানো (Roll, Name, Class 1, Class 2...)
        let columns = [
            { header: 'Roll Number', key: 'roll', width: 15 },
            { header: 'Student Name', key: 'name', width: 25 }
        ];

        sessions.forEach((s, index) => {
            columns.push({ header: `Class ${index + 1}\n(${s.date})`, key: `session_${s.id}`, width: 15 });
        });

        columns.push({ header: 'Total Present', key: 'total_present', width: 15 });
        columns.push({ header: 'Percentage (%)', key: 'percentage', width: 15 });
        worksheet.columns = columns;

        // ৫. স্টুডেন্টদের ডাটা এক্সেলে বসানো
        students.forEach(student => {
            let row = { roll: student.roll_number, name: student.name };
            let presentCount = 0;

            sessions.forEach(session => {
                const isPresent = attendanceData.some(a => a.roll_number === student.roll_number && a.session_id === session.id);
                row[`session_${session.id}`] = isPresent ? '1' : 'A'; // থাকলে 1, না থাকলে A
                if (isPresent) presentCount++;
            });

            row.total_present = presentCount;
            row.percentage = ((presentCount / sessions.length) * 100).toFixed(2) + '%';
            worksheet.addRow(row);
        });

        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).alignment = { wrapText: true, horizontal: 'center' };

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${courseCode}_Attendance.xlsx`);

        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        res.status(500).json({ error: "Failed to generate Excel: " + err.message });
    }
});



// ==========================================
// --- 6. DATABASE MASTER SEEDER (RUET ECE) ---
// ==========================================
async function seedDatabase() {
    console.log("⏳ Seeding Master Database with Exact ECE Credits...");

    const teachersData = [
        { id: 'T-01', name: 'Prof. Dr. Md. Anwar Hossain', dept: 'ECE' }, 
        { id: 'T-02', name: 'Fariya Tabassum', dept: 'ECE' },             
        { id: 'T-03', name: 'Md. Abu Hanif Pramanik', dept: 'ECE' },
        { id: 'T-04', name: 'Hafsa Binte Kibria', dept: 'ECE' },
        { id: 'T-05', name: 'Md. Omaer Faruq Goni', dept: 'ECE' },
        { id: 'T-06', name: 'Oishi Jyoti', dept: 'ECE' },
        { id: 'T-07', name: 'Md. Faysal Ahamed', dept: 'ECE' },
        { id: 'T-08', name: 'Moloy Kumar Ghosh', dept: 'ECE' }
    ];

    const coursesData = [
        // 1st Year Odd
        { code: 'ECE-1101', name: 'Circuits and Systems-I', dept: 'ECE', credit: 3.00 },
        { code: 'ECE-1102', name: 'Circuits and Systems-I Sessional', dept: 'ECE', credit: 1.50 },
        { code: 'ECE-1103', name: 'Computer Programming', dept: 'ECE', credit: 3.00 },
        { code: 'ECE-1104', name: 'Computer Programming Sessional', dept: 'ECE', credit: 1.50 },
        { code: 'Math-1117', name: 'Calculus and Ordinary Differential Equation', dept: 'Math', credit: 3.00 },
        { code: 'Phy-1117', name: 'Optics and Modern Physics', dept: 'Physics', credit: 3.00 },
        { code: 'Phy-1118', name: 'Optics and Modern Physics Sessional', dept: 'Physics', credit: 0.75 },
        { code: 'Hum-1117', name: 'Technical English', dept: 'Humanities', credit: 3.00 },
        { code: 'Hum-1118', name: 'Technical English Sessional', dept: 'Humanities', credit: 0.75 },
        { code: 'ECE-1100', name: 'Introduction to Computer System', dept: 'ECE', credit: 0.75 },

        // 1st Year Even
        { code: 'ECE-1201', name: 'Circuits and Systems-II', dept: 'ECE', credit: 3.00 },
        { code: 'ECE-1202', name: 'Circuits and Systems-II Sessional', dept: 'ECE', credit: 0.75 },
        { code: 'ECE-1203', name: 'Object Oriented Programming', dept: 'ECE', credit: 3.00 },
        { code: 'ECE-1204', name: 'Object Oriented Programming Sessional', dept: 'ECE', credit: 1.50 },
        { code: 'ECE-1205', name: 'Analog Electronic Circuits-I', dept: 'ECE', credit: 3.00 },
        { code: 'ECE-1206', name: 'Analog Electronic Circuits-I Sessional', dept: 'ECE', credit: 0.75 },
        { code: 'Math-1217', name: 'Transform Methods, Statistics & Complex Variable', dept: 'Math', credit: 3.00 },
        { code: 'Hum-1217', name: 'Govt, Sociology, Environment & History', dept: 'Humanities', credit: 3.00 },
        { code: 'ECE-1200', name: 'Engineering Ethics', dept: 'ECE', credit: 0.75 },

        // 2nd Year Odd
        { code: 'ECE-2103', name: 'Data Structure & Algorithms', dept: 'ECE', credit: 3.00 },
        { code: 'ECE-2104', name: 'Data Structure & Algorithms Sessional', dept: 'ECE', credit: 1.50 },
        { code: 'ECE-2105', name: 'Analog Electronic Circuits-II', dept: 'ECE', credit: 3.00 },
        { code: 'ECE-2106', name: 'Analog Electronic Circuits-II Sessional', dept: 'ECE', credit: 0.75 },
        { code: 'ECE-2111', name: 'Digital Techniques', dept: 'ECE', credit: 3.00 },
        { code: 'ECE-2112', name: 'Digital Techniques Sessional', dept: 'ECE', credit: 0.75 },
        { code: 'Math-2117', name: 'Vector Analysis & Linear Algebra', dept: 'Math', credit: 3.00 },
        { code: 'Chem-2117', name: 'Inorganic and Physical Chemistry', dept: 'Chemistry', credit: 3.00 },
        { code: 'Chem-2118', name: 'Inorganic and Physical Chemistry Sessional', dept: 'Chemistry', credit: 0.75 },
        { code: 'ECE-2100', name: 'Software Development Project-I', dept: 'ECE', credit: 0.75 },

        // 2nd Year Even
        { code: 'ECE-2207', name: 'Electrical Machine-I', dept: 'ECE', credit: 3.00 },
        { code: 'ECE-2208', name: 'Electrical Machine-I Sessional', dept: 'ECE', credit: 0.75 },
        { code: 'ECE-2213', name: 'Numerical Methods & Discrete Mathematics', dept: 'ECE', credit: 3.00 },
        { code: 'ECE-2214', name: 'Numerical Methods & Discrete Mathematics Sessional', dept: 'ECE', credit: 1.50 },
        { code: 'ECE-2215', name: 'Data Base Systems', dept: 'ECE', credit: 3.00 },
        { code: 'ECE-2216', name: 'Data Base Systems Sessional', dept: 'ECE', credit: 1.50 },
        { code: 'Math-2217', name: 'Co-ordinate Geometry & Partial Differential Equations', Math: 'ECE', credit: 3.00 },
        { code: 'Hum-2217', name: 'Legal Issues, Industrial & Operational Management', dept: 'Humanities', credit: 3.00 },
        { code: 'ECE-2200', name: 'Electronic Shop Practice', dept: 'ECE', credit: 1.50 },

        // 3rd Year Odd
        { code: 'ECE-3107', name: 'Electrical Machine-II', dept: 'ECE', credit: 3.00 },
        { code: 'ECE-3108', name: 'Electrical Machine-II Sessional', dept: 'ECE', credit: 0.75 },
        { code: 'ECE-3111', name: 'Microprocessor, Assembly Language & Interfacing', dept: 'ECE', credit: 3.00 },
        { code: 'ECE-3112', name: 'Microprocessor, Assembly Language & Interfacing Sessional', dept: 'ECE', credit: 1.50 },
        { code: 'ECE-3117', name: 'Software Engineering & Information System Design', dept: 'ECE', credit: 3.00 },
        { code: 'ECE-3118', name: 'Software Engineering & Information System Design Sessional', dept: 'ECE', credit: 0.75 },
        { code: 'ECE-3119', name: 'Computer Architecture and Design', dept: 'ECE', credit: 3.00 },
        { code: 'ECE-3121', name: 'Electromagnetic Fields & Waves', dept: 'ECE', credit: 3.00 },
        { code: 'CE-3100', name: 'Civil Engineering Drawing', dept: 'CE', credit: 0.75 },
        { code: 'ECE-3100', name: 'Software Development Project-II', dept: 'ECE', credit: 0.75 },

        // 3rd Year Even
        { code: 'ECE-3205', name: 'Industrial Electronics', dept: 'ECE', credit: 3.00 },
        { code: 'ECE-3206', name: 'Industrial Electronics Sessional', dept: 'ECE', credit: 0.75 },
        { code: 'ECE-3207', name: 'Communication Engineering', dept: 'ECE', credit: 3.00 },
        { code: 'ECE-3208', name: 'Communication Engineering Sessional', dept: 'ECE', credit: 0.75 },
        { code: 'ECE-3221', name: 'Operating System', dept: 'ECE', credit: 3.00 },
        { code: 'ECE-3222', name: 'Operating System Sessional', dept: 'ECE', credit: 0.75 },
        { code: 'ME-3219', name: 'Basic Mechanical Engineering', dept: 'ME', credit: 3.00 },
        { code: 'ME-3220', name: 'Basic Mechanical Engineering Sessional', dept: 'ME', credit: 0.75 },
        { code: 'Hum-3217', name: 'Economics & Accountancy', dept: 'Humanities', credit: 3.00 },
        { code: 'ECE-3200', name: 'Electrical Services Design', dept: 'ECE', credit: 1.50 },

        // 4th Year Odd
        { code: 'ECE-4109', name: 'Power System', dept: 'ECE', credit: 3.00 },
        { code: 'MTE-4117', name: 'Control Systems & Robotics', dept: 'MTE', credit: 3.00 },
        { code: 'MTE-4118', name: 'Control Systems & Robotics Sessional', dept: 'MTE', credit: 0.75 },
        { code: 'ECE-4123', name: 'Digital Signal Processing', dept: 'ECE', credit: 3.00 },
        { code: 'ECE-4124', name: 'Digital Signal Processing Sessional', dept: 'ECE', credit: 0.75 },
        { code: 'ECE-41XX-1', name: 'Optional I (Theory)', dept: 'ECE', credit: 3.00 },
        { code: 'ECE-41XX-2', name: 'Optional I Sessional', dept: 'ECE', credit: 0.75 },
        { code: 'ECE-41XX-3', name: 'Optional II (Theory)', dept: 'ECE', credit: 3.00 },
        { code: 'ECE-41XX-4', name: 'Optional II Sessional', dept: 'ECE', credit: 0.75 },
        { code: 'ECE-4000-1', name: 'Thesis/ Project-I', dept: 'ECE', credit: 1.00 },
        { code: 'ECE-4100', name: 'Industrial Training', dept: 'ECE', credit: 0.75 },
        { code: 'ECE-4122', name: 'Seminar', dept: 'ECE', credit: 0.75 },

        // 4th Year Even
        { code: 'ECE-4209', name: 'Power Station, Switchgear & Protection', dept: 'ECE', credit: 3.00 },
        { code: 'ECE-4211', name: 'Computer Networks', dept: 'ECE', credit: 3.00 },
        { code: 'ECE-4212', name: 'Computer Networks Sessional', dept: 'ECE', credit: 0.75 },
        { code: 'ECE-4223', name: 'Digital Image Processing', dept: 'ECE', credit: 3.00 },
        { code: 'ECE-4224', name: 'Digital Image Processing Sessional', dept: 'ECE', credit: 1.50 },
        { code: 'ECE-42XX-1', name: 'Optional III (Theory)', dept: 'ECE', credit: 3.00 },
        { code: 'ECE-42XX-2', name: 'Optional III Sessional', dept: 'ECE', credit: 0.75 },
        { code: 'ECE-42XX-3', name: 'Optional IV (Theory)', dept: 'ECE', credit: 3.00 },
        { code: 'ECE-42XX-4', name: 'Optional IV Sessional', dept: 'ECE', credit: 0.75 },
        { code: 'ECE-4000-2', name: 'Thesis/ Project-II', dept: 'ECE', credit: 3.00 }
    ];

    try {
        await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS department VARCHAR(50);`);
        await pool.query(`ALTER TABLE courses ALTER COLUMN semester DROP NOT NULL;`).catch(e => {});
        await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS credit NUMERIC(3,2) DEFAULT 3.00;`);

        // 🚀 টিচারদের নাম ডাটাবেজে ওভাররাইট (Update) করা হচ্ছে
        for (let t of teachersData) {
            await pool.query(`
                INSERT INTO teachers (teacher_id, name, department) 
                VALUES ($1, $2, $3) 
                ON CONFLICT (teacher_id) DO UPDATE 
                SET name = EXCLUDED.name, department = EXCLUDED.department
            `, [t.id, t.name, t.dept]);
        }

        // কোর্সের ডাটাগুলো ওভাররাইট করা হচ্ছে
        for (let c of coursesData) {
            await pool.query(`
                INSERT INTO courses (course_code, course_name, department, credit) 
                VALUES ($1, $2, $3, $4) 
                ON CONFLICT (course_code) DO UPDATE 
                SET course_name = EXCLUDED.course_name, department = EXCLUDED.department, credit = EXCLUDED.credit
            `, [c.code, c.name, c.dept, c.credit]);
        }

        console.log("✅ Master Database Seeded with Exact Credits and Updated Names Successfully!");
    } catch (err) {
        console.error("❌ Database Seeding Error:", err.message);
    }
}

seedDatabase();

// Start Server
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
    console.log("🚀 Smart Attendance Server is running on port " + PORT);

});