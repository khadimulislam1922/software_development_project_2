<div align="center">
  <img src="https://github.com/khadimulislam1922/software_development_project_2/blob/main/public/logo.png" alt="Attendo Logo" width="80" height="80">
  
  <h1>🎓 Attendo</h1>
  <h3>Next-Gen Smart Biometric Attendance Ecosystem</h3>
  <p><i>An advanced IoT-integrated platform bridging ESP32 hardware with a robust web backend.</i></p>

  <p>
    <img src="https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white" alt="NodeJS" />
    <img src="https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL" />
    <img src="https://img.shields.io/badge/ESP32-E7352C?style=for-the-badge&logo=espressif&logoColor=white" alt="ESP32" />
    <img src="https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white" alt="HTML5" />
    <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" alt="JavaScript" />
  </p>
</div>

<br>

## 📖 About The Project

Say goodbye to manual roll calls and proxy attendance! **Attendo** is a state-of-the-art attendance management system designed for universities. By integrating fingerprint biometrics with a real-time web dashboard, it ensures 100% accuracy, secure access, and instant analytics for Admins, Teachers, and Students.

---

## ✨ System Highlights

### 📡 1. IoT & Hardware Engine (ESP32)
- **Role-Based Biometrics:** Instantly differentiates between teachers (session initiators) and students (attendees).
- **Session-Locked Accuracy:** Student punches are only recorded if a teacher has an active session in that specific room.
- **Auto-Timeout Security:** Orphan sessions are automatically terminated after 50 minutes to prevent data overlap.

### 🛡️ 2. Admin Control Center
- **Campus Radar:** A real-time, glassmorphism UI monitor showing active classes across all rooms.
- **Bulk Data Sync:** Upload `.xlsx` files to sync hundreds of students and courses seamlessly.
- **Assignment Module:** Securely assign or unassign teachers to specific courses with collision detection.

### 👨‍🏫 3. Teacher Dashboard
- **Live Punch Monitor:** Watch students punch in real-time right from the dashboard.
- **Auto CT Marks Calculator:** Upload raw continuous tracking (CT) marks; the system automatically calculates the "Best 3 Average".
- **One-Click Excel Reports:** Download matrix-style attendance sheets with pre-calculated percentages.

### 🎓 4. Student Analytics Portal
- **Smart Semester Routing:** Automatically identifies the student's current year/semester and displays relevant running courses.
- **Varsity Life Overview:** Tracks overall attendance progression spanning the student's entire university journey.
- **Live Progress Bars:** Instant feedback on attended classes and percentages right after a successful punch.

---

## 📸 Interface Preview

<div align="center">
  <table>
    <tr>
      <td align="center"><b>Secure Login Portal</b></td>
      <td align="center"><b>Admin Campus Radar</b></td>
    </tr>
    <tr>
      <td><img src="https://via.placeholder.com/400x250/f0f4f8/0d47a1?text=Login+Portal+Preview" width="400" alt="Login"></td>
      <td><img src="https://via.placeholder.com/400x250/1e293b/00bcd4?text=Admin+Radar+Preview" width="400" alt="Admin"></td>
    </tr>
    <tr>
      <td align="center"><b>Teacher Analytics</b></td>
      <td align="center"><b>Student Dashboard</b></td>
    </tr>
    <tr>
      <td><img src="https://via.placeholder.com/400x250/ffffff/8e24aa?text=Teacher+Dashboard+Preview" width="400" alt="Teacher"></td>
      <td><img src="https://via.placeholder.com/400x250/ffffff/ff9800?text=Student+Dashboard+Preview" width="400" alt="Student"></td>
    </tr>
  </table>
  <p><i>*Actual screenshots to be added soon.*</i></p>
</div>

---

## ⚙️ Quick Start Guide

Follow these steps to set up the project locally on your machine.

### Prerequisites
Make sure you have the following installed:
* [Node.js](https://nodejs.org/) (v16 or higher)
* [PostgreSQL](https://www.postgresql.org/) (v12 or higher)

### Installation

**1. Clone the repository**
```bash
git clone [https://github.com/khadimulislam1922/software_development_project_2.git](https://github.com/khadimulislam1922/software_development_project_2.git)
cd software_development_project_2
