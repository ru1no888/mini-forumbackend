// server.js

// 1. นำเข้าโมดูลที่จำเป็น
require('dotenv').config(); 
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
// 🆕 เพิ่ม Mongoose สำหรับ MongoDB
const mongoose = require('mongoose'); 

const app = express();
const port = process.env.PORT || 3000;

// 2. กำหนดค่า Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// 3. 🆕 การเชื่อมต่อ MongoDB และ Model (ใช้ MONGO_URI จาก .env)
const mongoURI = process.env.MONGO_URI; 

mongoose.connect(mongoURI).then(() => {
    console.log('✅ MongoDB Atlas connected successfully.');
}).catch(err => {
    // 🛑 การจัดการ Error: Log System จะถูกปิดหาก MongoDB มีปัญหา แต่ Server จะไม่ Crash
    console.error('❌ MongoDB connection error, LOGS DISABLED:', err.message);
});

// 4. 🆕 สร้าง MongoDB Schema สำหรับ Activity Logs (NoSQL)
const ActivityLogSchema = new mongoose.Schema({
    timestamp: { type: Date, default: Date.now },
    userId: { type: Number, required: true },
    action: { type: String, required: true },
    details: { type: mongoose.Schema.Types.Mixed },
}, { collection: 'activity_logs' }); // ตั้งชื่อ Collection
const ActivityLog = mongoose.model('ActivityLog', ActivityLogSchema); 


// 5. กำหนดค่า Middleware
app.use(cors()); 
app.use(express.json()); 

// 6. สร้าง API Endpoint: ดึงรายการกระทู้ทั้งหมด (GET /api/threads)
app.get('/api/threads', async (req, res) => {
    
    // 🆕 A. บันทึก Log ก่อนการดึงข้อมูล (ถ้า MongoDB เชื่อมต่ออยู่)
    if (mongoose.connection.readyState === 1) { 
        try {
            await ActivityLog.create({
                userId: 0, // User ทั่วไป (Guest)
                action: 'GET_THREADS_REQUEST',
                details: { ip: req.ip || 'Unknown' }
            });
        } catch (logError) {
            console.error("Failed to record log to MongoDB:", logError);
        }
    }

    // B. ใช้ Supabase Client ดึงข้อมูล
    const { data: threads, error } = await supabase
        .from('threads') 
        .select(`
            id, 
            title, 
            created_at,
            categories(name), 
            users(username) 
        `) 
        .order('created_at', { ascending: false }); 
    
    // C. การจัดการ Error
    if (error) {
        console.error('Error fetching threads:', error);
        return res.status(500).json({ error: 'Failed to fetch threads from database.' });
    }
    
    // ❗ สิ่งที่ขาดไป: ส่งข้อมูลกลับ (Response)
    res.status(200).json(threads);
});

// 7. สร้าง API Endpoint: สร้างกระทู้ใหม่ (POST /api/threads)
app.post('/api/threads', async (req, res) => {
    const { title, content, userId, categoryId } = req.body;

    // 1. สร้างกระทู้ (Thread)
    const { data: threadData, error: threadError } = await supabase
        .from('threads')
        .insert([{ title, user_id: userId, category_id: categoryId }])
        .select()
        .single(); 

    if (threadError) {
        console.error('Error creating thread:', threadError);
        // 🆕 ควรระบุรายละเอียด Error เพื่อการ Debug
        return res.status(500).json({ error: 'Failed to create thread.', details: threadError.message });
    }

    // 2. สร้างโพสต์แรก (Original Post)
    const { data: postData, error: postError } = await supabase
        .from('posts')
        .insert([{ 
            content: content, 
            user_id: userId, 
            thread_id: threadData.id, 
            is_original_post: true 
        }])
        .select()
        .single();

    if (postError) {
        console.error('Error creating post:', postError);
        // ⚠️ ในการใช้งานจริง ควรมี Logic ลบกระทู้ที่สร้างไปแล้ว (Rollback) ด้วย
        return res.status(500).json({ error: 'Failed to create original post.' });
    }
    
    // 🆕 D. บันทึก Log เมื่อสร้างกระทู้สำเร็จ
    if (mongoose.connection.readyState === 1) { 
        try {
            await ActivityLog.create({
                userId: userId, 
                action: 'CREATE_THREAD_SUCCESS',
                details: { threadId: threadData.id, title: title }
            });
        } catch (logError) {
            console.error("Failed to record post log to MongoDB:", logError);
        }
    }

    res.status(201).json({ 
        message: 'Thread and original post created successfully', 
        threadId: threadData.id 
    });
});

// 8. เริ่มต้น Server
app.listen(port, () => {
    console.log(`Mini Forum Backend API running at http://localhost:${port}`);
    console.log('----------------------------------------------------');
    console.log('To test, go to: http://localhost:3000/api/threads');
});