// server.js

// 1. นำเข้าโมดูลที่จำเป็น
require('dotenv').config(); // โหลดค่าจาก .env
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// 2. กำหนดค่า Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

// สร้าง Client สำหรับเชื่อมต่อ Supabase
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// 3. กำหนดค่า Middleware
app.use(cors()); // อนุญาตให้ Frontend (โดเมนอื่น) เข้าถึงได้
app.use(express.json()); // สำหรับการรับข้อมูลในรูปแบบ JSON

// 4. สร้าง API Endpoint: ดึงรายการกระทู้ทั้งหมด
app.get('/api/threads', async (req, res) => {
    // 4.1. ใช้ Supabase Client ดึงข้อมูล
    const { data: threads, error } = await supabase
        .from('threads') // เลือกตาราง threads
        .select(`
            id, 
            title, 
            created_at,
            categories(name), 
            users(username) 
        `) // โค้ด Clean แล้ว!
        .order('created_at', { ascending: false }); // เรียงตามเวลาล่าสุด
    
    // ... โค้ดส่วนล่าง ...
});

// 5. เริ่มต้น Server
app.listen(port, () => {
    console.log(`Mini Forum Backend API running at http://localhost:${port}`);
    console.log('----------------------------------------------------');
    console.log('To test, go to: http://localhost:3000/api/threads');
});