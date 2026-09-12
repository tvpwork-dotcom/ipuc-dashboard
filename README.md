# IP.UC Performance Analytics Dashboard

**Dashboard วิเคราะห์ผลงานบริการผู้ป่วยในสิทธิ UC โรงพยาบาลแม่สะเรียง**
พัฒนาโดย ศูนย์รายได้ โรงพยาบาลแม่สะเรียง

ระบบติดตามผลงานบริการผู้ป่วยใน (IP) สิทธิ UC ได้แก่ จำนวนบริการ, Adj.RW, CMI, BR และค่าชดเชยย้อนหลัง ตามปีงบประมาณ เดือน และงวด STM
พร้อมระบบ Login ด้วยบัญชี Google สำหรับผู้มีสิทธิ์นำเข้าและจัดการข้อมูล

```text
GitHub Pages (Frontend: HTML / CSS / Vanilla JS / Chart.js / SheetJS)
  → Google Identity Services (GIS) — รับ Google ID Token
  → Google Apps Script Web App (API / Backend) — ตรวจ token, Session, สิทธิ์, ตรวจข้อมูล, Audit Log
  → Google Sheets (Database)
```

> Browser **ไม่เขียน Google Sheets โดยตรง** — ทุกการอ่าน/เพิ่ม/แก้ไข/ลบ ผ่าน Apps Script API เท่านั้น

---

## สารบัญ

1. [ความสามารถของระบบ](#1-ความสามารถของระบบ)
2. [โครงสร้างไฟล์](#2-โครงสร้างไฟล์)
3. [ขั้นตอนติดตั้ง (ทำตามทีละขั้น)](#3-ขั้นตอนติดตั้ง-ทำตามทีละขั้น)
4. [โครงสร้าง Google Sheets](#4-โครงสร้าง-google-sheets)
5. [สิทธิ์ผู้ใช้](#5-สิทธิ์ผู้ใช้)
6. [API Reference](#6-api-reference)
7. [การนำเข้าข้อมูลและไฟล์ตัวอย่าง](#7-การนำเข้าข้อมูลและไฟล์ตัวอย่าง)
8. [ความปลอดภัย](#8-ความปลอดภัย)
9. [สรุปการพัฒนาแต่ละ Phase](#9-สรุปการพัฒนาแต่ละ-phase)
10. [การแก้ปัญหาที่พบบ่อย](#10-การแก้ปัญหาที่พบบ่อย)
11. [การดูแลระบบ](#11-การดูแลระบบ)

---

## 1. ความสามารถของระบบ

**Dashboard (ดูได้โดยไม่ Login เมื่อเปิด PUBLIC_DASHBOARD — แสดงเฉพาะข้อมูลสรุป)**
- ตัวกรองแบบ Multi-select: ปีงบประมาณ, เดือน, งวด STM, ประเภทบริการ, ช่วงเวลาเริ่มต้น–สิ้นสุด (ตัวเลือกอ่านจากข้อมูลจริง)
- โหมดเปรียบเทียบ ปีงบประมาณหลัก vs ปีเปรียบเทียบ (ค่าเริ่มต้น = ปีล่าสุด เทียบปีก่อนหน้า) และเลือกเทียบเฉพาะเดือนที่มีข้อมูลตรงกัน
- KPI 6 ใบ: จำนวนบริการรวม, Adj.RW รวม, ค่าชดเชยรวมก่อนหักเงินเดือน, BR คูณ K รวม, CMI, รายได้เฉลี่ยต่อครั้ง — พร้อมลูกศรขึ้น/ลง, % และผลต่าง
- กราฟ 6 แบบ: แนวโน้มรายเดือน (เลือกตัวชี้วัด), เปรียบเทียบปีงบประมาณ (Grouped Bar), ค่าชดเชยรายเดือนแยกประเภท (Stacked Bar), สัดส่วนค่าชดเชย (Donut), Top ประเภทบริการ (5/10/ทั้งหมด), ความสัมพันธ์จำนวนบริการกับ Adj.RW (Bubble — ขนาดจุด = ค่าชดเชย, สลับสเกลลอการิทึมได้)
- ตารางวิเคราะห์ตามประเภทบริการ: Sort, Search, Pagination, ซ่อน/แสดงคอลัมน์, Export CSV/Excel, แถวรวม
- “ข้อมูลที่น่าสนใจ” สรุปอัตโนมัติจากตัวเลขจริงตามตัวกรอง (ไม่สรุปเมื่อข้อมูลไม่พอ)

**ระบบหลังบ้าน (ต้อง Login)**
- สมัครใช้งานด้วย Google (กรอกเฉพาะชื่อ-นามสกุล) → รอผู้ดูแลอนุมัติ
- นำเข้า .xlsx / .xls / .csv: ตรวจ Header → ตัวอย่างข้อมูล → ตรวจชนิดข้อมูล → โหมด Append / Upsert / Replace Batch → ตรวจซ้ำที่ Backend → ImportLogs + AuditLogs
- จัดการข้อมูล: เพิ่ม / แก้ไข (ป้องกันแก้ทับกัน) / Soft Delete / กู้คืน / ลบถาวร (SUPER_ADMIN เมื่อเปิดใน Settings)
- ลบข้อมูลหลายรายการ (ADMIN ขึ้นไป): ปุ่ม **ลบข้อมูล** → เลือก “ทั้งหมด” หรือตามเงื่อนไข ปีงบประมาณ · เดือน · งวด STM · ประเภทบริการ (เลือกได้หลายค่า) → ดูจำนวนและค่าชดเชยรวมก่อนลบ → พิมพ์คำยืนยัน · ส่งคำขอครั้งละ 500 รายการ บันทึก `DELETE` ใน AuditLogs ทุกรายการ
- ผู้ดูแลระบบ: จัดการผู้ใช้, Import Logs, Audit Logs, Settings (เปลี่ยนธีมทั้งระบบได้ 19 ธีม)

**มาตรฐานการออกแบบ** — Official Web Design System v2 (Font Prompt, Semantic color tokens, Bootstrap Icons, Chart.js)
ธีมหลัก `ipuc-vibrant` สร้างจากสีองค์กร (Navy `#0F2747`, Blue `#1976D2`, Cyan `#00A6C8`) เน้นสีสันสดใสและ Contrast ชัดเจน
Responsive (Desktop / Tablet / Mobile), Loading skeleton, Empty/Error state, Focus state, รองรับ `prefers-reduced-motion` และหน้าพิมพ์

---

## 2. โครงสร้างไฟล์

```text
/                               ← Root ของ GitHub repository (GitHub Pages)
├── index.html                  หน้าเว็บหลัก (SPA ใช้ hash route)
├── css/style.css               Design tokens + 19 themes + components
├── js/
│   ├── config.js               ค่าตั้งค่า (GOOGLE_CLIENT_ID, GAS_API_URL) — แก้ไฟล์นี้ไฟล์เดียว
│   ├── utils.js                escape HTML, format ไทย, Modal, MultiSelect, DataTable, Export, ตัวตรวจข้อมูล
│   ├── api.js                  เรียก Apps Script API
│   ├── auth.js                 Google Identity Services + Session
│   ├── demo-data.js            ข้อมูลจำลอง (ใช้เฉพาะเมื่อยังไม่ตั้งค่า GAS_API_URL)
│   ├── dashboard.js            ตัวกรอง KPI กราฟ ตาราง Insight
│   ├── import.js               นำเข้า Excel/CSV
│   ├── data-manager.js         เพิ่ม/แก้ไข/ลบข้อมูล
│   ├── users.js                ผู้ดูแลระบบ: ผู้ใช้, Import Logs, Audit Logs, Settings
│   └── app.js                  Router, Navbar, Theme
├── samples/
│   ├── ip_uc_import_template.xlsx   ไฟล์ตัวอย่างนำเข้า (มีชีตคำอธิบาย)
│   ├── ip_uc_import_template.csv
│   └── test_invalid_rows.csv        ไฟล์ทดสอบข้อมูลผิดพลาด
├── gas/                        ← Source code Google Apps Script (คัดลอกไปวางใน Apps Script)
│   ├── appsscript.json         Manifest (Asia/Bangkok, V8, Web App)
│   ├── Code.gs                 doGet/doPost, ตาราง Route, setup()
│   ├── Auth.gs                 ตรวจ Google ID Token, login/register/logout/getMe
│   ├── Session.gs              Session Token ใน CacheService
│   ├── Users.gs                อนุมัติ/ปฏิเสธ/ระงับ/เปลี่ยนสิทธิ์
│   ├── Data.gs                 getDashboard/getData/addData/updateData/deleteData
│   ├── Import.gs               importData (Append/Upsert/Replace, dry run)
│   ├── Logs.gs                 ImportLogs/AuditLogs
│   ├── Settings.gs             Settings + Script Properties
│   └── Utils.gs                Sheet database, Lock, sanitize, แปลงตัวเลข/ปีงบ
├── docs/TEST_CHECKLIST.md      Checklist ทดสอบตามสิทธิ์
├── tools/make_samples.py       สคริปต์สร้างไฟล์ตัวอย่าง (python + openpyxl)
└── .nojekyll
```

---

## 3. ขั้นตอนติดตั้ง (ทำตามทีละขั้น)

ใช้เวลาประมาณ 30–45 นาที ต้องมี: บัญชี Google ที่ **แก้ไข** Google Sheets ได้, บัญชี GitHub

### ขั้นที่ 1 — เตรียม Google Sheets

Spreadsheet ที่ใช้: `1rUx3pUu7FBzAPxLBoiKKXFricZnt145cCIT58f70Ibc`
(`https://docs.google.com/spreadsheets/d/1rUx3pUu7FBzAPxLBoiKKXFricZnt145cCIT58f70Ibc/edit`)

- ไม่ต้องสร้างชีตหรือ Header เอง — ฟังก์ชัน `setup()` จะสร้างให้
- ถ้ามีชีตชื่อ `Users`, `Data`, `ImportLogs`, `AuditLogs`, `Settings` อยู่แล้ว ระบบจะเติมเฉพาะ Header ที่ขาด (ไม่ลบคอลัมน์เดิม)
- **ไม่ต้องแชร์ Spreadsheet ให้สาธารณะ** เพราะ Apps Script ทำงานในนามเจ้าของสคริปต์

### ขั้นที่ 2 — สร้างโปรเจกต์ Google Apps Script

1. เปิด Google Sheets ข้างต้น → เมนู **ส่วนขยาย (Extensions) → Apps Script**
   (หรือสร้างโปรเจกต์ใหม่ที่ <https://script.google.com> ด้วยบัญชีที่แก้ไข Sheet ได้)
2. ตั้งชื่อโปรเจกต์ เช่น `IPUC Dashboard API`
3. ไปที่ **⚙️ Project Settings** → ติ๊ก **Show "appsscript.json" manifest file in editor**
4. กลับไปที่ **Editor** แล้วสร้างไฟล์ให้ครบ (ปุ่ม **+ → Script**) ชื่อตรงตามนี้ และคัดลอกเนื้อหาจากโฟลเดอร์ `gas/`

   | ไฟล์ใน Apps Script | คัดลอกจาก |
   |---|---|
   | `appsscript.json` | `gas/appsscript.json` (แทนที่ของเดิมทั้งหมด) |
   | `Code.gs` | `gas/Code.gs` (แทนที่ `function myFunction` เดิม) |
   | `Auth.gs`, `Session.gs`, `Users.gs`, `Data.gs`, `Import.gs`, `Logs.gs`, `Settings.gs`, `Utils.gs` | ไฟล์ชื่อเดียวกันใน `gas/` |

5. กด 💾 **Save project**

#### ทางเลือก: ใช้ clasp (Command line) แทนการคัดลอกเอง

1. เปิด Google Apps Script API ที่ <https://script.google.com/home/usersettings> (ครั้งเดียว)
2. ติดตั้งและ Login
   ```bash
   npm install -g @google/clasp
   ```
   ```bash
   clasp login
   ```
3. สร้างโปรเจกต์ที่ **ผูกกับ Sheet เดิม** — ใช้ `--parentId` โดย **ไม่ใส่ `--type sheets`**
   (clasp 3.x ถ้าใส่ `--type sheets` จะสร้าง Google Sheet ใหม่ขึ้นมาแทน) และรันในโฟลเดอร์ว่าง เพื่อไม่ให้ไฟล์เริ่มต้นทับโค้ดใน `gas/`
   ```bash
   clasp create-script --parentId 1rUx3pUu7FBzAPxLBoiKKXFricZnt145cCIT58f70Ibc --title "IPUC Dashboard API"
   ```
   ผลลัพธ์ต้องมีบรรทัด `Bound to document: ...1rUx3pUu7FBzAPxLBoiKKXFricZnt145cCIT58f70Ibc`
4. สร้างไฟล์ `.clasp.json` ที่ root ของโปรเจกต์นี้ (อยู่ใน `.gitignore` แล้ว)
   ```json
   { "scriptId": "<Script ID จากข้อ 3>", "rootDir": "gas" }
   ```
5. ตรวจรายการไฟล์ (ต้องมี 10 ไฟล์ใน `gas/`) แล้ว push
   ```bash
   clasp status
   ```
   ```bash
   clasp push -f
   ```
6. เปิด Editor ด้วย `clasp open-script` แล้วทำขั้นที่ 3–5 ต่อ · เมื่อแก้โค้ดภายหลังใช้ `clasp push -f` แล้ว Deploy New version (ขั้นที่ 6)

### ขั้นที่ 3 — สร้าง Google OAuth Client ID

1. เปิด <https://console.cloud.google.com/> → เลือกหรือสร้าง Project ใหม่ เช่น `ipuc-dashboard`
2. ไปที่ **APIs & Services → OAuth consent screen** (หน้าใหม่ชื่อ **Google Auth Platform**)
   - **Branding / App information**: App name `IP.UC Performance Analytics Dashboard`, User support email, Developer contact email
   - **Audience**: เลือก **External** (ถ้าใช้ Google Workspace ของหน่วยงานและต้องการจำกัดเฉพาะโดเมน เลือก Internal)
   - กด **Publish app** ให้สถานะเป็น **In production** (ถ้ายังเป็น Testing จะ Login ได้เฉพาะ Test users)
   - ระบบขอเฉพาะข้อมูลพื้นฐาน (openid, email, profile) จึงไม่ต้องยื่นขอ Verification
3. ไปที่ **Credentials (Clients) → + Create credentials → OAuth client ID**
   - Application type: **Web application**
   - Name: `IPUC GitHub Pages`
   - **Authorized JavaScript origins** — ใส่ “origin” เท่านั้น (ไม่มี path, ไม่มี `/` ท้าย):

     | กรณี | ค่าที่ต้องเพิ่ม |
     |---|---|
     | GitHub Pages | `https://<github-username>.github.io` |
     | Custom Domain | `https://dashboard.example.go.th` (โดเมนจริงของหน่วยงาน) |
     | ทดสอบในเครื่อง | `http://localhost` และ `http://localhost:8080` (ระบุพอร์ตที่ใช้) |

     > ถ้า repository ชื่อ `ipuc-dashboard` URL จะเป็น `https://<username>.github.io/ipuc-dashboard/` แต่ **origin** ที่ใส่คือ `https://<username>.github.io` เท่านั้น
   - **Authorized redirect URIs**: ไม่ต้องใส่ (ระบบใช้ popup + ID token)
4. กด **Create** แล้วคัดลอก **Client ID** (ลงท้ายด้วย `.apps.googleusercontent.com`)
   - ⚠️ ระบบนี้ **ไม่ใช้ Client Secret** — ห้ามนำ Client Secret ไปใส่ใน GitHub
   - การเพิ่ม origin อาจใช้เวลา 5 นาที – 2–3 ชั่วโมงจึงมีผล

### ขั้นที่ 4 — ตั้งค่า Script Properties

Apps Script → **⚙️ Project Settings → Script Properties → Add script property**

| Property | ค่า | จำเป็น |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Client ID จากขั้นที่ 3 | ✅ |
| `BOOTSTRAP_SUPER_ADMIN_EMAIL` | Gmail ของผู้ดูแลระบบสูงสุดคนแรก เช่น `revenue.msr@gmail.com` | ✅ |
| `SPREADSHEET_ID` | `1rUx3pUu7FBzAPxLBoiKKXFricZnt145cCIT58f70Ibc` (ถ้าไม่ใส่ `setup()` จะใส่ให้) | – |
| `ALLOWED_EMAIL_DOMAINS` | จำกัดโดเมนอีเมล คั่นด้วย `,` เช่น `gmail.com,moph.go.th` (เว้นว่าง = ไม่จำกัด) | – |

กด **Save script properties**

### ขั้นที่ 5 — รัน setup() และอนุญาตสิทธิ์

1. Editor → เลือกไฟล์ `Code.gs` → เลือกฟังก์ชัน **`setup`** ในแถบเครื่องมือ → กด **▶ Run**
2. หน้าต่าง Authorization required → **Review permissions** → เลือกบัญชี
   → ถ้าขึ้น “Google hasn't verified this app” กด **Advanced → Go to IPUC Dashboard API (unsafe)** → **Allow**
   (สิทธิ์ที่ขอ: เข้าถึง Google Sheets และเชื่อมต่อบริการภายนอกเพื่อตรวจ token กับ Google)
3. ดู **Execution log** ต้องเห็น
   ```text
   GOOGLE_CLIENT_ID: ตั้งค่าแล้ว
   BOOTSTRAP_SUPER_ADMIN_EMAIL: revenue.msr@gmail.com
   ```
4. เปิด Google Sheets จะเห็นชีต `Users`, `Data`, `ImportLogs`, `AuditLogs`, `Settings` พร้อม Header

### ขั้นที่ 6 — Deploy เป็น Web App

1. Apps Script → **Deploy → New deployment**
2. ⚙️ Select type → **Web app**
3. ตั้งค่า
   - Description: `v1.0.0`
   - **Execute as: Me** (อีเมลเจ้าของสคริปต์)
   - **Who has access: Anyone** (ต้องเป็น Anyone เพื่อให้ GitHub Pages เรียกได้ — ความปลอดภัยควบคุมด้วย Session/Role ใน Backend)
4. กด **Deploy** → คัดลอก **Web app URL** รูปแบบ `https://script.google.com/macros/s/AKfy.../exec`
5. ทดสอบ: เปิด URL ใน Browser ต้องเห็น
   ```json
   {"success":true,"message":"IP.UC API พร้อมใช้งาน","data":{"name":"IP.UC Performance Analytics Dashboard","version":"1.0.0",...}}
   ```

> **เมื่อแก้โค้ด .gs ภายหลัง** ต้อง **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**
> URL เดิมจะใช้ต่อได้ (ถ้ากด New deployment จะได้ URL ใหม่ ต้องแก้ config.js ตาม)

### ขั้นที่ 7 — ใส่ค่าใน `js/config.js`

```javascript
const CONFIG = Object.freeze({
  ...
  GOOGLE_CLIENT_ID: "1234567890-abcxyz.apps.googleusercontent.com",
  GAS_API_URL: "https://script.google.com/macros/s/AKfy.../exec",
  ...
});
```

- `GOOGLE_CLIENT_ID` ต้องเป็นค่าเดียวกับ Script Property `GOOGLE_CLIENT_ID`
- เมื่อยังไม่ได้ตั้งค่า `GAS_API_URL` หน้าเว็บจะแสดง **โหมดข้อมูลตัวอย่าง** พร้อมป้ายเตือน (ปิดได้ด้วย `DEMO_MODE: "off"`)

### ขั้นที่ 8 — เผยแพร่ด้วย GitHub Pages

1. สร้าง repository ใหม่ที่ <https://github.com/new> เช่น `ipuc-dashboard` (Public — หรือ Private ถ้าใช้ GitHub Pro/Team/Enterprise)
2. อัปโหลดไฟล์ทั้งหมดในโฟลเดอร์นี้ไว้ที่ root ของ repository (**Add file → Upload files** หรือใช้ git)
   ```bash
   git init
   ```
   ```bash
   git add .
   ```
   ```bash
   git commit -m "IP.UC Performance Analytics Dashboard v1.0.0"
   ```
   ```bash
   git branch -M main
   ```
   ```bash
   git remote add origin https://github.com/<username>/ipuc-dashboard.git
   ```
   ```bash
   git push -u origin main
   ```
3. Repository → **Settings → Pages** → Source: **Deploy from a branch** → Branch: `main` / `/ (root)` → **Save**
4. รอ 1–2 นาที จะได้ URL `https://<username>.github.io/ipuc-dashboard/`
5. เปิดหน้าเว็บ → ต้องไม่มีป้าย “โหมดข้อมูลตัวอย่าง”

**Custom Domain (ถ้ามี)**
1. DNS ของโดเมน: เพิ่ม **CNAME** `dashboard` → `<username>.github.io`
   (ถ้าเป็นโดเมนหลักแบบไม่มี subdomain ใช้ A records: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`)
2. Repository → Settings → Pages → **Custom domain** ใส่ `dashboard.example.go.th` → Save (GitHub จะสร้างไฟล์ `CNAME` ให้)
3. ติ๊ก **Enforce HTTPS** (อาจต้องรอออกใบรับรองสักครู่)
4. เพิ่ม `https://dashboard.example.go.th` ใน **Authorized JavaScript origins** (ขั้นที่ 3)

### ขั้นที่ 9 — สร้าง SUPER_ADMIN คนแรกและผู้ใช้อื่น

1. เปิดหน้าเว็บ → **เข้าสู่ระบบ → แท็บ สมัครใช้งาน** → กรอกชื่อ-นามสกุล → กดปุ่ม Google ด้วยบัญชี `BOOTSTRAP_SUPER_ADMIN_EMAIL`
2. ระบบอนุมัติเป็น **SUPER_ADMIN** และเข้าสู่ระบบทันที (ทำงานเฉพาะเมื่อยังไม่มี SUPER_ADMIN ในระบบ)
3. ให้เจ้าหน้าที่คนอื่นสมัครใช้งาน → SUPER_ADMIN/ADMIN ไปที่ **ผู้ดูแลระบบ → จัดการผู้ใช้ → ผู้รออนุมัติ → อนุมัติ** และเลือกสิทธิ์
4. นำเข้าข้อมูลครั้งแรกที่เมนู **นำเข้าข้อมูล** (ดู [หัวข้อ 7](#7-การนำเข้าข้อมูลและไฟล์ตัวอย่าง))
5. ทดสอบตาม [docs/TEST_CHECKLIST.md](docs/TEST_CHECKLIST.md)

---

## 4. โครงสร้าง Google Sheets

ระบบอ้างอิงคอลัมน์ด้วย **ชื่อ Header** (ย้ายลำดับคอลัมน์ได้ แต่ห้ามเปลี่ยนชื่อ) · วันที่เก็บเป็น ISO 8601 เวลาไทย เช่น `2026-09-12T10:30:00+07:00`

### Users
| คอลัมน์ | คำอธิบาย |
|---|---|
| `user_id` | UUID |
| `email` | อีเมลที่ Google ยืนยันแล้ว (ตัวพิมพ์เล็ก) |
| `first_name`, `last_name` | ชื่อ-นามสกุลจากฟอร์มสมัคร |
| `role` | `SUPER_ADMIN` / `ADMIN` / `EDITOR` / `VIEWER` |
| `status` | `pending` / `approved` / `rejected` / `suspended` |
| `created_at`, `approved_at`, `approved_by`, `last_login` | เวลา/ผู้อนุมัติ/เข้าใช้ล่าสุด |

### Data
| คอลัมน์ | คำอธิบาย |
|---|---|
| `record_id` | UUID ถาวร (ไม่ใช้เลขแถว) |
| `stm_period` | งวด STM เช่น `6907_IP_02` |
| `month_code` | YYMM เช่น `6907` |
| `fiscal_year` | ปีงบประมาณ พ.ศ. เช่น `2569` |
| `service_type` | ประเภทบริการ (ค่าว่าง → `ไม่ระบุประเภทบริการ`) |
| `br_after_deduction` | BR หลังหักเงินกัน สป.สธ. (Number) |
| `br_k` | BR คูณ K สป.สธ. (Number) |
| `service_count` | จำนวนครั้งบริการ (Number) |
| `adj_rw` | Adj.RW ที่ชดเชย (Number, 4 ตำแหน่ง) |
| `compensation` | ค่าชดเชยก่อนหักเงินเดือน (Number) |
| `import_batch_id` | รหัสชุดนำเข้า (`IMP-...`) หรือ `MANUAL` |
| `created_at`, `updated_at` | เวลาสร้าง/แก้ไขล่าสุด |
| `is_active` | `TRUE` / `FALSE` (Soft Delete) |

### ImportLogs
`import_id`, `timestamp`, `email`, `file_name`, `import_mode`, `rows_received`, `rows_inserted`, `rows_updated`, `rows_rejected`, `error_summary`
(โหมด Replace Batch: `rows_updated` = จำนวนแถวเดิมที่ถูกแทนที่)

### AuditLogs
`log_id`, `timestamp`, `email`, `action`, `record_id`, `old_value`, `new_value`, `user_agent`

เหตุการณ์: `LOGIN_SUCCESS`, `LOGIN_FAILED`, `REGISTER`, `APPROVE_USER`, `REJECT_USER`, `SUSPEND_USER`, `CHANGE_ROLE`, `IMPORT`, `ADD`, `UPDATE`, `DELETE`, `RESTORE`, `LOGOUT`, `SETTINGS_CHANGE`
(`old_value` / `new_value` เก็บเป็น JSON · `LOGIN_FAILED` บันทึกไม่เกิน 30 รายการ/นาที เพื่อป้องกัน Log ล้น)

### Settings
คอลัมน์: `key`, `value`, `description`, `updated_at`, `updated_by`

| key | ค่าเริ่มต้น | คำอธิบาย |
|---|---|---|
| `PUBLIC_DASHBOARD` | `TRUE` | ดู Dashboard (ข้อมูลสรุป) โดยไม่ Login |
| `ALLOW_REGISTRATION` | `TRUE` | เปิดรับสมัครผู้ใช้ใหม่ |
| `ORG_NAME` | `โรงพยาบาลแม่สะเรียง` | ชื่อหน่วยงานบนหน้าเว็บ |
| `DASHBOARD_THEME` | `ipuc-vibrant` | ธีมสีทั้งระบบ |
| `DATA_SOURCE_NOTE` | ข้อความแหล่งข้อมูล | แสดงท้าย Dashboard |
| `MAX_IMPORT_ROWS` | `5000` | จำนวนแถวสูงสุดต่อการนำเข้า |
| `ALLOW_HARD_DELETE` | `FALSE` | อนุญาต SUPER_ADMIN ลบถาวร |

แนะนำให้แก้ Settings ผ่านหน้าเว็บ (มี Audit Log) ถ้าแก้ในชีตโดยตรง ค่าจะมีผลภายใน 5 นาที

---

## 5. สิทธิ์ผู้ใช้

| ความสามารถ | VIEWER | EDITOR | ADMIN | SUPER_ADMIN |
|---|:-:|:-:|:-:|:-:|
| ดู Dashboard | ✅ | ✅ | ✅ | ✅ |
| นำเข้า / เพิ่ม / แก้ไขข้อมูล | – | ✅ | ✅ | ✅ |
| ลบ (Soft Delete) / กู้คืน / ดูข้อมูลที่ถูกลบ | – | – | ✅ | ✅ |
| อนุมัติ / ปฏิเสธ / ระงับ / เปลี่ยนสิทธิ์ VIEWER–EDITOR | – | – | ✅ | ✅ |
| จัดการบัญชี ADMIN / กำหนดสิทธิ์ ADMIN ขึ้นไป | – | – | – | ✅ |
| ดู Import Logs / Audit Logs / Settings | – | – | ✅ | ✅ |
| แก้ไข Settings / ลบถาวร | – | – | – | ✅ |

กฎเพิ่มเติม: ห้ามจัดการบัญชีของตนเอง · ต้องมี SUPER_ADMIN ที่ approved อย่างน้อย 1 บัญชี · สถานะ/สิทธิ์ถูกอ่านจากชีต Users **ทุกคำขอ** (ระงับแล้วมีผลทันที)

**Session**: Token = `Utilities.getUuid() + Utilities.getUuid()` เก็บใน CacheService · หมดอายุเมื่อไม่ใช้งาน 60 นาที (ต่ออายุเมื่อเรียก API) · อายุสูงสุด 8 ชั่วโมง · Logout ลบ token ทันที

---

## 6. API Reference

Endpoint เดียว: `POST <GAS_API_URL>` · Header `Content-Type: text/plain;charset=utf-8`

```json
{ "action": "getData", "token": "<session token>", "payload": { }, "client": { "ua": "..." } }
```

Response
```json
{ "success": true, "message": "OK", "data": {} }
{ "success": false, "code": "FORBIDDEN", "message": "ไม่มีสิทธิ์ใช้งาน" }
```
(`VALIDATION_ERROR` / `DUPLICATE` อาจมี `details: [{ field?, message }]`)

| action | สิทธิ์ | payload สำคัญ |
|---|---|---|
| `login` | สาธารณะ | `credential` (Google ID Token) |
| `register` | สาธารณะ | `credential`, `first_name`, `last_name` |
| `logout` | มี token | – |
| `getMe` | VIEWER+ | – |
| `getDashboard` | สาธารณะ* | `filters?`: `fiscal_years[]`, `months[]`, `stm_periods[]`, `service_types[]`, `month_from`, `month_to` |
| `getFilterOptions` | สาธารณะ* | – |
| `getData` | EDITOR+ | `include_inactive` (ADMIN+), `filters?` |
| `importData` | EDITOR+ | `mode` (`append`/`upsert`/`replace`), `rows[]`, `file_name`, `dry_run`, `replace_periods[]`, `confirm_replace` |
| `addData` | EDITOR+ | `record` |
| `updateData` | EDITOR+ | `record_id`, `record`, `expected_updated_at`, `restore` (ADMIN+) |
| `deleteData` | ADMIN+ | `record_id` หรือ `record_ids[]`, `mode` (`soft`/`hard` — hard เฉพาะ SUPER_ADMIN) |
| `getUsers` | ADMIN+ | `status?` |
| `approveUser` | ADMIN+ | `user_id`, `role?`, `reason?` |
| `rejectUser` / `suspendUser` | ADMIN+ | `user_id`, `reason?` |
| `changeUserRole` | ADMIN+ | `user_id`, `role` |
| `getImportLogs` | ADMIN+ | `date_from`, `date_to` (YYYY-MM-DD), `email`, `mode`, `limit` |
| `getAuditLogs` | ADMIN+ | `date_from`, `date_to`, `email`, `action`, `search`, `limit` |
| `getSettings` | สาธารณะ (ค่า public) / ADMIN+ (ทั้งหมด) | – |
| `updateSettings` | SUPER_ADMIN | `settings: { KEY: value }` |

\* ต้อง Login เมื่อ `PUBLIC_DASHBOARD = FALSE`

**Error codes**: `BAD_REQUEST`, `UNAUTHORIZED`, `SESSION_EXPIRED`, `USER_NOT_FOUND`, `PENDING_APPROVAL`, `USER_SUSPENDED`, `USER_REJECTED`, `FORBIDDEN`, `VALIDATION_ERROR`, `DUPLICATE`, `NOT_FOUND`, `CONFLICT`, `SERVER_BUSY`, `INTERNAL_ERROR`

---

## 7. การนำเข้าข้อมูลและไฟล์ตัวอย่าง

ไฟล์ตัวอย่าง: [`samples/ip_uc_import_template.xlsx`](samples/ip_uc_import_template.xlsx) (ชีต “ข้อมูลนำเข้า” + ชีต “คำอธิบาย”) และ [`samples/ip_uc_import_template.csv`](samples/ip_uc_import_template.csv)
> ตัวเลขในไฟล์ตัวอย่างเป็นข้อมูลสมมติ ใช้ดูรูปแบบเท่านั้น

**Header ที่จำเป็น (ครบ 9 คอลัมน์ ลำดับใดก็ได้ อยู่ภายใน 20 แถวแรก)**

| งวด STM | เดือน | ปีงบประมาณ | ประเภทบริการ | BR หลังหักเงินกัน สป.สธ. | BR คูณ K สป.สธ. | ครั้ง(บริการ) | Adj.RW ที่ชดเชย | ชดเชยก่อนหักเงินเดือน |
|---|---|---|---|---|---|---|---|---|
| 6907_IP_02 | 6907 | 2569 | IP ในเขต | 1,215,982.40 | 1,179,502.93 | 412 | 158.3312 | 1,184,501.66 |

**กติกาการตรวจสอบ** (ทำทั้งที่ Browser และซ้ำที่ Apps Script)
- งวด STM ห้ามว่าง · เดือนต้องเป็น YYMM (01–12) · ปีงบประมาณ พ.ศ. 4 หลัก (ถ้าว่างคำนวณจากเดือน / ปี ค.ศ. แปลงเป็น พ.ศ. ให้พร้อมคำเตือน)
- ตัวเลขรองรับ `1,184,501.66`, `฿1,000`, `(1,234.00)` = ติดลบ · ค่าว่างหรือ `-` = 0 · ข้อความอื่นไม่ผ่าน
- ประเภทบริการว่าง → `ไม่ระบุประเภทบริการ` · แถว “รวม/Total” ไม่ผ่าน · แถวว่างถูกข้าม (แสดงจำนวน)
- ข้อมูลซ้ำ = 7 ฟิลด์ตรงกันทั้งหมด: งวด STM, เดือน, ปีงบประมาณ, ประเภทบริการ, ครั้ง(บริการ), Adj.RW ที่ชดเชย, ชดเชยก่อนหักเงินเดือน (ไม่เทียบค่า BR) · ซ้ำในไฟล์ไม่ผ่าน
  - แถวที่งวด STM + ประเภทบริการเดียวกันแต่ ครั้ง / Adj.RW / ค่าชดเชย ต่างกัน **ไม่ถือว่าซ้ำ** และนำเข้าเป็นแถวใหม่
  - โหมด Upsert อัปเดตเฉพาะค่า BR ของแถวที่ซ้ำ · แถวที่ค่าเหมือนเดิมทุกคอลัมน์นับเป็น “ซ้ำและค่าเหมือนเดิม (ข้าม)”
- คำเตือน (ยังนำเข้าได้): ปีงบไม่สอดคล้องเดือน, งวด STM ไม่ตรงเดือน, ค่าติดลบ, จำนวนครั้งไม่เป็นจำนวนเต็ม

**โหมดนำเข้า**

| โหมด | พฤติกรรม |
|---|---|
| Append | เพิ่มเฉพาะคีย์ใหม่ · คีย์ที่มีอยู่แล้วแสดงเป็น “ไม่ผ่าน” |
| Upsert | เพิ่มคีย์ใหม่ + อัปเดตคีย์ที่มีอยู่ (บันทึก old/new ใน AuditLogs) |
| Replace Batch | Soft delete ข้อมูลเดิม **ทั้งหมด** ของงวด STM ที่เลือก แล้วเพิ่มข้อมูลจากไฟล์ · ต้องยืนยัน 2 ครั้ง (พิมพ์ “แทนที่ข้อมูล”) |

ปุ่ม **ตรวจสอบกับฐานข้อมูล (ยังไม่บันทึก)** จะแสดงผลลัพธ์จำลองก่อนบันทึกจริง

---

## 8. ความปลอดภัย

| ข้อกำหนด | การดำเนินการในระบบ |
|---|---|
| HTTPS เท่านั้น | GitHub Pages (Enforce HTTPS) และ `script.google.com` เป็น HTTPS |
| Google Identity Services | ใช้ปุ่ม Sign in with Google (`accounts.google.com/gsi/client`) |
| ตรวจ ID Token ที่ Backend | `Auth.gs` เรียก Google tokeninfo ตรวจ `aud` = GOOGLE_CLIENT_ID, `iss`, `exp`, `email_verified` · Frontend ไม่ decode token |
| Session หมดอายุได้ | CacheService, idle 60 นาที, สูงสุด 8 ชั่วโมง, Logout ลบทันที |
| ตรวจ role/status ทุกครั้ง | `dispatch_()` → `authenticate_()` อ่านชีต Users ทุกคำขอ |
| ตรวจข้อมูล 2 ชั้น | `U.validateRecord` (Browser) และ `validateRecordInput_` (Backend) |
| Audit Log | ทุกการเพิ่ม/แก้ไข/ลบ/นำเข้า/จัดการผู้ใช้/Settings/Login |
| ไม่มี secret ใน GitHub | `config.js` มีเฉพาะ Client ID (ค่าสาธารณะ) และ URL · ค่าที่สำคัญอยู่ใน Script Properties |
| ไม่ใช้ hidden button ป้องกันสิทธิ์ | เมนู/ปุ่มซ่อนเพื่อ UX เท่านั้น Backend ตรวจสิทธิ์ทุก action |
| ป้องกัน XSS | Template `html```` escape ค่าอัตโนมัติ · Backend ตัด HTML tag · CSP ใน `index.html` |
| ป้องกันสูตรใน Sheets / CSV | ตัด `= + @` นำหน้า · ตั้งคอลัมน์ข้อความเป็น Plain text ก่อนเขียน · CSV export ใส่ `'` นำหน้า |
| ไม่มีข้อมูลผู้ป่วย | Dashboard ใช้เฉพาะข้อมูลสรุประดับประเภทบริการ ไม่มี HN/ชื่อผู้ป่วย |
| เขียนพร้อมกัน | `LockService` ป้องกันการเขียนชนกัน · `expected_updated_at` ป้องกันแก้ทับกัน |

> ถ้าเพิ่ม CDN หรือโดเมน API อื่น ต้องแก้ `Content-Security-Policy` ใน `<head>` ของ `index.html`

---

## 9. สรุปการพัฒนาแต่ละ Phase

| Phase | ไฟล์หลัก | ตั้งค่า | วิธีทดสอบ |
|---|---|---|---|
| **1** Schema, GIS Login, สมัคร, Session, อนุมัติ, Logout | `gas/Code.gs`, `Utils.gs`, `Auth.gs`, `Session.gs`, `Users.gs`, `Settings.gs`, `Logs.gs` · `js/auth.js`, `api.js`, `app.js` | ขั้นที่ 2–7 | Checklist หัวข้อ 0–3 |
| **2** API อ่านข้อมูล, Filter, KPI, Chart, ตาราง | `gas/Data.gs` · `js/dashboard.js`, `utils.js`, `demo-data.js` · `index.html`, `css/style.css` | – | Checklist หัวข้อ 8 |
| **3** Upload Excel/CSV, Preview, Validation, ImportLogs, Upsert | `gas/Import.gs` · `js/import.js` · `samples/*` | `MAX_IMPORT_ROWS` | Checklist 4.2–4.5 และหัวข้อ 7 |
| **4** เพิ่ม/แก้ไข/ลบ + AuditLogs | `gas/Data.gs` · `js/data-manager.js` | `ALLOW_HARD_DELETE` | Checklist 4.6–4.10, 5.7–5.8 |
| **5** Admin: ผู้ใช้, Import/Audit Logs, Settings | `gas/Users.gs`, `Logs.gs`, `Settings.gs` · `js/users.js` | – | Checklist หัวข้อ 5–6 |
| **6** ทดสอบสิทธิ์, ข้อมูลผิดพลาด, Responsive, คู่มือ | `docs/TEST_CHECKLIST.md`, `samples/test_invalid_rows.csv`, `README.md` | – | Checklist ทั้งหมด |

---

## 10. การแก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| ปุ่ม Google ขึ้น “Error 400: origin_mismatch” หรือ “The given origin is not allowed” | ยังไม่ได้เพิ่ม origin ใน Authorized JavaScript origins หรือพิมพ์ผิด (ต้องไม่มี path/`/` ท้าย) · รอให้มีผล 5 นาที–ไม่กี่ชั่วโมง |
| หน้าเว็บขึ้น “ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้” | Deploy ไม่ได้ตั้ง **Who has access: Anyone** · URL ไม่ลงท้าย `/exec` · ยังไม่ Authorize (รัน `setup()`) |
| “รูปแบบข้อมูลตอบกลับไม่ถูกต้อง” | Apps Script ส่งหน้า HTML error กลับมา: แก้โค้ดแล้วยังไม่ Deploy New version · สิทธิ์เพิ่มใหม่ยังไม่ Authorize |
| Login แล้วได้ “Google Client ID ไม่ตรงกับที่ระบบกำหนด” | `GOOGLE_CLIENT_ID` ใน Script Properties ไม่ตรงกับ `js/config.js` |
| “ผู้ดูแลระบบยังไม่ได้ตั้งค่า GOOGLE_CLIENT_ID” | ตั้ง Script Property แล้ว Deploy New version |
| ปุ่ม Google ไม่แสดง | ตัวบล็อกโฆษณา/ความเป็นส่วนตัวบล็อก `accounts.google.com` · ลองหน้าต่างปกติ (ไม่ใช่ Incognito ที่ปิด third-party sign-in) |
| แก้ข้อมูลในชีต Data โดยตรงแล้ว Dashboard ไม่เปลี่ยน | Cache 5 นาที → รัน `refreshDataCache()` ใน Apps Script (เติม record_id ที่ว่างให้ด้วย) |
| SUPER_ADMIN คนแรกสมัครแล้วยังเป็น pending | อีเมลไม่ตรงกับ `BOOTSTRAP_SUPER_ADMIN_EMAIL` หรือมี SUPER_ADMIN ที่ approved อยู่แล้ว |
| นำเข้าไฟล์ใหญ่แล้ว “หมดเวลารอการตอบกลับ” | Apps Script จำกัด 6 นาที/คำขอ · แบ่งไฟล์ให้เล็กลง หรือลด `MAX_IMPORT_ROWS` |
| “ระบบกำลังประมวลผลคำขออื่น” | มีการนำเข้า/แก้ไขพร้อมกัน รอสักครู่แล้วลองใหม่ |

ขีดจำกัดของ Apps Script (บัญชี Gmail ทั่วไป): เวลา 6 นาที/คำขอ · UrlFetch 20,000 ครั้ง/วัน · ทำงานพร้อมกันประมาณ 30 คำขอ — เพียงพอสำหรับการใช้งานภายในโรงพยาบาล

---

## 11. การดูแลระบบ

- **สำรองข้อมูล**: Google Sheets → File → Version history หรือ File → Make a copy เป็นระยะ
- **อัปเดตโค้ด Backend**: แก้ .gs → Deploy → Manage deployments → Edit → New version
- **อัปเดต Frontend**: push ขึ้น GitHub · ผู้ใช้กด Ctrl+F5 ถ้ายังเห็นเวอร์ชันเก่า
- **เปลี่ยนธีม**: ผู้ดูแลระบบ → Settings → ธีมสี Dashboard (หรือแก้ `DEFAULT_THEME` ใน config.js)
- **Logs เติบโต**: เมื่อ AuditLogs เกินหลายหมื่นแถว ให้คัดลอกแถวเก่าไปไฟล์เก็บถาวรแล้วลบออก (คงแถว Header)
- **สร้างไฟล์ตัวอย่างใหม่**: `python tools/make_samples.py`

---

พัฒนาโดย **ศูนย์รายได้ โรงพยาบาลแม่สะเรียง**
