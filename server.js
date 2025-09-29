// server.js

// 1. นำเข้าโมดูลที่จำเป็น
require('dotenv').config(); 
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const mongoose = require('mongoose'); // ฐานข้อมูล MongoDB

const app = express();
const port = process.env.PORT || 3000;

// 2. กำหนดค่า Supabase Client (PostgreSQL)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// 3. การเชื่อมต่อ MongoDB และ Model
const mongoURI = process.env.MONGO_URI; 
mongoose.connect(mongoURI).then(() => {
    console.log('✅ MongoDB Atlas connected successfully.');
}).catch(err => {
    // 🛑 การจัดการ Error: Server ยังคงทำงานได้แม้ไม่มี Log System
    console.error('❌ MongoDB connection error, LOGS DISABLED:', err.message);
});

// 4. สร้าง MongoDB Schema สำหรับ Activity Logs
const ActivityLogSchema = new mongoose.Schema({
    timestamp: { type: Date, default: Date.now },
    userId: { type: Number, required: true },
    action: { type: String, required: true },
    details: { type: mongoose.Schema.Types.Mixed },
}, { collection: 'activity_logs' });
const ActivityLog = mongoose.model('ActivityLog', ActivityLogSchema); 


// 5. กำหนดค่า Middleware (ต้องอยู่ก่อน API Endpoints เสมอ)
app.use(cors()); 
app.use(express.json()); 


// 6. API Endpoint: ดึงรายการกระทู้ทั้งหมด (GET /api/threads)
app.get('/api/threads', async (req, res) => {
    
    // A. บันทึก Log ก่อนการดึงข้อมูล
    if (mongoose.connection.readyState === 1) { 
        try {
            await ActivityLog.create({
                userId: 0, 
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
    
    // C. การจัดการ Error และส่ง Response
    if (error) {
        console.error('Error fetching threads:', error);
        return res.status(500).json({ error: 'Failed to fetch threads from database.' });
    }
    
    // ส่งข้อมูลกลับไปยัง Frontend
    res.status(200).json(threads);
});


// 7. API Endpoint: สร้างกระทู้ใหม่ (POST /api/threads)
// 🛑 แก้ไขชื่อ Endpoint ให้เป็น /api/threads เพื่อความสอดคล้องกับ RESTful API
app.post('/api/threads', async (req, res) => { 
    const { title, content, userId, categoryId } = req.body;

    // 1. สร้างกระทู้ (Thread)
    const { data: threadData, error: threadError } = await supabase
        .from('threads')
        .insert([{ title, user_id: userId, category_id: categoryId }])
        .select('id') // เลือกเฉพาะ ID
        .single(); 

    if (threadError) {
        console.error('Error creating thread:', threadError);
        return res.status(500).json({ error: 'Failed to create thread.', details: threadError.message });
    }

    // 2. สร้างโพสต์แรก (Original Post)
    const { error: postError } = await supabase
        .from('posts')
        .insert([{ 
            content: content, 
            user_id: userId, 
            thread_id: threadData.id, 
            is_original_post: true 
        }]);

    if (postError) {
        console.error('Error creating post:', postError);
        return res.status(500).json({ error: 'Failed to create original post.' });
    }
    
    // D. บันทึก Log เมื่อสร้างกระทู้สำเร็จ
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

// 🆕 8. สร้าง API Endpoint: สมัครสมาชิก (POST /api/auth/register)
// 🛑 นี่คือ Endpoint ที่ฟอร์มสมัครสมาชิกควรจะเรียกใช้
app.post('/api/auth/register', async (req, res) => {
    // โค้ดนี้ใช้ Supabase เพื่อบันทึกผู้ใช้ใหม่
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'Missing username, email, or password.' });
    }

    try {
        const passwordHash = 'DUMMY_HASH_' + Math.random().toString(36).substring(2, 15);
        
        // 1. สร้างผู้ใช้ในตาราง users (Supabase)
        const { data: userData, error: userError } = await supabase
            .from('users')
            .insert([{ username, email, password_hash: passwordHash }])
            .select('id')
            .single();

        if (userError) {
            return res.status(409).json({ error: 'Registration failed. Username or email may already be in use.', details: userError.message });
        }
        
        const newUserId = userData.id;

        // 2. กำหนดบทบาท 'user' เริ่มต้น (Role ID 1 คือ 'user')
        await supabase.from('user_roles').insert([{ user_id: newUserId, role_id: 1 }]); 

        // 3. บันทึก Log การสมัครสมาชิก
        if (mongoose.connection.readyState === 1) { 
            await ActivityLog.create({
                userId: newUserId, 
                action: 'USER_REGISTERED',
                details: { email: email }
            });
        }

        // 4. ส่ง Response กลับไป
        res.status(201).json({ 
            message: 'Registration successful!', 
            userId: newUserId 
        });

    } catch (error) {
        console.error('Error during user registration:', error);
        return res.status(500).json({ error: 'Server error during registration process.' });
    }
});

// server.js (เพิ่มในส่วน API Endpoints)

// 🆕 9. API Endpoint: ล็อกอิน (POST /api/auth/login)
app.post('/api/auth/login', async (req, res) => {
    // ⚠️ ในโปรเจกต์จริง ต้องมีการ hash รหัสผ่าน!
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: 'Missing email or password.' });
    }

    try {
        // 1. ค้นหาผู้ใช้จาก email (Supabase)
        const { data: user, error } = await supabase
            .from('users')
            .select('id, username, password_hash')
            .eq('email', email)
            .single();

        if (error || !user) {
            return res.status(401).json({ error: 'Invalid credentials.' });
        }
        
        // 2. ตรวจสอบรหัสผ่าน (ในโปรเจกต์จริง: ใช้ bcrypt.compare)
        // สำหรับ MVP: ตรวจสอบแค่ว่า password ไม่ใช่ค่าว่าง
        if (user.password_hash === 'DUMMY_HASH' && password !== '') {
            // รหัสผ่านถูกต้อง
            
            // 3. 🆕 สร้าง Token (ในโปรเจกต์จริง: ใช้ JWT)
            // สำหรับ MVP: ส่งข้อมูลผู้ใช้กลับไปแทน Token จริง
            const token = { 
                userId: user.id, 
                username: user.username,
                role: 'user' // ต้องดึง role จาก user_roles ในโปรเจกต์จริง
            };

            // 4. บันทึก Log การล็อกอิน
            if (mongoose.connection.readyState === 1) { 
                await ActivityLog.create({
                    userId: user.id, 
                    action: 'USER_LOGIN_SUCCESS',
                    details: { email: email }
                });
            }

            // ส่งข้อมูลผู้ใช้และ Token กลับ
            return res.status(200).json({ 
                message: 'Login successful', 
                token: token,
                user: { id: user.id, username: user.username }
            });
        } else {
            return res.status(401).json({ error: 'Invalid credentials.' });
        }

    } catch (error) {
        console.error('Error during user login:', error);
        return res.status(500).json({ error: 'Server error during login process.' });
    }
});