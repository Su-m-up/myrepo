const fs = require('fs');
const path = require('path');
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mysql = require('mysql2/promise');
const morgan = require('morgan');
const winston = require('winston');
const jwt = require('jsonwebtoken');
const { createCanvas } = require('canvas');
const d3 = require('d3-force');
const { spawn } = require('child_process');
const NodeCache = require('node-cache');
// const expressJwt = require('express-jwt');

function logRequest(req) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
}

const app = express();
const port = process.env.PORT || 3007;

// 初始化缓存
const myCache = new NodeCache();

// 数据库配置
const DB_CONFIG = {
    host: 'localhost',
    user: 'zuizhong',
    password: 'Z72b7kFaTFBbb24S',//Z72b7kFaTFBbb24S
    database: 'zuizhong',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: '+08:00',
    charset: 'utf8mb4'
};

// 创建连接池
const zuizhongPool = mysql.createPool(DB_CONFIG);

// 中间件配置
app.use(cors());
app.use(bodyParser.json());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// app.use(expressJwt({ secret: JWT_SECRET, algorithms: ['HS256'] }).unless({ path: ['/login'] }));



app.get('/', (req, res) => {
    res.redirect('/login');
});


///////////////图片缓存////////////////////
// 假设这是你的图片目录

const imageDirectory = path.join(__dirname, 'suxinhao');

// 用于缓存图片的对象
const imageCache = {};

// 提前缓存图片
function preCacheImages() {
    const imageFormats = ['.jpg', '.png', '.webp'];
    const readDirectoryRecursively = (dir) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
                readDirectoryRecursively(filePath);
            } else {
                const ext = path.extname(file).toLowerCase();
                if (imageFormats.includes(ext)) {
                    const relativePath = path.relative(imageDirectory, filePath);
                    const key = relativePath.replace(/\\/g, '/').replace(ext, '');
                    imageCache[key] = filePath;
                }
            }
        }
    };
    readDirectoryRecursively(imageDirectory);
}

// 启动时缓存图片
preCacheImages();



// 刷新 Token 接口
app.post('/api/refresh_token', (req, res) => {
    const refreshToken = req.body.refreshToken;

    // 验证刷新 Token
    jwt.verify(refreshToken, process.env.REFRESH_SECRET || 'your_refresh_secret', (err, decoded) => {
        if (err) {
            return res.status(403).json({ code: 40302, message: '无效的刷新令牌' });
        }

        // 生成新的访问 Token
        const accessToken = jwt.sign({ userId: decoded.userId }, process.env.ACCESS_SECRET || 'your_access_secret', {
            expiresIn: '15m'
        });

        res.json({ code: 20001, accessToken });
    });
});




// 改成：Map<userId_Level, Set<id>>
function getUsedQuestionIds(userId, level) {
    const key = `${userId}_${level}`;
    if (!usedQuestionIdsMap.has(key)) {
        usedQuestionIdsMap.set(key, new Set());
    }
    return usedQuestionIdsMap.get(key);
}

// function readJsonFile(fileName) {
//     try {
//         const filePath = path.join(__dirname, fileName);
//         const data = fs.readFileSync(filePath, 'utf8');
//         return JSON.parse(data);
//     } catch (error) {
//         console.error(`读取 JSON 文件 ${fileName} 失败:`, error);
//         throw new Error(`JSON 文件 ${fileName} 读取失败`);
//     }
// }



// const authMiddleware = (req, res, next) => {
//     try {
//         const token = req.headers.authorization?.split(' ')[1];
//         if (!token) return res.status(401).json({ code: 40101, message: '未提供令牌' });

//         jwt.verify(
//             token,
//             process.env.JWT_SECRET || 'default-secret-key',
//             (err, decoded) => {
//                 if (err) {
//                     console.error('JWT 验证错误:', err);
//                     return res.status(403).json({ code: 40301, message: '无效令牌' });
//                 }
//                 req.user = decoded;
//                 next();
//             }
//         );
//     } catch (err) {
//         console.error('认证中间件错误:', err);
//         res.status(500).json({ code: 50001, message: '认证系统错误' });
//     }
// };

const authMiddleware = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ code: 40101, message: '未提供令牌' });
    }

    jwt.verify(
        token,
        process.env.JWT_SECRET || 'default-secret-key',
        (err, decoded) => {
            console.log('JWT 解码内容:', decoded); // 新增日志，确认 decoded 包含 userId
            if (err) {
                console.error('JWT 验证错误:', err);
                return res.status(403).json({ code: 40301, message: '无效令牌' });
            }
            req.user = decoded; // 确保 req.user 正确赋值
            console.log('设置后 req.user:', req.user); // 新增日志，确认 req.user 内容
            next();
        }
    );
};




// 数据库连接检查
zuizhongPool.getConnection((err, connection) => {
    if (err) {
        console.error('【数据库连接】致命错误:', {
            code: err.code,
            errno: err.errno,
            sqlMessage: err.sqlMessage,
            stack: err.stack
        });
        process.exit(1);
    } else {
        console.log('【数据库连接】成功建立');
        connection.release();
    }
});


///////////////////////////////////////////////////
/////////////////////////////////
//////登录和注册
///////////////////////////////////
/////////////////////////////////////////////////////

// 用户认证相关路由
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ code: 40001, message: '账号密码不能为空' });
        }

        const [existing] = await zuizhongPool.execute(
            'SELECT id FROM user_info WHERE username = ?',
            [username]
        );

        if (existing.length > 0) {
            return res.status(409).json({ code: 40901, message: '用户已存在' });
        }

        await zuizhongPool.execute(
            'INSERT INTO user_info (username, password) VALUES (?, ?)',
            [username, password]
        );

        res.status(201).json({ code: 20101, message: '注册成功' });
    } catch (err) {
        console.error('【注册错误】:', {
            sql: err.sql,
            parameters: err.parameters,
            stack: err.stack
        });
        res.status(500).json({ code: 50002, message: '注册过程出错' });
    }
});


// 登录接口
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        // 验证用户名和密码是否为空
        if (!username || !password) {
            return res.status(400).json({ code: 40001, message: '账号密码不能为空' });
        }

        // 从数据库中查询用户信息，根据用户名和密码查询
        const [rows] = await zuizhongPool.execute(
            'SELECT id, username FROM user_info WHERE username =? AND password =?',
            [username, password]
        );
        const user = rows[0];

        // 检查用户是否存在
        if (!user) {
            return res.status(400).json({ code: 40002, message: '账号或密码错误' });
        }

        // 生成 JWT 令牌，包含 user_id 和 username
        const token = jwt.sign(
            { userId: user.id, username: user.username },
            process.env.JWT_SECRET || 'default-secret-key',
            { expiresIn: '1d' }
        );

        // 生成刷新 Token
        const refreshToken = jwt.sign(
            { userId: user.id, username: user.username },
            process.env.REFRESH_SECRET || 'your_refresh_secret',
            { expiresIn: '7d' }
        );

        // 返回成功响应和令牌
        res.json({ code: 20000, token, refreshToken });
    } catch (err) {
        console.error('【登录错误】:', err);
        res.status(500).json({ code: 50003, message: '登录过程出错' });
    }
});

app.get('/api/is_logged_in', authMiddleware, (req, res) => {
    res.json({
        code: 20000,
        loggedIn: true,
        user: {
            ...req.user,
            goal: req.user.goal === 'advanced' ? 7 : req.user.goal
        }
    });
});

// 学习功能相关路由
app.post('/api/set_last_level', authMiddleware, async (req, res) => {
    try {
        const { level } = req.body;
        if (!level) {
            return res.status(400).json({ code: 40003, message: '缺少等级字段' });
        }

        const targetLevel = level === 'advanced' ? 7 : parseInt(level, 10);
        await zuizhongPool.execute(
            'UPDATE user_info SET goal = ? WHERE id = ?',
            [targetLevel, req.user.userId]
        );
        res.json({ code: 20000, message: '等级设置成功' });
    } catch (err) {
        console.error('【等级设置错误】:', err);
        res.status(500).json({
            code: 50004,
            message: err.code === 'ER_BAD_FIELD_ERROR' ? '数据库表结构错误' : '服务器错误'
        });
    }
});


app.get('/api/favorites', authMiddleware, async (req, res) => {
    const user_id = req.user.userId;
    console.log(`[${new Date().toISOString()}] GET /api/favorites 请求到达，用户 ID: ${user_id}`);

    try {
        const conn = await zuizhongPool.getConnection();

        try {
            const [rows] = await conn.execute(
                `SELECT id, word, definition, example, relatedwords, word_level, added_at, pinyin 
                 FROM favorite_words 
                 WHERE user_id = ?`,
                [user_id]
            );

            console.log(`[数据库查询结果] 共查询到 ${rows.length} 条记录`);
            rows.forEach((row, index) => {
                console.log(`[第 ${index + 1} 条记录]`, row);
            });

            const parsedRows = rows.map((row, index) => {
                let relatedWordsArray = [];
                const rawRelatedWords = row.relatedwords;

                console.log(`[第 ${index + 1} 条记录 relatedwords 解析] 原始值:`, rawRelatedWords);

                if (Array.isArray(rawRelatedWords)) {
                    relatedWordsArray = rawRelatedWords;
                } else if (typeof rawRelatedWords === 'string') {
                    try {
                        // 严格解析 JSON 数组
                        relatedWordsArray = JSON.parse(rawRelatedWords);
                        console.log(`[第 ${index + 1} 条记录 relatedwords 解析] JSON 解析成功:`, relatedWordsArray);
                    } catch (e) {
                        console.log(`[第 ${index + 1} 条记录 relatedwords 解析] JSON 解析失败:`, e.message);
                        // 仅当 JSON 解析失败且是旧数据（逗号分隔）时，才 fallback 处理
                        if (rawRelatedWords.includes(',')) {
                            relatedWordsArray = rawRelatedWords
                                .split(',')
                                .map(word => word.trim())
                                .filter(word => word!== '');
                            console.log(`[第 ${index + 1} 条记录 relatedwords 解析] 逗号分隔字符串解析结果:`, relatedWordsArray);
                        }
                    }
                }

                let addedAt = row.added_at;
                if (typeof addedAt === 'string') {
                    addedAt = addedAt.split('T')[0]; // 统一时间格式为 YYYY-MM-DD
                } else {
                    addedAt = '';
                }

                return {
                    user_id: user_id,
                    id: row.id,
                    word: row.word,
                    definition: row.definition || '', // 处理数据库中的 null
                    example: row.example || '', // 处理数据库中的 null
                    relatedwords: relatedWordsArray,
                    word_level: row.word_level,
                    added_at: addedAt,
                    pinyin: row.pinyin || '' // 新增：返回拼音字段
                };
            });

            console.log(`[数据查询] 成功取得 ${parsedRows.length} 条收藏记录`);
            res.json(parsedRows);

        } finally {
            conn.release();
        }
    } catch (err) {
        console.error(`[${new Date().toISOString()}] 获取收藏数据失败:`, err);
        res.status(500).json({
            code: 50007,
            message: '获取收藏数据失败',
            error: process.env.NODE_ENV === 'development'? err.message : undefined
        });
    }
});

app.post('/api/favorites', authMiddleware, async (req, res) => {
    console.log('【后端日志】收到 POST /api/favorites 请求，开始处理');

    const { word, definition, example, relatedwords, word_level, pinyin } = req.body; // 新增：获取拼音字段
    const word_id = word;

    if (!word_id || !word_level) {
        console.log('【后端日志】缺少必要字段:', word_id, word_level);
        return res.status(400).json({ code: 40007, message: '缺少必要字段' });
    }

    const normalizedLevel = word_level === 'advanced'? 7 : Number(word_level);
    const user_id = req.user.userId;

    try {
        const conn = await zuizhongPool.getConnection();

        try {
            // 检查是否已收藏
            const [rows] = await conn.execute(
                'SELECT id FROM favorite_words WHERE user_id = ? AND word = ?',
                [user_id, word_id]
            );

            if (rows.length > 0) {
                // 已收藏，执行删除
                await conn.execute(
                    'DELETE FROM favorite_words WHERE user_id = ? AND word = ?',
                    [user_id, word_id]
                );
                console.log('【后端日志】取消收藏成功');
                res.json({ code: 20000, added: false });
            } else {
                // 确保 relatedwords 是数组（前端需传递数组，而非字符串）
                const validRelatedWords = Array.isArray(relatedwords)? relatedwords : [];
                // 存入正确的 JSON 数组字符串（不带外层引号）
                const relatedWordsJson = JSON.stringify(validRelatedWords);

                await conn.execute(
                    `INSERT INTO favorite_words (user_id, word, definition, example, relatedwords, word_level, added_at, pinyin)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        user_id,
                        word,
                        definition || null, // 允许 definition 为 null
                        example || null, // 允许 example 为 null
                        relatedWordsJson, // 正确的 JSON 数组字符串
                        normalizedLevel,
                        new Date().toISOString().split('T')[0], // YYYY-MM-DD
                        pinyin || null // 新增：插入拼音字段
                    ]
                );

                console.log('【后端日志】添加收藏成功');
                res.json({
                    code: 20000,
                    message: '收藏添加成功',
                    data: {
                        user_id: user_id,
                        word: word,
                        definition: definition || '', // 前端显示时处理 null
                        example: example || '', // 前端显示时处理 null
                        relatedwords: validRelatedWords, // 直接返回数组，无需再次字符串化
                        word_level: normalizedLevel,
                        added_at: new Date().toISOString().split('T')[0],
                        pinyin: pinyin || '' // 新增：返回拼音字段
                    }
                });
            }
        } finally {
            conn.release();
        }
    } catch (err) {
        console.error('【收藏操作错误】:', err);
        res.status(500).json({ code: 50006, message: '收藏操作失败' });
    }
});    



////加了拼音的收藏
app.post('/api/favorites_add', authMiddleware, async (req, res) => {
    if (process.env.NODE_ENV === 'development') {
        console.log('【后端日志】收到 POST /api/favorites_add 请求', {
            timestamp: new Date().toISOString(),
            requestBody: req.body,
            userId: req.user?.userId || '未认证用户'
        });
    } else {
        console.log('【后端日志】收到 POST /api/favorites_add 请求，用户ID:', req.user?.userId || '未认证用户');
    }

    const { 
        word,
        word_level,
        definition,
        example,
        relatedwords,
        pinyin // 新增：获取拼音字段
    } = req.body;

    const missingRequiredFields = [];
    if (!word || typeof word !== 'string' || word.trim().length === 0) {
        missingRequiredFields.push('word');
    }
    if (word_level === undefined || word_level === null) {
        missingRequiredFields.push('word_level');
    }
    if (!pinyin || typeof pinyin!== 'string' || pinyin.trim().length === 0) { // 新增：检查拼音字段
        missingRequiredFields.push('pinyin');
    }

    if (missingRequiredFields.length > 0) {
        const errorMessage = `缺少必要字段: ${missingRequiredFields.join(', ')}`;
        console.error('【后端错误】', errorMessage);
        return res.status(400).json({
            code: 40007,
            message: '缺少必要字段',
            details: errorMessage
        });
    }

    let normalizedLevel;
    try {
        if (word_level === 'advanced') {
            normalizedLevel = 7;
        } else {
            normalizedLevel = Number(word_level);
            if (isNaN(normalizedLevel) || normalizedLevel < 1 || normalizedLevel > 9) {
                throw new Error('无效的级别参数，必须为1 - 9的数字或"advanced"');
            }
        }
    } catch (e) {
        console.error('【后端错误】级别参数无效', e.message);
        return res.status(400).json({
            code: 40008,
            message: '无效的级别参数',
            details: e.message
        });
    }

    const user_id = req.user?.userId;
    if (!user_id) {
        console.error('【后端错误】用户未认证');
        return res.status(401).json({
            code: 40101,
            message: '用户未认证'
        });
    }

    try {
        const conn = await zuizhongPool.getConnection();
        try {
            const [existingRows] = await conn.execute(
                'SELECT id FROM favorite_words WHERE user_id = ? AND word = ?',
                [user_id, word]
            );

            if (existingRows.length > 0) {
                console.log('【后端日志】单词已收藏，用户ID:', user_id, '单词:', word);
                return res.status(409).json({
                    code: 40907,
                    message: '该单词已收藏'
                });
            }

            const insertData = {
                user_id,
                word,
                definition: definition || null,
                example: example || null,
                relatedwords: relatedwords || [],
                word_level: normalizedLevel,
                added_at: formatDateToMySQL(new Date()),
                pinyin // 新增：添加拼音字段
            };

            // 安全处理 relatedwords
            if (typeof relatedwords === 'string') {
                try {
                    insertData.relatedwords = JSON.parse(relatedwords);
                } catch (e) {
                    console.warn('⚠️ relatedwords 字段格式错误，已回退为空数组');
                    insertData.relatedwords = [];
                }
            } else if (!Array.isArray(relatedwords)) {
                insertData.relatedwords = [];
            }

            // 确保存储为正确的 JSON 数组字符串
            insertData.relatedwords = JSON.stringify(insertData.relatedwords);

            const [insertResult] = await conn.execute(
                `INSERT INTO favorite_words 
                 (user_id, word, definition, example, relatedwords, word_level, added_at, pinyin)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, // 新增：插入语句添加拼音字段
                [
                    insertData.user_id,
                    insertData.word,
                    insertData.definition,
                    insertData.example,
                    insertData.relatedwords,
                    insertData.word_level,
                    insertData.added_at,
                    insertData.pinyin // 新增：插入值添加拼音字段
                ]
            );

            console.log('【后端日志】收藏添加成功，用户ID:', user_id, '单词:', word);
            return res.status(201).json({
                code: 20000,
                message: '收藏添加成功',
                data: {
                    id: insertResult.insertId,
                    ...insertData,
                    added_at: insertData.added_at.split(' ')[0],
                    // 返回给前端时将 relatedwords 解析为数组
                    relatedwords: JSON.parse(insertData.relatedwords)
                }
            });

        } finally {
            conn.release();
        }
    } catch (dbError) {
        console.error('【数据库错误】收藏添加失败', dbError);
        return res.status(500).json({
            code: 50006,
            message: '收藏操作失败',
            details: process.env.NODE_ENV === 'development' ? dbError.message : '服务器内部错误'
        });
    }
});

// 定义 formatDateToMySQL 函数
function formatDateToMySQL(date) {
    return date.toISOString().slice(0, 19).replace('T', ' ');
}

// 删除收藏的接口
app.delete('/api/favorites_delete/:word', authMiddleware, async (req, res) => {
    const wordToDelete = req.params.word;
    const user_id = req.user.userId;

    try {
        const conn = await zuizhongPool.getConnection();

        try {
            const [result] = await conn.execute(
                'DELETE FROM favorite_words WHERE user_id = ? AND word = ?',
                [user_id, wordToDelete]
            );

            if (result.affectedRows > 0) {
                console.log(`【删除成功】用户 ${user_id} 删除了单词 '${wordToDelete}'`);
                res.status(200).json({ message: '删除成功' });
            } else {
                console.log(`【删除失败】用户 ${user_id} 要删除的单词 '${wordToDelete}' 不存在`);
                res.status(404).json({ message: '该单词未被收藏，无法删除' });
            }
        } finally {
            conn.release();
        }
    } catch (error) {
        console.error('【数据库错误】删除收藏时出错:', error);
        res.status(500).json({ message: '删除收藏时出现错误', error: error.message });
    }
});





// 验证令牌接口
app.get('/api/validate-token', authMiddleware, (req, res) => {
    res.status(200).json({ valid: true });
});


/////////////////////////////////////////////////////
////////////////////////////////////////////////////
////////////////////////////////////////////





////////////////词汇测试部分/////////////


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////


// 存储当前等级的变量
let currentLevel = 4;



// 按等级去重的题目ID集合
const usedQuestionIdsMap = new Map();

// 改成：Map<userId_Level, Set<id>>
function getUsedQuestionIds(userId, level) {
    const key = `${userId}_${level}`;
    if (!usedQuestionIdsMap.has(key)) {
        usedQuestionIdsMap.set(key, new Set());
    }
    return usedQuestionIdsMap.get(key);
}

// 安全解析 options 字段🆗
function safeParseOptions(raw) {
    try {
        if (typeof raw === 'string') {
            return JSON.parse(raw);
        }
        return Array.isArray(raw) ? raw : [];
    } catch (err) {
        console.warn('⚠️ options 解析失败，原始值:', raw);
        return [];
    }
}
// 洗牌函数🆗
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

// 处理阅读题数量不一致的问题 - 保持阅读材料独立
function getStandardizedReadingQuestions(data, currentLevel, userId) {
    console.log(`尝试获取等级 ${currentLevel} 的标准化阅读题, 用户ID: ${userId}`);
    const currentLevelData = data.levels.find(level => level.level === currentLevel);
    if (!currentLevelData) {
        console.error(`等级 ${currentLevel} 的题库不存在`);
        throw new Error(`等级 ${currentLevel} 的题库不存在`);
    }

    // 获取当前等级所有未使用过的阅读题
    const readingQuestions = currentLevelData.questions
      .filter(q => q.type === 'reading' && !getUsedQuestionIds(userId, currentLevel).has(q.id));

    if (readingQuestions.length === 0) {
        console.warn(`等级 ${currentLevel} 无可用阅读题，无法继续评估`);
        throw new Error(`等级 ${currentLevel} 无可用阅读题，请联系管理员补充题库`);
    }

    // 随机排序阅读题
    shuffleArray(readingQuestions);

    // 计算所有阅读题中小题的总数
    const totalSubQuestions = readingQuestions.reduce((total, reading) => 
        total + (reading.questions || []).length, 0);

    // 检查是否有足够的小题
    if (totalSubQuestions < 3) {
        console.error(`等级 ${currentLevel} 的阅读题小题总数不足3个，无法进行评估`);
        throw new Error(`等级 ${currentLevel} 的阅读题小题总数不足，请联系管理员补充题库`);
    }

    // 目标：选择多个阅读题，使小题总数恰好为3
    let selectedReadings = [];
    let subQuestionCount = 0;

    // 按照小题数量从大到小排序，尽量减少需要选择的阅读题数量
    readingQuestions.sort((a, b) => 
        (b.questions || []).length - (a.questions || []).length);

    // 为了达到恰好3个小题，我们需要选择一些阅读题
    for (const reading of readingQuestions) {
        if (subQuestionCount >= 3) break;

        const questions = reading.questions || [];
        if (questions.length === 0) continue;

        // 复制一份阅读题，避免修改原始数据
        const readingCopy = structuredClone(reading);
        // 新增拼音字段复制
        readingCopy.content_pinyin = reading.content_pinyin;

        // 标记为已使用
        getUsedQuestionIds(userId, currentLevel).add(reading.id);

        // 如果添加这个阅读题会超过3个小题，我们需要裁剪
        if (subQuestionCount + questions.length > 3) {
            // 只取需要的小题数量
            const neededCount = 3 - subQuestionCount;
            readingCopy.questions = questions.slice(0, neededCount);
            console.log(`从阅读题 ${reading.id} 取 ${neededCount} 个小题`);
            selectedReadings.push(readingCopy);
            subQuestionCount += neededCount;
        } else {
            // 整个阅读题都可以使用
            console.log(`使用完整阅读题 ${reading.id}，包含 ${questions.length} 个小题`);
            selectedReadings.push(readingCopy);
            subQuestionCount += questions.length;
        }
    }

    console.log(`成功选择 ${selectedReadings.length} 个阅读题，总共包含 ${subQuestionCount} 个小题`);
    return selectedReadings;
}    


// 获取指定等级的已用题目集合
async function fetchQuestionDataFromDB() {
    const conn = await zuizhongPool.getConnection();
    try {
        const [singleRows] = await conn.query(
            'SELECT id, level, question, options, answer, question_pinyin, option_pinyin FROM single_choice_question'
        );

        const [readingContents] = await conn.query(
            'SELECT id AS content_id, level, content, content_pinyin FROM reading_content'
        );

        const contentIds = readingContents.map(c => c.content_id);
        const [readingQuestions] = contentIds.length > 0
            ? await conn.query(
                'SELECT id, content_id, question, options, answer, question_pinyin, option_pinyin FROM reading_question WHERE content_id IN (?)',
                [contentIds]
            )
            : [[]];

        const levelsMap = {};

        for (const row of singleRows) {
            const level = parseInt(row.level);
            if (!levelsMap[level]) {
                levelsMap[level] = { level, questions: [] };
            }

            levelsMap[level].questions.push({
                id: `single_${row.id}`,
                type: 'single',
                question: row.question,
                question_pinyin: row.question_pinyin,
                options: safeParseOptions(row.options),
                option_pinyin: safeParseOptions(row.option_pinyin),
                answer: row.answer
            });
        }

        for (const content of readingContents) {
            const level = parseInt(content.level);
            const subQuestions = readingQuestions
              .filter(q => q.content_id === content.content_id)
              .map(q => ({
                    id: `reading_sub_${q.id}`,
                    question: q.question,
                    question_pinyin: q.question_pinyin,
                    options: safeParseOptions(q.options),
                    option_pinyin: safeParseOptions(q.option_pinyin),
                    answer: q.answer
                }));

            if (!levelsMap[level]) {
                levelsMap[level] = { level, questions: [] };
            }

            if (subQuestions.length > 0) {
                levelsMap[level].questions.push({
                    id: `reading_${content.content_id}`,
                    type: 'reading',
                    reading_content: content.content,
                    content_pinyin: content.content_pinyin,
                    questions: subQuestions
                });
            }
        }

        return {
            levels: Object.values(levelsMap).sort((a, b) => a.level - b.level)
        };
    } finally {
        conn.release();
    }
}



// 等级计算逻辑
function calculateLevel(currentLevel, stage1Score = 0, stage2Score = 0, currentStage) {
    let newLevel = currentLevel;

    if (currentStage === '1') 
    {
        if (stage1Score >= 5) 
        { // 阶段1升级条件
            newLevel = Math.min(currentLevel + 1, 7);
        } 
        else if (stage1Score <= 2) 
        { // 阶段1降级条件
            newLevel = Math.max(currentLevel - 1, 1);
        }
    } 
    else if (currentStage === '2') 
    {
        if (stage2Score >= 5) 
        { // 降低阶段2升级门槛到5分
            newLevel = Math.min(currentLevel + 1, 7);
        } else if (stage2Score <= 3) 
        { // 保持阶段2降级条件
            newLevel = Math.max(currentLevel - 1, 1);
        }
    }

    return newLevel;
}
//
function getStageQuestions(data, stage, currentLevel, userId) {
    if (stage === '1') {
        return getStage1Questions(data, currentLevel, userId); // 📌 currentLevel已传递
    } else if (stage === '2') {
        return getStage2Questions(data, currentLevel, userId); // 📌 currentLevel已传递
    }
    console.error(`未知阶段: ${stage}`);
    throw new Error(`Unknown stage: ${stage}`);
}
// // 获取阶段1的题目（按等级去重）🆗
// // 修改后的格式化题目函数 - 保留答案信息
// // 修改后的格式化题目函数 - 保留答案信息并完整生成带等级的图片路径
// // 修改后的格式化题目函数 - 处理阅读材料和选项的数字转图片路径


// 修改后的格式化题目函数 - 处理阅读材料和选项的数字转图片路径
function formatQuestions(questions, currentLevel) {
    return questions.map(question => {
        if (question.type === 'reading') {
            // 📐 处理阅读材料的数字转图片路径
            const readingContent = /^\d+(\.(jpg|png))?$/.test(question.reading_content) 
                ? `shuaishuai/${currentLevel}/${question.reading_content.replace(/^(\d+)$/, '$1.jpg')}` 
                : question.reading_content;

            return {
                id: question.id,
                type: question.type,
                reading_content: readingContent, // 📐 替换为带等级的图片路径
                content_pinyin: question.content_pinyin,
                questions: question.questions.map(subQuestion => {
                    // 处理阅读题小题的选项图片路径
                    const newOptions = subQuestion.options.map(option => {
                        if (/^\d+(\.(jpg|png))?$/.test(option)) {
                            return `shuaishuai/${currentLevel}/${option.replace(/^(\d+)$/, '$1.jpg')}`;
                        }
                        return option;
                    });
                    return {
                        id: subQuestion.id,
                        question: subQuestion.question,
                        question_pinyin: subQuestion.question_pinyin,
                        options: newOptions,
                        option_pinyin: subQuestion.option_pinyin,
                        answer: subQuestion.answer
                    };
                })
            };
        } else if (question.type === 'single') {
            // 处理单选题的选项图片路径
            const newOptions = question.options.map(option => {
                if (/^\d+(\.(jpg|png))?$/.test(option)) {
                    return `shuaishuai/${currentLevel}/${option.replace(/^(\d+)$/, '$1.jpg')}`;
                }
                return option;
            });
            return {
                id: question.id,
                type: question.type,
                question: question.question,
                question_pinyin: question.question_pinyin,
                options: newOptions,
                option_pinyin: question.option_pinyin,
                answer: question.answer
            };
        }
        return question;
    });
}    

// 修改后的获取阶段1题目函数
// 修改后的获取阶段1题目函数
// 获取阶段1的题目（按等级去重） - 完整传递currentLevel参数
function getStage1Questions(data, currentLevel, userId) {
    console.log(`尝试获取阶段1、等级 ${currentLevel} 的题目`);
    const currentLevelData = data.levels.find(level => level.level === currentLevel);
    if (!currentLevelData) {
        console.error(`等级 ${currentLevel} 的题库不存在`);
        throw new Error(`等级 ${currentLevel} 的题库不存在`);
    }

    const singleQuestions = currentLevelData.questions
        .filter(q => q.type === 'single' && !getUsedQuestionIds(userId, currentLevel).has(q.id));
    shuffleArray(singleQuestions);

    let selectedSingle;
    if (singleQuestions.length < 3) {
        console.error(`等级 ${currentLevel} 的单选题不足3道（去重后）`);
        throw new Error(`等级 ${currentLevel} 的单选题不足3道`);
    }
    selectedSingle = singleQuestions.slice(0, 3);
    selectedSingle.forEach(q => getUsedQuestionIds(userId, currentLevel).add(q.id));

    let selectedReading = [];
    if (currentLevel >= 1) {
        selectedReading = getStandardizedReadingQuestions(data, currentLevel, userId);
    } else {
        console.warn(`等级 ${currentLevel} 不包含阅读题（已跳过）`);
    }
    return formatQuestions([...selectedSingle, ...selectedReading], currentLevel); 
}


// 获取阶段2的题目 - 完整传递currentLevel参数
function getStage2Questions(data, currentLevel, userId) {
    console.log(`尝试获取阶段2、等级 ${currentLevel} 的题目`);
    const currentLevelData = data.levels.find(level => level.level === currentLevel);
    if (!currentLevelData) {
        console.error(`等级 ${currentLevel} 的题库不存在`);
        throw new Error(`等级 ${currentLevel} 的题库不存在`);
    }

    const singleQuestions = currentLevelData.questions
        .filter(q => q.type === 'single' && !getUsedQuestionIds(userId, currentLevel).has(q.id));
    shuffleArray(singleQuestions);

    let selectedSingle;
    if (singleQuestions.length < 3) {
        console.error(`等级 ${currentLevel} 的单选题不足3道（去重后）`);
        throw new Error(`等级 ${currentLevel} 的单选题不足3道`);
    }
    selectedSingle = singleQuestions.slice(0, 3);
    selectedSingle.forEach(q => getUsedQuestionIds(userId, currentLevel).add(q.id));

    let selectedReading = [];
    if (currentLevel >= 1) {
        selectedReading = getStandardizedReadingQuestions(data, currentLevel, userId);
    } else {
        console.warn(`等级 ${currentLevel} 不包含阅读题（已跳过）`);
    }
    return formatQuestions([...selectedSingle, ...selectedReading], currentLevel); 
}


// 计算得分stage1🆗
function calculateStage1Score(answers) {
    return answers.filter(answer => answer.isCorrect).length;
}
// 计算得分stage2🆗
// 修改阶段2分数计算逻辑，确保多个阅读材料的计分正确
function calculateStage2Score(answers, questions) {
    let score = 0;
    
    // 将问题按类型分组
    const singleQuestions = questions.filter(q => q.type === 'single');
    const readingQuestions = questions.filter(q => q.type === 'reading');
    
    // 分别处理单选题和阅读题
    for (let i = 0; i < singleQuestions.length; i++) {
        const answer = answers[i];
        if (answer?.isCorrect) {
            score += 1;
        }
    }
    
    // 阅读题起始索引
    let readingStartIndex = singleQuestions.length;
    
    // 处理所有阅读题
    for (let i = 0; i < readingQuestions.length; i++) {
        const reading = readingQuestions[i];
        const answer = answers[readingStartIndex + i];
        
        if (!reading || !answer) continue;
        
        const subQuestions = reading.questions || [];
        const subAnswers = answer.questions || [];
        
        // 处理每个阅读小题
        for (let j = 0; j < Math.min(subQuestions.length, subAnswers.length); j++) {
            if (subAnswers[j]?.isCorrect) {
                score += 2;
            }
        }
    }
    
    return score;
}
// 模拟等级评估🆗
const mockAssessment = (level) => {
    const levels = [
        '初等一级', '初等二级', '初等三级',
        '中等四级', '中等五级', '中等六级',
        '高等'
    ];
    return { level: levels[level - 1] || "未知等级" };
};
//🆗
//////////
//////
// 自适应评估接口
// 自适应评估接口
app.get('/api/exam/adaptive-assessment', authMiddleware, async (req, res) => {
    console.log('收到 /api/exam/adaptive-assessment 请求');
    try {
        const { 
            mode = 'ai',  // 确保这里正确解构了mode参数
            stage = '1', 
            attempt = '1', 
            answers, 
            currentLevel = '4', 
            consecutiveStagnant = '0',
            initialLevel = '4',
            highestLevel = '4'
        } = req.query;
        
        const userId = req.user.userId;
        const source = mode === 'real' ? 'hsk' : 'ai';  // 使用解构的mode变量
        const data = await fetchQuestionDataFromDB(source);
        let parsedAnswers = [];

        try {
            parsedAnswers = answers ? JSON.parse(answers) : [];
        } catch (parseError) {
            console.error('解析答案时出错:', parseError);
            return res.status(400).json({ message: 'Invalid answers format' });
        }

        let level = parseInt(currentLevel);
        const userInitialLevel = parseInt(initialLevel || currentLevel);
        let userHighestLevel = parseInt(highestLevel || currentLevel);
        let nextStage = stage;
        let nextAttempt = parseInt(attempt);
        let stagnantCount = parseInt(consecutiveStagnant);
        let shouldTerminate = false;

        // 第一次请求，没有提供答案，返回初始题目
        if (parsedAnswers.length === 0) {
            const questions = getStageQuestions(data, '1', level, userId);
            return res.status(200).json({
                questions,
                currentLevel: level,
                nextStage: '1',
                nextAttempt: 1,
                consecutiveStagnant: 0,
                assessmentComplete: false,
                initialLevel: level,
                highestLevel: level
            });
        }

        const levelData = data.levels.find(l => l.level === level);
        if (!levelData) {
            return res.status(404).json({ message: '当前等级题目不存在' });
        }

        // 根据当前阶段计算分数和下一步操作
        if (nextStage === '1') {
            const stage1Score = calculateStage1Score(parsedAnswers);
            console.log(`阶段1得分: ${stage1Score}/6`);
            
            const previousLevel = level;
            level = calculateLevel(level, stage1Score, 0, '1');
            
            // 更新用户达到的最高等级
            if (level > userHighestLevel) {
                userHighestLevel = level;
            }
            
            // 修改阶段1逻辑
            if (stage1Score >= 5 || stage1Score <= 2) {
                // 如果分数符合升/降级标准，直接进入阶段2
                nextStage = '2';
                nextAttempt = 1;
            } else {
                // 分数在3-4之间，继续阶段1
                nextStage = '1';
                nextAttempt++;
                
                // 如果阶段1尝试次数超过2次且分数仍在中间区域，直接进入阶段2
                if (nextAttempt > 2) {
                    nextStage = '2';
                    nextAttempt = 1;
                }
            }
        } else if (nextStage === '2') {
            const stage2Score = calculateStage2Score(parsedAnswers, levelData.questions);
            console.log(`阶段2得分: ${stage2Score}分`);
            
            const previousLevel = level;
            level = calculateLevel(level, 0, stage2Score, '2');
            
            // 更新用户达到的最高等级
            if (level > userHighestLevel) {
                userHighestLevel = level;
            }

            // 检查是否有等级变化
            if (level !== previousLevel) {
                // 等级发生变化，重置停滞计数
                stagnantCount = 0;
            } else {
                // 等级未变化，增加停滞计数
                stagnantCount++;
            }
            
            nextAttempt++;
            
            // 确定是否结束评估的条件
            // 1. 如果用户连续两次在同一等级停滞，并且已经回到或超过初始等级
            if (stagnantCount >= 2 && level >= userInitialLevel) {
                shouldTerminate = true;
            }
            // 2. 如果用户已经达到了比初始等级更高的等级，并且现在降级了但仍不低于初始等级
            else if (userHighestLevel > userInitialLevel && level < userHighestLevel && level >= userInitialLevel) {
                shouldTerminate = true;
            }
            // 3. 如果用户当前等级低于初始等级，但是表现很好（得分高）
            else if (level < userInitialLevel && stage2Score >= 5) {
                // 给用户机会回到更高等级，不急于结束测评
                stagnantCount = 0;  // 重置停滞计数，继续评估
            }
            // 4. 尝试次数过多
            else if (nextAttempt > 3) {
                shouldTerminate = true;
            }
        }

        // 判断是否结束评估
        if (shouldTerminate) {
            // 如果用户最终等级低于初始等级但曾经达到过更高等级，考虑使用更公平的评估结果
            if (level < userInitialLevel && userHighestLevel >= userInitialLevel) {
                console.log(`用户从初始等级${userInitialLevel}降到了${level}，但曾达到过${userHighestLevel}，使用更公平的等级评估`);
                // 可以使用初始等级和最高等级的平均值，或者其他更合理的计算方式
                level = Math.max(level, Math.floor((userInitialLevel + userHighestLevel) / 2));
            }
            
            return res.status(200).json({
                assessmentComplete: true,
                currentLevel: level,
                questions: [],
                initialLevel: userInitialLevel,
                highestLevel: userHighestLevel
            });
        }

        // 获取下一阶段题目
        const questions = getStageQuestions(data, nextStage, level, userId); // 📌 level即currentLevel

        return res.status(200).json({
            questions,
            currentLevel: level,
            nextStage,
            nextAttempt,
            consecutiveStagnant: stagnantCount,
            assessmentComplete: false,
            initialLevel: userInitialLevel,
            highestLevel: userHighestLevel
        });
    } catch (error) {
        console.error('自适应评估接口错误:', error);
        res.status(500).json({ message: 'Adaptive assessment service error', error: error.message });
    }
});

// 评估结果接口🆗
app.post('/api/assess-level', authMiddleware, async (req, res) => {
    console.log('收到 /api/assess-level 请求');
    try {
        const { currentLevel } = req.body;
        if (!currentLevel) {
            console.error('缺少 currentLevel 参数');
            return res.status(400).json({
                message: '缺少 currentLevel 参数',
                code: 40001
            });
        }
        const assessment = mockAssessment(currentLevel);
        console.log('成功评估等级，返回结果');
        res.status(200).json({ level: assessment.level, assessmentComplete: true });
    } catch (error) {
        console.error('评估接口错误:', error);
        res.status(500).json({
            message: '评估服务异常',
            error: error.message
        });
    }
});

// 处理重新测试通知的路由
app.post('/api/exam/retry', authMiddleware, (req, res) => {
    try {
        const { mode, previousLevel } = req.body;
        // 从请求中获取 userId，这里假设从认证信息里获取
        const userId = req.user.userId; 

        // 清空7个等级的已用题目 ID
        for (let level = 1; level <= 7; level++) {
            const usedIds = getUsedQuestionIds(userId, level);
            usedIds.clear();
        }

        res.status(200).json({ message: '重试通知处理成功，7个等级的已用题目 ID 已清空' });
    } catch (err) {
        console.error('重试通知处理失败:', err);
        res.status(500).json({ message: '重试通知处理失败' });
    }
});


//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/////词汇查询部分

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// 知识图谱相关代码
let relationshipData = [];
let vocabularyData = [];

async function loadJson(filePath) {
    try {
        const data = await fs.promises.readFile(path.join(__dirname, filePath), 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        console.error(`Failed to load JSON file "${filePath}":`, error);
        return [];
    }
}

async function loadRelationshipData() {
    const cachedData = myCache.get('relationshipData');
    if (cachedData) {
        relationshipData = cachedData;
        return;
    }
    relationshipData = await loadJson('data.json');
    myCache.set('relationshipData', relationshipData);
}

async function loadVocabularyData() {
    const cachedData = myCache.get('vocabularyData');
    if (cachedData) {
        vocabularyData = cachedData;
        return;
    }
    vocabularyData = await loadJson('vocabulary.json');
    myCache.set('vocabularyData', vocabularyData);
}

function isPinyinChar(c) {
    return /^[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]$/i.test(c);
}

function extractPinyinPos(text) {
    const parts = text.trim().split(' ', 2);
    if (parts.length < 2) return [parts[0], null];

    const remaining = parts[1];
    let pinyinEnd = 0;

    while (pinyinEnd < remaining.length && isPinyinChar(remaining[pinyinEnd])) {
        pinyinEnd++;
    }

    return [
        remaining.substring(0, pinyinEnd),
        remaining.substring(pinyinEnd).trim() || null
    ];
}



// 假设的查找相关三元组的函数
const findRelatedTriples = async (word) => {
    const { data, status } = await getSingleWordKnowledgeGraph(word);
    // 仅当状态正常且存在三元组数据时，提取每个三元组的最后一个元素（object）
    if (status === 200 && Array.isArray(data?.triples)) {
        return data.triples.map(triple => triple[2]); // 提取第三个元素（obj）
    }
    return []; // 无数据或错误时返回空数组
};

//苏新皓保佑我好吗？？？
////////////////////////////////


//苏新皓
async function findRelationshipBetweenWords(word1, word2) {
    try {
        const [rows] = await zuizhongPool.execute(
            `SELECT subject, relation, object 
             FROM knowledge_graph 
             WHERE (subject = ? AND object = ?) 
                OR (subject = ? AND object = ?)`,
            [word1, word2, word2, word1]
        );

        // 如果没有任何关系，返回 null
        if (!rows || rows.length === 0) {
            return null;
        }

        // 如果存在正向关系，优先返回
        const direct = rows.find(row => row.subject === word1 && row.object === word2);
        if (direct) {
            return `${word2} 是 ${word1} 的 ${direct.relation}`;
        }

        // 否则返回反向关系
        const reverse = rows.find(row => row.subject === word2 && row.object === word1);
        if (reverse) {
            return `${word1} 是 ${word2} 的 ${reverse.relation}`;
        }

        // 没找到合适的关系（理论上不会走到这里）
        return null;
    } catch (error) {
        console.error(`数据库查询出错:`, error);
        return null;
    }
}








/////////////////////////////////////
////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////
//开始学习最终版
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////
////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//低等级判断不同格式输出
////////////////////////////////////////////////////////////////////////



// 假设 imageDirectory 已经定义
// const imageDirectory = 'your_image_directory_path';

app.get('/api/word-image/:word', (req, res) => {
    // 解码中文参数
    const word = decodeURIComponent(req.params.word);

    // 尝试查找 .jpg、.png 和 .webp 格式的图片
    const imageFormats = ['.jpg', '.png', '.webp'];
    let imagePath = null;

    for (const format of imageFormats) {
        const currentPath = path.join(imageDirectory, word.replace(/-/g, '/') + format);
        if (fs.existsSync(currentPath)) {
            imagePath = currentPath;
            break;
        }
    }

    if (imagePath) {
        res.sendFile(imagePath);
    } else {
        // 若找不到，返回默认图片或 404
        const fallback = path.join(imageDirectory, '1.jpg');
        if (fs.existsSync(fallback)) {
            res.sendFile(fallback);
        } else {
            res.status(404).json({ error: "Word image not found" });
        }
    }
});    


///////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////
//初等背单词学习法
// 获取初等单词的接口
// 获取词组类型
// 定义 getWordGroupType 函数，用于获取词组类型信息
// 获取词组类型
// 获取词组类型的改进函数
// const getWordGroupType = async (level, userId) => {
//     console.log('🔍 [getWordGroupType] 开始执行');
//     console.log('📋 传入参数:');
//     console.log('   - level:', level);
//     console.log('   - userId:', userId);

//     // 验证 level 有效性（初等单词仅支持 1 - 3 级）
//     if (![1, 2, 3].includes(level)) {
//         console.error('❌ [getWordGroupType] 无效的等级参数');
//         return { 
//             status: 400, 
//             data: { error: "Elementary words only support levels 1 - 3" } 
//         };
//     }

//     // 验证 userId
//     if (userId === undefined || userId === null) {
//         console.error('❌ [getWordGroupType] userId 参数无效');
//         return { 
//             status: 400, 
//             data: { error: "userId parameter is undefined or null" } 
//         };
//     }

//     const tableName = `word_list_level_${level}`;
    
//     try {
//         // 详细日志：查询所有词族
//         console.log(`🔬 开始查询 ${tableName} 中的所有词族`);
//         const [typesResult] = await zuizhongPool.execute(`
//             SELECT DISTINCT word_family 
//             FROM \`${tableName}\`
//         `);

//         console.log('📊 查询到的词族:');
//         typesResult.forEach((type, index) => {
//             console.log(`   - 词族 ${index + 1}: ${type.word_family === null ? 'NULL' : type.word_family}`);
//         });

//         // 如果没有词族，返回特定状态
//         if (typesResult.length === 0) {
//             console.warn('⚠️ 没有找到任何词族');
//             return {
//                 status: 204,
//                 data: { 
//                     message: '该等级没有任何词族',
//                     hasMore: false 
//                 }
//             };
//         }

//         // 优先处理非 null 词族
//         const nullTypes = [];
//         const nonNullTypes = [];

//         typesResult.forEach(row => {
//             if (row.word_family === null) {
//                 nullTypes.push(row.word_family);
//             } else {
//                 nonNullTypes.push(row.word_family);
//             }
//         });

//         console.log('📝 词族分类:');
//         console.log('   - 非 NULL 词族:', nonNullTypes);
//         console.log('   - NULL 词族:', nullTypes);

//         // 优先使用非 null 类型
//         const availableTypes = nonNullTypes.length > 0 ? nonNullTypes : nullTypes;
        
//         console.log('🔢 可用词族数量:', availableTypes.length);

//         // 查找未完全学习的词族
//         let currentType = null;
//         let typeIndex = 0;

//         console.log('🕵️ 开始检查每个词族的学习状态');
//         for (let i = 0; i < availableTypes.length; i++) {
//             const type = availableTypes[i];
            
//             // 详细查询未学习单词的逻辑
//             const [unlearnedCountResult] = await zuizhongPool.execute(`
//                 SELECT COUNT(*) AS count 
//                 FROM \`${tableName}\` wl
//                 LEFT JOIN learned_words lw ON wl.word = lw.word AND lw.user_id = ?
//                 WHERE wl.word_family ${type === null ? 'IS NULL' : '= ?'}
//                 AND (lw.word IS NULL OR lw.already_known = 0)
//             `, type === null ? [userId] : [userId, type]);

//             const unlearnedCount = unlearnedCountResult[0].count;

//             console.log(`🧐 词族 ${type === null ? 'NULL' : type}:`);
//             console.log(`   - 未学习单词数: ${unlearnedCount}`);

//             if (unlearnedCount > 0) {
//                 currentType = type;
//                 typeIndex = i;
//                 break;
//             }
//         }

//         // 如果所有词族都已完全学习，则使用第一个词族
//         if (currentType === null) {
//             console.warn('⚠️ 所有词族都已完全学习，将使用第一个词族');
//             currentType = availableTypes[0];
//             typeIndex = 0;
//         }

//         console.log('📌 最终选择的词族:');
//         console.log(`   - 词族: ${currentType === null ? 'NULL' : currentType}`);
//         console.log(`   - 索引: ${typeIndex}`);

//         // 查询当前词族未完全掌握的单词数量
//         const [countResult] = await zuizhongPool.execute(`
//             SELECT COUNT(*) AS count 
//             FROM \`${tableName}\` wl
//             LEFT JOIN learned_words lw ON wl.word = lw.word AND lw.user_id = ?
//             WHERE wl.word_family ${currentType === null ? 'IS NULL' : '= ?'}
//             AND (lw.word IS NULL OR lw.already_known = 0)
//         `, currentType === null ? [userId] : [userId, currentType]);

//         const totalUnlearnedWordsInType = countResult[0].count;

//         console.log('📈 词族详细信息:');
//         console.log(`   - 未学习单词总数: ${totalUnlearnedWordsInType}`);

//         return {
//             status: 200,
//             data: {
//                 groupType: {
//                     currentType,
//                     typeIndex,
//                     totalTypes: availableTypes.length,
//                     totalUnlearnedWordsInType,
//                     availableTypes: availableTypes
//                 },
//                 hasMore: totalUnlearnedWordsInType > 0
//             }
//         };

//     } catch (error) {
//         console.error('❌ [getWordGroupType] 数据库查询出错:', error);
//         return { 
//             status: 500, 
//             data: { 
//                 error: '服务器内部错误',
//                 details: error.message 
//             } 
//         };
//     }
// };

////////////////////////////believe me/////////////////////////////////////
const getWordGroupType = async (level, userId) => {
    console.log('🔍 [getWordGroupType] 开始执行');
    console.log('📋 传入参数:');
    console.log('   - level:', level);
    console.log('   - userId:', userId);

    // 验证 level 有效性（初等单词仅支持 1 - 3 级）
    if (![1, 2, 3].includes(level)) {
        console.error('❌ [getWordGroupType] 无效的等级参数');
        return { 
            status: 400, 
            data: { error: "Elementary words only support levels 1 - 3" } 
        };
    }

    // 验证 userId
    if (userId === undefined || userId === null) {
        console.error('❌ [getWordGroupType] userId 参数无效');
        return { 
            status: 400, 
            data: { error: "userId parameter is undefined or null" } 
        };
    }

    const tableName = `word_list_level_${level}`;
    
    try {
        // 详细日志：查询所有词族
        console.log(`🔬 开始查询 ${tableName} 中的所有词族`);
        const [typesResult] = await zuizhongPool.execute(`
            SELECT DISTINCT word_family 
            FROM \`${tableName}\`
        `);

        console.log('📊 查询到的词族:');
        typesResult.forEach((type, index) => {
            console.log(`   - 词族 ${index + 1}: ${type.word_family === null ? 'NULL' : type.word_family}`);
        });

        // 如果没有词族，返回特定状态
        if (typesResult.length === 0) {
            console.warn('⚠️ 没有找到任何词族');
            return {
                status: 204,
                data: { 
                    message: '该等级没有任何词族',
                    hasMore: false 
                }
            };
        }

        // 优先处理非 null 词族
        const nullTypes = [];
        const nonNullTypes = [];

        typesResult.forEach(row => {
            if (row.word_family === null) {
                nullTypes.push(row.word_family);
            } else {
                nonNullTypes.push(row.word_family);
            }
        });

        console.log('📝 词族分类:');
        console.log('   - 非 NULL 词族:', nonNullTypes);
        console.log('   - NULL 词族:', nullTypes);

        // 优先使用非 null 类型
        let availableTypes = nonNullTypes.length > 0 ? nonNullTypes : nullTypes;

        // 把 暂无分类 移动到列表最后
        const noCategoryIndex = availableTypes.indexOf('暂无分类');
        if (noCategoryIndex!== -1) {
            const noCategory = availableTypes.splice(noCategoryIndex, 1)[0];
            availableTypes.push(noCategory);
        }

        console.log('🔢 可用词族数量:', availableTypes.length);

        // 查找未完全学习的词族
        let currentType = null;
        let typeIndex = 0;

        console.log('🕵️ 开始检查每个词族的学习状态');
        for (let i = 0; i < availableTypes.length; i++) {
            const type = availableTypes[i];
            
            // 详细查询未学习单词的逻辑
            const [unlearnedCountResult] = await zuizhongPool.execute(`
                SELECT COUNT(*) AS count 
                FROM \`${tableName}\` wl
                LEFT JOIN learned_words lw ON wl.word = lw.word AND lw.user_id = ?
                WHERE wl.word_family ${type === null ? 'IS NULL' : '= ?'}
                AND (lw.word IS NULL OR lw.already_known = 0)
            `, type === null ? [userId] : [userId, type]);

            const unlearnedCount = unlearnedCountResult[0].count;

            console.log(`🧐 词族 ${type === null ? 'NULL' : type}:`);
            console.log(`   - 未学习单词数: ${unlearnedCount}`);

            if (unlearnedCount > 0) {
                currentType = type;
                typeIndex = i;
                break;
            }
        }

        // 如果所有词族都已完全学习，则使用第一个词族
        if (currentType === null) {
            console.warn('⚠️ 所有词族都已完全学习，将使用第一个词族');
            currentType = availableTypes[0];
            typeIndex = 0;
        }

        console.log('📌 最终选择的词族:');
        console.log(`   - 词族: ${currentType === null ? 'NULL' : currentType}`);
        console.log(`   - 索引: ${typeIndex}`);

        // 查询当前词族未完全掌握的单词数量
        const [countResult] = await zuizhongPool.execute(`
            SELECT COUNT(*) AS count 
            FROM \`${tableName}\` wl
            LEFT JOIN learned_words lw ON wl.word = lw.word AND lw.user_id = ?
            WHERE wl.word_family ${currentType === null ? 'IS NULL' : '= ?'}
            AND (lw.word IS NULL OR lw.already_known = 0)
        `, currentType === null ? [userId] : [userId, currentType]);

        const totalUnlearnedWordsInType = countResult[0].count;

        console.log('📈 词族详细信息:');
        console.log(`   - 未学习单词总数: ${totalUnlearnedWordsInType}`);

        return {
            status: 200,
            data: {
                groupType: {
                    currentType,
                    typeIndex,
                    totalTypes: availableTypes.length,
                    totalUnlearnedWordsInType,
                    availableTypes: availableTypes
                },
                hasMore: totalUnlearnedWordsInType > 0
            }
        };

    } catch (error) {
        console.error('❌ [getWordGroupType] 数据库查询出错:', error);
        return { 
            status: 500, 
            data: { 
                error: '服务器内部错误',
                details: error.message 
            } 
        };
    }
};      

/////////////////////////////////'believe me////////////



// app.get('/api/elementary-words', authMiddleware, async (req, res) => {
//     console.log('🌟 [请求到达] /api/elementary-words');
//     console.log('📋 查询参数:', req.query);

//     const { level, type } = req.query;
//     const userId = Number(req.user?.userId);

//     console.log('🔍 解析参数:');
//     console.log('   - level:', level);
//     console.log('   - type:', type);
//     console.log('   - userId:', userId);

//     // 验证参数
//     if (!level || !["1", "2", "3"].includes(level)) {
//         console.error('❌ 无效的 level 参数');
//         return res.status(400).json({ error: "Invalid level parameter" });
//     }

//     if (isNaN(userId)) {
//         console.error('❌ 无效的 userId 参数');
//         return res.status(400).json({ error: "Invalid userId parameter" });
//     }

//     const actualLevel = Number(level);

//     try {
//         console.log(' 开始获取词组类型');
//         const { status, data } = await getWordGroupType(actualLevel, userId);

//         console.log(' 词组类型查询结果:');
//         console.log('   - 状态码:', status);
//         console.log('   - 数据:', JSON.stringify(data, null, 2));

//         if (status === 204) {
//             console.warn(' 所有词族已完全掌握');
//             return res.status(204).json({
//                 message: '该等级的所有词族已完全掌握',
//                 hasMore: false
//             });
//         }

//         if (status !== 200) {
//             console.error('❌ 获取词组类型失败');
//             return res.status(status).json(data);
//         }

//         const currentType = data.groupType.currentType;
//         const wordTable = `word_list_level_${actualLevel}`;
//         const classTable = `word_class_level_${actualLevel}`;
//         const definitionTable = `word_definition_level_${actualLevel}`;

//         console.log(' 首先查询当前词族中未完全掌握的单词');
//         const [unmastered] = await zuizhongPool.execute(`
//             SELECT wl.id, wl.word, wl.pinyin, wl.sentence, wl.sentence_pinyin 
//             FROM \`${wordTable}\` wl
//             LEFT JOIN learned_words lw ON wl.word = lw.word AND lw.user_id = ?
//             WHERE wl.word_family ${currentType === null ? 'IS NULL' : '= ?'}
//             AND (lw.word IS NULL OR lw.already_known = 0 OR lw.no_need_to_back = 0)
//             LIMIT 30
//         `, currentType === null ? [userId] : [userId, currentType]);

//         // 如果有未完全掌握的单词，优先返回这些
//         if (unmastered.length > 0) {
//             console.log(` 发现 ${unmastered.length} 个未完全掌握的单词，优先返回这些`);
//             const result = [];
//             for (const wordData of unmastered) {
//                 const { id: wordId, word, pinyin, sentence, sentence_pinyin } = wordData;

//                 // 查询单词类别
//                 const [classes] = await zuizhongPool.execute(
//                     `SELECT id, class FROM \`${classTable}\` WHERE word_id = ?`,
//                     [wordId]
//                 );

//                 if (!classes.length) continue; // 无类别则跳过

//                 // 获取相关词
//                 const relatedwords = await findRelatedTriples(word);

//                 const entries = [];
//                 for (const cls of classes) {
//                     // 查询单词定义
//                     const [defs] = await zuizhongPool.execute(
//                         `SELECT definition FROM \`${definitionTable}\` WHERE word_class_id = ?`,
//                         [cls.id]
//                     );
//                     entries.push({
//                         part_of_speech: "名词",
//                         definition: defs.map(d => d.definition).join("; "),
//                         pinyin: cls.class
//                     });
//                 }

//                 result.push({
//                     wordid: String(wordId),
//                     word,
//                     pinyin,
//                     entries,
//                     example: sentence || "暂无例句",
//                     examplePinyin: sentence_pinyin || "",
//                     total_type_words: unmastered.length,
//                     current_word_type: currentType,
//                     relatedwords
//                 });
//             }

//             console.log(` 返回 ${result.length} 个未完全掌握的单词`);
//             return res.json({
//                 words: result,
//                 groupType: data.groupType,
//                 hasMore: true,
//                 isReviewing: true // 标记这是在复习未掌握的单词
//             });
//         }

//         // 如果没有未掌握的单词，检查是否有下一个词族
//         console.log(' 当前词族所有单词已掌握，查找下一个词族');
//         if (data.groupType.typeIndex < data.groupType.totalTypes - 1) {
//             // 有下一个词族，获取下一个词族的单词
//             const nextTypeIndex = data.groupType.typeIndex + 1;
//             const nextType = data.groupType.availableTypes[nextTypeIndex];

//             console.log(` 切换到下一个词族: ${nextType}`);

//             // 获取新词族的未掌握单词
//             const [newTypeWords] = await zuizhongPool.execute(`
//                 SELECT wl.id, wl.word, wl.pinyin, wl.sentence, wl.sentence_pinyin 
//                 FROM \`${wordTable}\` wl
//                 LEFT JOIN learned_words lw ON wl.word = lw.word AND lw.user_id = ?
//                 WHERE wl.word_family ${nextType === null ? 'IS NULL' : '= ?'}
//                 AND (lw.word IS NULL OR lw.already_known = 0)
//                 LIMIT 30
//             `, nextType === null ? [userId] : [userId, nextType]);

//             if (newTypeWords.length === 0) {
//                 console.log(` 下一个词族 ${nextType} 没有可学习的单词`);
//                 return res.status(204).json({
//                     message: '没有更多可学习的单词',
//                     hasMore: false,
//                     needNextType: true,
//                     nextTypeIndex: nextTypeIndex
//                 });
//             }

//             // 更新词族信息
//             const updatedGroupType = {
//                 ...data.groupType,
//                 currentType: nextType,
//                 typeIndex: nextTypeIndex
//             };

//             const result = [];
//             for (const wordData of newTypeWords) {
//                 const { id: wordId, word, pinyin, sentence, sentence_pinyin } = wordData;

//                 // 查询单词类别
//                 const [classes] = await zuizhongPool.execute(
//                     `SELECT id, class FROM \`${classTable}\` WHERE word_id = ?`,
//                     [wordId]
//                 );

//                 if (!classes.length) continue; // 无类别则跳过

//                 // 获取相关词
//                 const relatedwords = await findRelatedTriples(word);

//                 const entries = [];
//                 for (const cls of classes) {
//                     // 查询单词定义
//                     const [defs] = await zuizhongPool.execute(
//                         `SELECT definition FROM \`${definitionTable}\` WHERE word_class_id = ?`,
//                         [cls.id]
//                     );
//                     entries.push({
//                         part_of_speech: "名词",
//                         definition: defs.map(d => d.definition).join("; "),
//                         pinyin: cls.class
//                     });
//                 }

//                 result.push({
//                     wordid: String(wordId),
//                     word,
//                     pinyin,
//                     entries,
//                     example: sentence || "",
//                     examplePinyin: sentence_pinyin || "",
//                     total_type_words: newTypeWords.length,
//                     current_word_type: nextType,
//                     relatedwords
//                 });
//             }

//             console.log(`🔄 返回下一个词族的 ${result.length} 个单词`);
//             return res.json({
//                 words: result,
//                 groupType: updatedGroupType,
//                 hasMore: true,
//                 isNewType: true // 标记这是新词族的单词
//             });
//         }

//         // 如果没有下一个词族，返回所有词族已学完的信息
//         console.log('📊 所有词族都已学完');
//         return res.json({
//             message: '该等级的所有词族已学完',
//             hasMore: false,
//             words: [],
//             groupType: data.groupType
//         });

//     } catch (err) {
//         console.error('❌ [处理 1 - 3 级] 数据库查询出错:', err);
//         return res.status(500).json({
//             error: "查询词数据时出错",
//             details: err.message
//         });
//     }
// });

//////////////////////////believe me///////////////////
// app.get('/api/elementary-words', authMiddleware, async (req, res) => {
//     console.log('🌟 [请求到达] /api/elementary - words');
//     console.log('📋 查询参数:', req.query);

//     const { level, type } = req.query;
//     const userId = Number(req.user?.userId);

//     console.log('🔍 解析参数:');
//     console.log('   - level:', level);
//     console.log('   - type:', type);
//     console.log('   - userId:', userId);

//     // 验证参数
//     if (!level ||!["1", "2", "3"].includes(level)) {
//         console.error('❌ 无效的 level 参数');
//         return res.status(400).json({ error: "Invalid level parameter" });
//     }

//     if (isNaN(userId)) {
//         console.error('❌ 无效的 userId 参数');
//         return res.status(400).json({ error: "Invalid userId parameter" });
//     }

//     const actualLevel = Number(level);

//     try {
//         console.log(' 开始获取词组类型');
//         const { status, data } = await getWordGroupType(actualLevel, userId);

//         console.log(' 词组类型查询结果:');
//         console.log('   - 状态码:', status);
//         console.log('   - 数据:', JSON.stringify(data, null, 2));

//         if (status === 204) {
//             console.warn(' 所有词族已完全掌握');
//             return res.status(204).json({
//                 message: '该等级的所有词族已完全掌握',
//                 hasMore: false
//             });
//         }

//         if (status!== 200) {
//             console.error('❌ 获取词组类型失败');
//             return res.status(status).json(data);
//         }

//         const currentType = data.groupType.currentType;
//         const wordTable = `word_list_level_${actualLevel}`;
//         const classTable = `word_class_level_${actualLevel}`;
//         const definitionTable = `word_definition_level_${actualLevel}`;

//         console.log(' 首先查询当前词族中未完全掌握的单词');
//         const [unmastered] = await zuizhongPool.execute(`
//             SELECT wl.id, wl.word, wl.pinyin, wl.sentence, wl.sentence_pinyin 
//             FROM \`${wordTable}\` wl
//             LEFT JOIN learned_words lw ON wl.word = lw.word AND lw.user_id =?
//             WHERE wl.word_family ${currentType === null? 'IS NULL' : '=?'}
//             AND (lw.word IS NULL OR lw.already_known = 0 OR lw.no_need_to_back = 0)
//             LIMIT 30
//         `, currentType === null? [userId] : [userId, currentType]);

//         if (unmastered.length > 0) {
//             console.log(` 发现 ${unmastered.length} 个未完全掌握的单词，优先返回这些`);
//             const result = [];
//             for (const wordData of unmastered) {
//                 const { id: wordId, word, pinyin, sentence, sentence_pinyin } = wordData;

//                 // 查询单词类别
//                 const [classes] = await zuizhongPool.execute(
//                     `SELECT id, class FROM \`${classTable}\` WHERE word_id =?`,
//                     [wordId]
//                 );

//                 if (!classes.length) continue; // 无类别则跳过

//                 // 获取相关词
//                 const relatedwords = await findRelatedTriples(word);

//                 const entries = [];
//                 for (const cls of classes) {
//                     // 查询单词定义
//                     const [defs] = await zuizhongPool.execute(
//                         `SELECT definition FROM \`${definitionTable}\` WHERE word_class_id =?`,
//                         [cls.id]
//                     );
//                     entries.push({
//                         part_of_speech: "名词",
//                         definition: defs.map(d => d.definition).join("; "),
//                         pinyin: cls.class
//                     });
//                 }

//                 let exampleSentences = [];
//                 // 先检查sentence是否为字符串类型
//                 if (typeof sentence ==='string') {
//                     const sentenceStr = sentence.trim();
//                     if (sentenceStr) {
//                         if (sentenceStr.includes(',')) {
//                             exampleSentences = sentenceStr.split(',').map(s => s.trim());
//                         } else {
//                             exampleSentences = [sentenceStr];
//                         }
//                     }
//                 } else {
//                     console.warn('sentence 不是字符串类型，使用默认例句', sentence);
//                     exampleSentences = ["暂无例句"];
//                 }
//                 console.log(`解析后的例句列表:`, exampleSentences);

//                 result.push({
//                     wordid: String(wordId),
//                     word,
//                     pinyin,
//                     entries,
//                     exampleSentences,
//                     examplePinyin: sentence_pinyin || "",
//                     total_type_words: unmastered.length,
//                     current_word_type: currentType,
//                     relatedwords
//                 });
//             }

//             console.log(` 返回 ${result.length} 个未完全掌握的单词`);
//             return res.json({
//                 words: result,
//                 groupType: data.groupType,
//                 hasMore: true,
//                 isReviewing: true // 标记这是在复习未掌握的单词
//             });
//         }

//         // 如果没有未掌握的单词，检查是否有下一个词族
//         console.log(' 当前词族所有单词已掌握，查找下一个词族');
//         if (data.groupType.typeIndex < data.groupType.totalTypes - 1) {
//             // 有下一个词族，获取下一个词族的单词
//             const nextTypeIndex = data.groupType.typeIndex + 1;
//             const nextType = data.groupType.availableTypes[nextTypeIndex];

//             console.log(` 切换到下一个词族: ${nextType}`);

//             // 获取新词族的未掌握单词
//             const [newTypeWords] = await zuizhongPool.execute(`
//                 SELECT wl.id, wl.word, wl.pinyin, wl.sentence, wl.sentence_pinyin 
//                 FROM \`${wordTable}\` wl
//                 LEFT JOIN learned_words lw ON wl.word = lw.word AND lw.user_id =?
//                 WHERE wl.word_family ${nextType === null? 'IS NULL' : '=?'}
//                 AND (lw.word IS NULL OR lw.already_known = 0)
//                 LIMIT 30
//             `, nextType === null? [userId] : [userId, nextType]);

//             if (newTypeWords.length === 0) {
//                 console.log(` 下一个词族 ${nextType} 没有可学习的单词`);
//                 return res.status(204).json({
//                     message: '没有更多可学习的单词',
//                     hasMore: false,
//                     needNextType: true,
//                     nextTypeIndex: nextTypeIndex
//                 });
//             }

//             // 更新词族信息
//             const updatedGroupType = {
//                ...data.groupType,
//                 currentType: nextType,
//                 typeIndex: nextTypeIndex
//             };

//             const result = [];
//             for (const wordData of newTypeWords) {
//                 const { id: wordId, word, pinyin, sentence, sentence_pinyin } = wordData;

//                 // 查询单词类别
//                 const [classes] = await zuizhongPool.execute(
//                     `SELECT id, class FROM \`${classTable}\` WHERE word_id =?`,
//                     [wordId]
//                 );

//                 if (!classes.length) continue; // 无类别则跳过

//                 // 获取相关词
//                 const relatedwords = await findRelatedTriples(word);

//                 const entries = [];
//                 for (const cls of classes) {
//                     // 查询单词定义
//                     const [defs] = await zuizhongPool.execute(
//                         `SELECT definition FROM \`${definitionTable}\` WHERE word_class_id =?`,
//                         [cls.id]
//                     );
//                     entries.push({
//                         part_of_speech: "名词",
//                         definition: defs.map(d => d.definition).join("; "),
//                         pinyin: cls.class
//                     });
//                 }

//                 let exampleSentences = [];
//                 // 先检查sentence是否为字符串类型
//                 if (typeof sentence ==='string') {
//                     const sentenceStr = sentence.trim();
//                     if (sentenceStr) {
//                         if (sentenceStr.includes(',')) {
//                             exampleSentences = sentenceStr.split(',').map(s => s.trim());
//                         } else {
//                             exampleSentences = [sentenceStr];
//                         }
//                     }
//                 } else {
//                     console.warn('sentence 不是字符串类型，使用默认例句', sentence);
//                     exampleSentences = ["暂无例句"];
//                 }
//                 console.log(`解析后的例句列表:`, exampleSentences);

//                 result.push({
//                     wordid: String(wordId),
//                     word,
//                     pinyin,
//                     entries,
//                     exampleSentences,
//                     examplePinyin: sentence_pinyin || "",
//                     total_type_words: newTypeWords.length,
//                     current_word_type: nextType,
//                     relatedwords
//                 });
//             }

//             console.log(`🔄 返回下一个词族的 ${result.length} 个单词`);
//             return res.json({
//                 words: result,
//                 groupType: updatedGroupType,
//                 hasMore: true,
//                 isNewType: true // 标记这是新词族的单词
//             });
//         }

//         // 如果没有下一个词族，返回所有词族已学完的信息
//         console.log('📊 所有词族都已学完');
//         return res.json({
//             message: '该等级的所有词族已学完',
//             hasMore: false,
//             words: [],
//             groupType: data.groupType
//         });

//     } catch (err) {
//         console.error('❌ [处理 1 - 3 级] 数据库查询出错:', err);
//         return res.status(500).json({
//             error: "查询词数据时出错",
//             details: err.message
//         });
//     }
// });
/////////////////////////////believe me///////////////

app.get('/api/elementary-words', authMiddleware, async (req, res) => {
    console.log('🌟 [请求到达] /api/elementary-words');
    console.log('📋 查询参数:', req.query);

    const { level, type } = req.query;
    const userId = Number(req.user?.userId);

    console.log('🔍 解析参数:');
    console.log('   - level:', level);
    console.log('   - type:', type);
    console.log('   - userId:', userId);

    // 验证参数
    if (!level || !["1", "2", "3"].includes(level)) {
        console.error('❌ 无效的 level 参数');
        return res.status(400).json({ error: "Invalid level parameter" });
    }

    if (isNaN(userId)) {
        console.error('❌ 无效的 userId 参数');
        return res.status(400).json({ error: "Invalid userId parameter" });
    }

    const actualLevel = Number(level);

    try {
        console.log(' 开始获取词组类型');
        const { status, data } = await getWordGroupType(actualLevel, userId);

        console.log(' 词组类型查询结果:');
        console.log('   - 状态码:', status);
        console.log('   - 数据:', JSON.stringify(data, null, 2));

        if (status === 204) {
            console.warn(' 所有词族已完全掌握');
            return res.status(204).json({
                message: '该等级的所有词族已完全掌握',
                hasMore: false
            });
        }

        if (status !== 200) {
            console.error('❌ 获取词组类型失败');
            return res.status(status).json(data);
        }

        const currentType = data.groupType.currentType;
        const wordTable = `word_list_level_${actualLevel}`;
        const classTable = `word_class_level_${actualLevel}`;
        const definitionTable = `word_definition_level_${actualLevel}`;

        console.log(' 首先查询当前词族中未完全掌握的单词');
        const [unmastered] = await zuizhongPool.execute(`
            SELECT wl.id, wl.word, wl.pinyin, wl.sentence, wl.sentence_pinyin 
            FROM \`${wordTable}\` wl
            LEFT JOIN learned_words lw ON wl.word = lw.word AND lw.user_id = ?
            WHERE wl.word_family ${currentType === null ? 'IS NULL' : '= ?'}
            AND (lw.word IS NULL OR lw.already_known = 0 OR lw.no_need_to_back = 0)
            LIMIT 30
        `, currentType === null ? [userId] : [userId, currentType]);

        if (unmastered.length > 0) {
            console.log(` 发现 ${unmastered.length} 个未完全掌握的单词，优先返回这些`);
            const result = [];
            for (const wordData of unmastered) {
                const { id: wordId, word, pinyin, sentence, sentence_pinyin } = wordData;

                // 查询单词类别
                const [classes] = await zuizhongPool.execute(
                    `SELECT id, class FROM \`${classTable}\` WHERE word_id = ?`,
                    [wordId]
                );

                if (!classes.length) continue; // 无类别则跳过

                // 获取相关词
                const relatedwords = await findRelatedTriples(word);

                const entries = [];
                for (const cls of classes) {
                    // 查询单词定义
                    const [defs] = await zuizhongPool.execute(
                        `SELECT definition FROM \`${definitionTable}\` WHERE word_class_id = ?`,
                        [cls.id]
                    );
                    entries.push({
                        part_of_speech: "名词",
                        definition: defs.map(d => d.definition).join("; "),
                        pinyin: cls.class
                    });
                }

                let example = [];
                // 兼容 sentence 为 JSON 字符串或数组的情况
                if (sentence) {
                    try {
                        // 处理字符串（解析为 JSON 数组）或直接使用数组
                        const sentences = typeof sentence === 'string' ? JSON.parse(sentence) : sentence;
                        if (Array.isArray(sentences)) {
                            example = sentences.map(s => s.trim()).filter(s => s); // 清理空格并过滤空字符串
                        }
                    } catch (error) {
                        console.error('解析例句失败:', error, '原始值:', sentence);
                        example = ["暂无例句"]; // 解析失败时使用默认值
                    }
                } else {
                    example = ["暂无例句"]; // sentence 为 null/undefined 时使用默认值
                }
                console.log(`解析后的例句列表:`, example);

                result.push({
                    wordid: String(wordId),
                    word,
                    pinyin,
                    entries,
                    example,
                    examplePinyin: sentence_pinyin || "",
                    total_type_words: unmastered.length,
                    current_word_type: currentType,
                    relatedwords
                });
            }

            console.log(` 返回 ${result.length} 个未完全掌握的单词`);
            return res.json({
                words: result,
                groupType: data.groupType,
                hasMore: true,
                isReviewing: true // 标记这是在复习未掌握的单词
            });
        }

        // 如果没有未掌握的单词，检查是否有下一个词族
        console.log(' 当前词族所有单词已掌握，查找下一个词族');
        if (data.groupType.typeIndex < data.groupType.totalTypes - 1) {
            // 有下一个词族，获取下一个词族的单词
            const nextTypeIndex = data.groupType.typeIndex + 1;
            const nextType = data.groupType.availableTypes[nextTypeIndex];

            console.log(` 切换到下一个词族: ${nextType}`);

            // 获取新词族的未掌握单词
            const [newTypeWords] = await zuizhongPool.execute(`
                SELECT wl.id, wl.word, wl.pinyin, wl.sentence, wl.sentence_pinyin 
                FROM \`${wordTable}\` wl
                LEFT JOIN learned_words lw ON wl.word = lw.word AND lw.user_id = ?
                WHERE wl.word_family ${nextType === null ? 'IS NULL' : '= ?'}
                AND (lw.word IS NULL OR lw.already_known = 0)
                LIMIT 30
            `, nextType === null ? [userId] : [userId, nextType]);

            if (newTypeWords.length === 0) {
                console.log(` 下一个词族 ${nextType} 没有可学习的单词`);
                return res.status(204).json({
                    message: '没有更多可学习的单词',
                    hasMore: false,
                    needNextType: true,
                    nextTypeIndex: nextTypeIndex
                });
            }

            // 更新词族信息
            const updatedGroupType = {
                ...data.groupType,
                currentType: nextType,
                typeIndex: nextTypeIndex
            };

            const result = [];
            for (const wordData of newTypeWords) {
                const { id: wordId, word, pinyin, sentence, sentence_pinyin } = wordData;

                // 查询单词类别
                const [classes] = await zuizhongPool.execute(
                    `SELECT id, class FROM \`${classTable}\` WHERE word_id = ?`,
                    [wordId]
                );

                if (!classes.length) continue; // 无类别则跳过

                // 获取相关词
                const relatedwords = await findRelatedTriples(word);

                const entries = [];
                for (const cls of classes) {
                    // 查询单词定义
                    const [defs] = await zuizhongPool.execute(
                        `SELECT definition FROM \`${definitionTable}\` WHERE word_class_id = ?`,
                        [cls.id]
                    );
                    entries.push({
                        part_of_speech: "名词",
                        definition: defs.map(d => d.definition).join("; "),
                        pinyin: cls.class
                    });
                }

                let example = [];
                // 兼容 sentence 为 JSON 字符串或数组的情况
                if (sentence) {
                    try {
                        const sentences = typeof sentence === 'string' ? JSON.parse(sentence) : sentence;
                        if (Array.isArray(sentences)) {
                            example = sentences.map(s => s.trim()).filter(s => s);
                        }
                    } catch (error) {
                        console.error('解析例句失败:', error, '原始值:', sentence);
                        example = ["暂无例句"];
                    }
                } else {
                    example = ["暂无例句"];
                }
                console.log(`解析后的例句列表:`, example);

                result.push({
                    wordid: String(wordId),
                    word,
                    pinyin,
                    entries,
                    example,
                    examplePinyin: sentence_pinyin || "",
                    total_type_words: newTypeWords.length,
                    current_word_type: nextType,
                    relatedwords
                });
            }

            console.log(`🔄 返回下一个词族的 ${result.length} 个单词`);
            return res.json({
                words: result,
                groupType: updatedGroupType,
                hasMore: true,
                isNewType: true // 标记这是新词族的单词
            });
        }

        // 如果没有下一个词族，返回所有词族已学完的信息
        console.log('📊 所有词族都已学完');
        return res.json({
            message: '该等级的所有词族已学完',
            hasMore: false,
            words: [],
            groupType: data.groupType
        });

    } catch (err) {
        console.error('❌ [处理 1 - 3 级] 数据库查询出错:', err);
        return res.status(500).json({
            error: "查询词数据时出错",
            details: err.message
        });
    }
});




// /////////////////////////////////////////////////
// ///////////////////这是不背单词是形式///////////////////////////////
// ////////////////////////////////////////////////////////


// 获取高等单词的接口



// ////随机取单词
// app.get('/api/advanced-words', authMiddleware, async (req, res) => {
//     console.log('[请求到达] /api/advanced-words 请求到达，查询参数:', req.query);
//     res.setHeader('Content-Type', 'application/json; charset=utf-8');

//     const levelMap = { "7-9": "7" };
//     const { level, type, groupSize } = req.query;
//     const userId = parseInt(req.user?.userId);

//     console.log('[参数解析] level:', level, 'type:', type, 'userId:', userId, 'groupSize:', groupSize);

//     if (!level ||!["1", "2", "3", "4", "5", "6", "7-9"].includes(level)) {
//         console.log('[参数错误] 无效的 level 参数:', level);
//         return res.status(400).json({ error: "Invalid level parameter" });
//     }

//     if (isNaN(userId)) {
//         console.log('[参数错误] 无效的 userId 参数:', req.query.userId);
//         return res.status(400).json({ error: "Invalid userId parameter" });
//     }

//     const actualLevel = levelMap[level] || level;
//     console.log('[参数转换] 实际 level:', actualLevel);

//     if (["1", "2", "3"].includes(level)) {
//         console.log('[等级错误] 高等单词接口不支持 1 - 3 级');
//         return res.status(400).json({ error: "高等单词接口不支持 1 - 3 级" });
//     }

//     let connection;
//     try {
//         connection = await zuizhongPool.getConnection();
//         if (!connection || typeof connection.execute!== 'function') {
//             console.error('获取的数据库连接对象无效:', connection);
//             return res.status(500).json({ error: "Invalid database connection" });
//         }

//         // 首先尝试查找已经开始学习但尚未完全掌握的单词
//         console.log('[查询策略] 首先查找已开始学习但未完全掌握的单词');
//         const [partiallyLearnedWords] = await connection.execute(
//             `SELECT w.id, w.word 
//              FROM word_list_level_${actualLevel} w
//              JOIN learned_words lw ON w.word = lw.word AND lw.user_id = ?
//              WHERE (lw.already_known = 0 OR lw.no_need_to_back = 0)
//              ORDER BY RAND()
//              LIMIT ${parseInt(groupSize || 30)}`,
//             [userId]
//         );
        
//         console.log(`[查询结果] 找到 ${partiallyLearnedWords.length} 个部分掌握的单词`);
        
//         // 如果有部分掌握的单词，直接返回这些单词
//         if (partiallyLearnedWords.length > 0) {
//             const result = await buildWordData(connection, partiallyLearnedWords, actualLevel, level, userId);
//             console.log('[处理单词] 返回部分掌握的单词数据，数量:', result.length);
//             return res.json(result);
//         }
        
//         // 如果没有部分掌握的单词，则获取全新的单词
//         console.log('[查询策略] 没有部分掌握的单词，查找全新单词');
//         const [learnedWords] = await connection.execute(
//             `SELECT word FROM learned_words 
//              WHERE user_id = ?`,  // 获取所有学过的单词，无论掌握程度
//             [userId]
//         );
//         const learnedWordStr = learnedWords.map(wordData => `'${wordData.word}'`).join(',');
        
//         let limitClause = groupSize ? `LIMIT ${parseInt(groupSize)}` : 'LIMIT 30';
//         const wordListSql = `SELECT id, word FROM word_list_level_${actualLevel} 
//                               WHERE word NOT IN (${learnedWordStr.length ? learnedWordStr : "''"}) 
//                               ORDER BY RAND() ${limitClause}`;
        
//         console.log('[查询新单词] SQL:', wordListSql);
//         const [newWords] = await connection.execute(wordListSql);
//         console.log('[查询结果] 找到 ' + newWords.length + ' 个新单词');

//         if (newWords.length === 0) {
//             console.log('[查询结果] 该等级的单词列表为空');
//             return res.status(404).json({ error: "Word list for this level is empty" });
//         }

//         const result = await buildWordData(connection, newWords, actualLevel, level, userId);
//         console.log('[处理单词] 返回新单词数据，数量:', result.length);
//         return res.json(result);
//     } catch (error) {
//         console.error('[数据库操作失败] 错误信息:', error);
//         return res.status(500).json({ error: "Database query exception" });
//     } finally {
//         if (connection) {
//             console.log('[处理其他等级] 释放数据库连接');
//             connection.release();
//         }
//     }
// });


// // 公共函数：构建单词数据
// async function buildWordData(connection, words, actualLevel, level, userId) {
//     if (!connection || typeof connection.execute!== 'function') {
//         console.error('传入的数据库连接对象无效:', connection);
//         throw new Error('Invalid database connection');
//     }

//     const result = [];
//     for (const wordData of words) {
//         const { id: wordId, word } = wordData;
//         let formattedExamples = "暂无例句";
//         const classTable = `word_class_level_${actualLevel}`;
//         const [classes] = await connection.execute(
//             `SELECT id, class FROM ${classTable} WHERE word_id =?`,
//             [wordId]
//         );

//         if (!classes.length) {
//             console.log('[处理其他等级] 单词', word, '没有分类信息，跳过');
//             continue;
//         }

//         const pinyinList = classes.map(c => c.class);
//         const entries = [];
//         const definitionTable = `word_definition_level_${actualLevel}`;

//         for (const cls of classes) {
//             const [defs] = await connection.execute(
//                 `SELECT definition FROM ${definitionTable} WHERE word_class_id =?`,
//                 [cls.id]
//             );
//             entries.push({
//                 pinyin: cls.class,
//                 part_of_speech: "",
//                 definition: defs.map(d => d.definition).join('; ')
//             });
//         }

//         const relatedTriples = await findRelatedTriples(word);
//         const relatedwords = relatedTriples.map(triple => triple[2]);

//         result.push({
//             word,
//             level,
//             pinyin: pinyinList,
//             word_id: wordId,
//             example: formattedExamples,
//             entries,
//             relatedwords
//         });
//     }
//     return result;
// }


////////////////////////believe me////////////////

// 随机取单词
// app.get('/api/advanced-words', authMiddleware, async (req, res) => {
//     console.log('[请求到达] /api/advanced-words 请求到达，查询参数:', req.query);
//     res.setHeader('Content-Type', 'application/json; charset=utf-8');

//     const levelMap = { "7-9": "7" };
//     const { level, type, groupSize } = req.query;
//     const userId = parseInt(req.user?.userId);

//     console.log('[参数解析] level:', level, 'type:', type, 'userId:', userId, 'groupSize:', groupSize);

//     if (!level ||!["1", "2", "3", "4", "5", "6", "7-9"].includes(level)) {
//         console.log('[参数错误] 无效的 level 参数:', level);
//         return res.status(400).json({ error: "Invalid level parameter" });
//     }

//     if (isNaN(userId)) {
//         console.log('[参数错误] 无效的 userId 参数:', req.query.userId);
//         return res.status(400).json({ error: "Invalid userId parameter" });
//     }

//     const actualLevel = levelMap[level] || level;
//     console.log('[参数转换] 实际 level:', actualLevel);

//     if (["1", "2", "3"].includes(level)) {
//         console.log('[等级错误] 高等单词接口不支持 1 - 3 级');
//         return res.status(400).json({ error: "高等单词接口不支持 1 - 3 级" });
//     }

//     let connection;
//     try {
//         connection = await zuizhongPool.getConnection();
//         if (!connection || typeof connection.execute!== 'function') {
//             console.error('获取的数据库连接对象无效:', connection);
//             return res.status(500).json({ error: "Invalid database connection" });
//         }

//         // 首先尝试查找已经开始学习但尚未完全掌握的单词
//         console.log('[查询策略] 首先查找已开始学习但未完全掌握的单词');
//         const [partiallyLearnedWords] = await connection.execute(
//             `SELECT w.id, w.word, w.sentence 
//              FROM word_list_level_${actualLevel} w
//              JOIN learned_words lw ON w.word = lw.word AND lw.user_id = ?
//              JOIN knowledge_graph kg ON w.word = kg.subject
//              WHERE (lw.already_known = 0 OR lw.no_need_to_back = 0) AND w.sentence IS NOT NULL
//              ORDER BY RAND()
//              LIMIT ${parseInt(groupSize || 30)}`,
//             [userId]
//         );

//         console.log(`[查询结果] 找到 ${partiallyLearnedWords.length} 个部分掌握的单词`);

//         // 如果有部分掌握的单词，直接返回这些单词
//         if (partiallyLearnedWords.length > 0) {
//             const result = await buildWordData(connection, partiallyLearnedWords, actualLevel, level, userId);
//             console.log('[处理单词] 返回部分掌握的单词数据，数量:', result.length);
//             return res.json(result);
//         }

//         // 如果没有部分掌握的单词，则获取全新的单词
//         console.log('[查询策略] 没有部分掌握的单词，查找全新单词');
//         const [learnedWords] = await connection.execute(
//             `SELECT word FROM learned_words 
//              WHERE user_id = ?`,  // 获取所有学过的单词，无论掌握程度
//             [userId]
//         );
//         const learnedWordStr = learnedWords.map(wordData => `'${wordData.word}'`).join(',');

//         let limitClause = groupSize ? `LIMIT ${parseInt(groupSize)}` : 'LIMIT 30';
//         const wordListSql = `SELECT w.id, w.word, w.sentence 
//                              FROM word_list_level_${actualLevel} w
//                              JOIN knowledge_graph kg ON w.word = kg.subject
//                              WHERE w.word NOT IN (${learnedWordStr.length ? learnedWordStr : "''"}) AND w.sentence IS NOT NULL
//                              ORDER BY RAND() ${limitClause}`;

//         console.log('[查询新单词] SQL:', wordListSql);
//         const [newWords] = await connection.execute(wordListSql);
//         console.log('[查询结果] 找到 ' + newWords.length + ' 个新单词');

//         if (newWords.length === 0) {
//             console.log('[查询结果] 该等级的单词列表为空');
//             return res.status(404).json({ error: "Word list for this level is empty" });
//         }

//         const result = await buildWordData(connection, newWords, actualLevel, level, userId);
//         console.log('[处理单词] 返回新单词数据，数量:', result.length);
//         return res.json(result);
//     } catch (error) {
//         console.error('[数据库操作失败] 错误信息:', error);
//         return res.status(500).json({ error: "Database query exception" });
//     } finally {
//         if (connection) {
//             console.log('[处理其他等级] 释放数据库连接');
//             connection.release();
//         }
//     }
// });


// // 公共函数：构建单词数据
// async function buildWordData(connection, words, actualLevel, level, userId) {
//     if (!connection || typeof connection.execute!== 'function') {
//         console.error('传入的数据库连接对象无效:', connection);
//         throw new Error('Invalid database connection');
//     }

//     const result = [];
//     for (const wordData of words) {
//         const { id: wordId, word, sentence } = wordData;
//         let formattedExamples = sentence || "暂无例句";
//         const classTable = `word_class_level_${actualLevel}`;
//         const [classes] = await connection.execute(
//             `SELECT id, class FROM ${classTable} WHERE word_id =?`,
//             [wordId]
//         );

//         if (!classes.length) {
//             console.log('[处理其他等级] 单词', word, '没有分类信息，跳过');
//             continue;
//         }

//         const pinyinList = classes.map(c => c.class);
//         const entries = [];
//         const definitionTable = `word_definition_level_${actualLevel}`;

//         for (const cls of classes) {
//             const [defs] = await connection.execute(
//                 `SELECT definition FROM ${definitionTable} WHERE word_class_id =?`,
//                 [cls.id]
//             );
//             entries.push({
//                 pinyin: cls.class,
//                 part_of_speech: "",
//                 definition: defs.map(d => d.definition).join('; ')
//             });
//         }

//         // 获取相关三元组（数据库层已过滤同素词并限制36条）
//         const relatedTriples = await findRelatedTriples(word);
//         const relatedwords = relatedTriples.map(triple => triple[2]); // 直接映射，无需切片

//         result.push({
//             word,
//             level,
//             pinyin: pinyinList,
//             word_id: wordId,
//             example: formattedExamples,
//             entries,
//             relatedwords
//         });
//     }
//     return result;
// }

////////////////////////believe me////////////////

// app.get('/api/advanced-words', authMiddleware, async (req, res) => {
//     console.log('[请求到达] /api/advanced-words 请求到达，查询参数:', req.query);
//     res.setHeader('Content-Type', 'application/json; charset=utf-8');

//     const levelMap = { "7-9": "7" };
//     const { level, type, groupSize } = req.query;
//     const userId = parseInt(req.user?.userId);

//     console.log('[参数解析] level:', level, 'type:', type, 'userId:', userId, 'groupSize:', groupSize);

//     if (!level ||!["1", "2", "3", "4", "5", "6", "7-9"].includes(level)) {
//         console.log('[参数错误] 无效的 level 参数:', level);
//         return res.status(400).json({ error: "Invalid level parameter" });
//     }

//     if (isNaN(userId)) {
//         console.log('[参数错误] 无效的 userId 参数:', req.query.userId);
//         return res.status(400).json({ error: "Invalid userId parameter" });
//     }

//     const actualLevel = levelMap[level] || level;
//     console.log('[参数转换] 实际 level:', actualLevel);

//     if (["1", "2", "3"].includes(level)) {
//         console.log('[等级错误] 高等单词接口不支持 1 - 3 级');
//         return res.status(400).json({ error: "高等单词接口不支持 1 - 3 级" });
//     }

//     let connection;
//     try {
//         connection = await zuizhongPool.getConnection();
//         if (!connection || typeof connection.execute!== 'function') {
//             console.error('获取的数据库连接对象无效:', connection);
//             return res.status(500).json({ error: "Invalid database connection" });
//         }

//         // 首先尝试查找已经开始学习但尚未完全掌握的单词
//         console.log('[查询策略] 首先查找已开始学习但未完全掌握的单词');
//         const [partiallyLearnedWords] = await connection.execute(
//             `SELECT w.id, w.word, w.sentence 
//              FROM word_list_level_${actualLevel} w
//              JOIN learned_words lw ON w.word = lw.word AND lw.user_id = ?
//              JOIN knowledge_graph kg ON w.word = kg.subject
//              WHERE (lw.already_known = 0 OR lw.no_need_to_back = 0) AND w.sentence IS NOT NULL
//              ORDER BY RAND()
//              LIMIT ${parseInt(groupSize || 30)}`,
//             [userId]
//         );

//         console.log(`[查询结果] 找到 ${partiallyLearnedWords.length} 个部分掌握的单词`);

//         // 如果有部分掌握的单词，直接返回这些单词
//         if (partiallyLearnedWords.length > 0) {
//             const result = await buildWordData(connection, partiallyLearnedWords, actualLevel, level, userId);
//             console.log('[处理单词] 返回部分掌握的单词数据，数量:', result.length);
//             return res.json(result);
//         }

//         // 如果没有部分掌握的单词，则获取全新的单词
//         console.log('[查询策略] 没有部分掌握的单词，查找全新单词');
//         const [learnedWords] = await connection.execute(
//             `SELECT word FROM learned_words 
//              WHERE user_id = ?`,  // 获取所有学过的单词，无论掌握程度
//             [userId]
//         );
//         const learnedWordStr = learnedWords.map(wordData => `'${wordData.word}'`).join(',');

//         let limitClause = groupSize ? `LIMIT ${parseInt(groupSize)}` : 'LIMIT 30';
//         const wordListSql = `SELECT w.id, w.word, w.sentence 
//                              FROM word_list_level_${actualLevel} w
//                              JOIN knowledge_graph kg ON w.word = kg.subject
//                              WHERE w.word NOT IN (${learnedWordStr.length ? learnedWordStr : "''"}) AND w.sentence IS NOT NULL
//                              ORDER BY RAND() ${limitClause}`;

//         console.log('[查询新单词] SQL:', wordListSql);
//         const [newWords] = await connection.execute(wordListSql);
//         console.log('[查询结果] 找到 ' + newWords.length + ' 个新单词');

//         if (newWords.length === 0) {
//             console.log('[查询结果] 该等级的单词列表为空');
//             return res.status(404).json({ error: "Word list for this level is empty" });
//         }

//         const result = await buildWordData(connection, newWords, actualLevel, level, userId);
//         console.log('[处理单词] 返回新单词数据，数量:', result.length);
//         return res.json(result);
//     } catch (error) {
//         console.error('[数据库操作失败] 错误信息:', error);
//         return res.status(500).json({ error: "Database query exception" });
//     } finally {
//         if (connection) {
//             console.log('[处理其他等级] 释放数据库连接');
//             connection.release();
//         }
//     }
// });


// // 公共函数：构建单词数据
// async function buildWordData(connection, words, actualLevel, level, userId) {
//     if (!connection || typeof connection.execute!== 'function') {
//         console.error('传入的数据库连接对象无效:', connection);
//         throw new Error('Invalid database connection');
//     }

//     const result = [];
//     for (const wordData of words) {
//         const { id: wordId, word, sentence } = wordData;
//         let formattedExamples = sentence || "暂无例句";
//         const classTable = `word_class_level_${actualLevel}`;
//         const [classes] = await connection.execute(
//             `SELECT id, class FROM ${classTable} WHERE word_id =?`,
//             [wordId]
//         );

//         if (!classes.length) {
//             console.log('[处理其他等级] 单词', word, '没有分类信息，跳过');
//             continue;
//         }

//         const pinyinList = classes.map(c => c.class);
//         const entries = [];
//         const definitionTable = `word_definition_level_${actualLevel}`;

//         for (const cls of classes) {
//             const [defs] = await connection.execute(
//                 `SELECT definition FROM ${definitionTable} WHERE word_class_id =?`,
//                 [cls.id]
//             );
//             entries.push({
//                 pinyin: cls.class,
//                 part_of_speech: "",
//                 definition: defs.map(d => d.definition).join('; ')
//             });
//         }

//         // 获取相关三元组（数据库层已过滤同素词并限制36条）
//         const relatedTriples = await findRelatedTriples(word);
//         const relatedwords = relatedTriples.map(triple => triple[2]); // 直接映射，无需切片

//         result.push({
//             word,
//             level,
//             pinyin: pinyinList,
//             word_id: wordId,
//             example: formattedExamples,
//             entries,
//             relatedwords
//         });
//     }
//     return result;
// }


app.get('/api/advanced-words', authMiddleware, async (req, res) => {
    console.log('[请求到达] /api/advanced-words 请求到达，查询参数:', req.query);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    const levelMap = { "7-9": "7" };
    const { level, type, groupSize } = req.query;
    const userId = parseInt(req.user?.userId);
    const requestedSize = parseInt(groupSize || 30);

    console.log('[参数解析] level:', level, 'type:', type, 'userId:', userId, 'groupSize:', groupSize);

    if (!level ||!["1", "2", "3", "4", "5", "6", "7-9"].includes(level)) {
        console.log('[参数错误] 无效的 level 参数:', level);
        return res.status(400).json({ error: "Invalid level parameter" });
    }

    if (isNaN(userId)) {
        console.log('[参数错误] 无效的 userId 参数:', req.query.userId);
        return res.status(400).json({ error: "Invalid userId parameter" });
    }

    const actualLevel = levelMap[level] || level;
    console.log('[参数转换] 实际 level:', actualLevel);

    if (["1", "2", "3"].includes(level)) {
        console.log('[等级错误] 高等单词接口不支持 1 - 3 级');
        return res.status(400).json({ error: "高等单词接口不支持 1 - 3 级" });
    }

    let connection;
    try {
        connection = await zuizhongPool.getConnection();
        if (!connection || typeof connection.execute!== 'function') {
            console.error('获取的数据库连接对象无效:', connection);
            return res.status(500).json({ error: "Invalid database connection" });
        }

        // 首先尝试查找已经开始学习但尚未完全掌握的单词
        console.log('[查询策略] 首先查找已开始学习但未完全掌握的单词');
        const [partiallyLearnedWords] = await connection.execute(
            `SELECT DISTINCT w.id, w.word, w.sentence 
             FROM word_list_level_${actualLevel} w
             JOIN learned_words lw ON w.word = lw.word AND lw.user_id = ?
             JOIN knowledge_graph kg ON w.word = kg.subject
             WHERE (lw.already_known = 0 OR lw.no_need_to_back = 0) AND w.sentence IS NOT NULL
             ORDER BY RAND()
             LIMIT ${requestedSize}`,
            [userId]
        );

        console.log(`[查询结果] 找到 ${partiallyLearnedWords.length} 个部分掌握的单词`);
        console.log('[部分掌握单词] 单词列表:', partiallyLearnedWords.map(w => w.word).join(', '));
        
        // 计算还需要多少个新单词来达到请求的数量
        const remainingNeeded = requestedSize - partiallyLearnedWords.length;
        
        // 如果已经有足够的部分掌握的单词，直接返回它们
        if (remainingNeeded <= 0) {
            const result = await buildWordData(connection, partiallyLearnedWords, actualLevel, level, userId);
            console.log('[处理单词] 返回部分掌握的单词数据，数量:', result.length);
            console.log('[返回单词] 单词列表:', result.map(r => r.word).join(', '));
            return res.json(result);
        }
        
        // 否则，获取更多的新单词来补充
        console.log(`[查询策略] 部分掌握的单词不足 ${requestedSize} 个，需要补充 ${remainingNeeded} 个新单词`);
        
        // 获取已学习的单词列表
        const [learnedWords] = await connection.execute(
            `SELECT word FROM learned_words 
             WHERE user_id = ?`,
            [userId]
        );
        const learnedWordsList = learnedWords.map(wordData => wordData.word);
        
        // 确保不会返回已经在部分掌握列表中的单词
        const excludedWords = [...learnedWordsList];
        const excludedWordsStr = excludedWords.length ? 
            excludedWords.map(word => `'${word}'`).join(',') : 
            "''";
        
        // 查询新单词
        const newWordsSql = `SELECT DISTINCT w.id, w.word, w.sentence 
                             FROM word_list_level_${actualLevel} w
                             JOIN knowledge_graph kg ON w.word = kg.subject
                             WHERE w.word NOT IN (${excludedWordsStr})
                             AND w.sentence IS NOT NULL
                             ORDER BY RAND() 
                             LIMIT ${remainingNeeded}`;
        
        console.log('[查询新单词] SQL:', newWordsSql);
        const [newWords] = await connection.execute(newWordsSql);
        console.log('[查询结果] 找到 ' + newWords.length + ' 个新单词');
        console.log('[新单词] 单词列表:', newWords.map(w => w.word).join(', '));
        
        // 合并部分掌握的单词和新单词
        const combinedWords = [...partiallyLearnedWords, ...newWords];
        
        if (combinedWords.length === 0) {
            console.log('[查询结果] 没有找到任何单词');
            return res.status(404).json({ error: "No words found for this level" });
        }
        
        const result = await buildWordData(connection, combinedWords, actualLevel, level, userId);
        console.log('[处理单词] 返回混合单词数据，数量:', result.length);
        console.log('[返回单词] 单词列表:', result.map(r => r.word).join(', '));
        return res.json(result);
    } catch (error) {
        console.error('[数据库操作失败] 错误信息:', error);
        return res.status(500).json({ error: "Database query exception" });
    } finally {
        if (connection) {
            console.log('[处理其他等级] 释放数据库连接');
            connection.release();
        }
    }
});


// 公共函数：构建单词数据
async function buildWordData(connection, words, actualLevel, level, userId) {
    if (!connection || typeof connection.execute!== 'function') {
        console.error('传入的数据库连接对象无效:', connection);
        throw new Error('Invalid database connection');
    }

    const result = [];
    const processedWords = new Set(); // 用于跟踪已处理的单词，防止重复
    
    for (const wordData of words) {
        const { id: wordId, word, sentence } = wordData;
        
        // 如果这个单词已经处理过了，跳过
        if (processedWords.has(word)) {
            console.log(`[重复单词] 跳过重复单词: ${word}`);
            continue;
        }
        
        processedWords.add(word); // 添加到已处理集合
        
        let formattedExamples = sentence || "暂无例句";
        const classTable = `word_class_level_${actualLevel}`;
        const [classes] = await connection.execute(
            `SELECT id, class FROM ${classTable} WHERE word_id = ?`,
            [wordId]
        );

        if (!classes.length) {
            console.log('[处理其他等级] 单词', word, '没有分类信息，跳过');
            continue;
        }

        const pinyinList = classes.map(c => c.class);
        const entries = [];
        const definitionTable = `word_definition_level_${actualLevel}`;

        for (const cls of classes) {
            const [defs] = await connection.execute(
                `SELECT definition FROM ${definitionTable} WHERE word_class_id = ?`,
                [cls.id]
            );
            entries.push({
                pinyin: cls.class,
                part_of_speech: "",
                definition: defs.map(d => d.definition).join('; ')
            });
        }

        // 获取相关三元组（数据库层已过滤同素词并限制36条）
        const relatedTriples = await findRelatedTriples(word);
        const relatedwords = relatedTriples.map(triple => triple[2]); // 直接映射，无需切片

        result.push({
            word,
            level,
            pinyin: pinyinList,
            word_id: wordId,
            example: formattedExamples,
            entries,
            relatedwords
        });
    }
    
    return result;
}



app.post('/api/word-knowledge', authMiddleware, async (req, res) => {
    console.log('\n---------------------------');
    console.log('[请求接收] 新请求到达:', req.method, req.url);
    console.log('[请求内容] 请求体:', req.body);

    try {
        const { word, word_level, isKnown, pinyin } = req.body;
        const userId = parseInt(req.user.userId);

        if (!userId) {
            console.log('[字段验证] 缺少 user_id');
            return res.status(400).json({ error: 'Missing user_id' });
        }

        if (!word || !word_level || typeof isKnown === 'undefined' || typeof pinyin === 'undefined') {
            console.log(`[字段验证] 缺少必要字段`);
            return res.status(400).json({
                error: 'Missing required fields (word, word_level, isKnown, pinyin)',
            });
        }

        const wordLevelNum = Number(word_level);
        const conn = await zuizhongPool.getConnection();

        try {
            // 查询是否已存在记录
            const [existing] = await conn.execute(
                `SELECT * FROM learned_words 
                 WHERE user_id = ? AND word = ?`,
                [userId, word]
            );
            console.log('[数据库查询结果] existing:', existing);

            if (existing && existing.length > 0) {
                // 已有记录，根据isKnown更新状态
                const currentRecord = existing[0];
                let updateSql = null;

                if (isKnown) {
                    // 用户点击"认识"
                    if (currentRecord.already_known === 0 && currentRecord.no_need_to_back === 0) {
                        // 从"不认识"变为"认识但需要复习"
                        updateSql = `UPDATE learned_words 
                                     SET already_known = 1, no_need_to_back = 0 
                                     WHERE user_id = ? AND word = ?`;
                    } else if (currentRecord.already_known === 1 && currentRecord.no_need_to_back === 0) {
                        // 从"认识但需要复习"变为"完全掌握"
                        updateSql = `UPDATE learned_words 
                                     SET no_need_to_back = 1 
                                     WHERE user_id = ? AND word = ?`;
                    }
                } else {
                    // 用户点击"不认识"，无论当前状态如何都设置为不认识
                    updateSql = `UPDATE learned_words 
                                 SET already_known = 0, no_need_to_back = 0 
                                 WHERE user_id = ? AND word = ?`;
                }

                if (updateSql) {
                    await conn.execute(updateSql, [userId, word]);
                    console.log('[状态更新] 单词状态更新成功:', { word, isKnown });
                }
            } else {
                // 无记录，插入新记录
                // 根据isKnown设置初始状态
                const alreadyKnown = isKnown ? 1 : 0;
                const noNeedToBack = 0; // 新记录总是需要复习

                await conn.execute(
                    `INSERT INTO learned_words 
                     (user_id, word, word_level, reviewed, pinyin, already_known, no_need_to_back)
                     VALUES (?, ?, ?, 0, ?, ?, ?)`,
                    [userId, word, wordLevelNum, pinyin, alreadyKnown, noNeedToBack]
                );
                console.log('[新记录插入] 单词', word, '插入成功，already_known:', alreadyKnown);
            }

            res.status(200).json({ message: "状态更新成功" });
        } finally {
            conn.release();
        }
    } catch (error) {
        console.error('[数据库错误] 操作失败:', error);
        res.status(500).json({
            error: 'Internal server error',
            details: error.message
        });
    }
});    



// 模拟知识图谱数据



//发散版
// const getSingleWordKnowledgeGraph = async (word) => {
//     try {
//         // 修改查询，排除同素词关系
//         const [rows] = await zuizhongPool.execute(
//             `SELECT subject, relation, object 
//              FROM knowledge_graph 
//              WHERE subject = ? AND relation != '同素词'`,
//             [word]
//         );

//         const triples = rows.map(row => [row.subject, row.relation, row.object]);

//         return {
//             status: 200,
//             data: { triples }
//         };

//     } catch (error) {
//         console.error(`❌ 查询知识图谱失败：${error}`);
//         return {
//             status: 500,
//             data: { error: "服务器内部错误，查询知识图谱失败" }
//         };
//     }
// };

////不是发散的图谱了
// const getSingleWordKnowledgeGraph = async (word) => {
//     try {
//         // 步骤1: 获取以word为主语的三元组（排除同素词关系）
//         const [primaryRows] = await zuizhongPool.execute(
//             `SELECT subject, relation, object 
//              FROM knowledge_graph 
//              WHERE subject = ? AND relation != '同素词'`,
//             [word]
//         );

//         // 转换为三元组数组
//         const primaryTriples = primaryRows.map(row => [row.subject, row.relation, row.object]);
        
//         // 如果没有找到任何三元组，直接返回空结果
//         if (primaryTriples.length === 0) {
//             return {
//                 status: 200,
//                 data: { triples: [] }
//             };
//         }
        
//         // 步骤2: 收集所有对象词
//         const relatedObjects = primaryRows.map(row => row.object);
        
//         // 步骤3: 查询这些对象词之间的关系
//         // 构建查询条件：obj1和obj2都在relatedObjects中，且obj1 != obj2
//         let secondaryTriples = [];
        
//         if (relatedObjects.length > 1) {
//             // 只有当有多个对象词时才需要查询它们之间的关系
//             const placeholders = relatedObjects.map(() => '?').join(',');
            
//             const [secondaryRows] = await zuizhongPool.execute(
//                 `SELECT subject, relation, object 
//                  FROM knowledge_graph 
//                  WHERE subject IN (${placeholders}) 
//                  AND object IN (${placeholders})
//                  AND subject != object
//                  AND relation != '同素词'`,
//                 [...relatedObjects, ...relatedObjects]
//             );
            
//             secondaryTriples = secondaryRows.map(row => [row.subject, row.relation, row.object]);
//         }
        
//         // 步骤4: 合并所有三元组并返回
//         const allTriples = [...primaryTriples, ...secondaryTriples];
        
//         return {
//             status: 200,
//             data: { triples: allTriples }
//         };

//     } catch (error) {
//         console.error(`❌ 查询知识图谱失败：${error}`);
//         return {
//             status: 500,
//             data: { error: "服务器内部错误，查询知识图谱失败" }
//         };
//     }
// };



// const getSingleWordKnowledgeGraph = async (word) => {
//     try {
//         // 修改查询，排除同素词关系
//         const [rows] = await zuizhongPool.execute(
//             `SELECT subject, relation, object 
//              FROM knowledge_graph 
//              WHERE subject = ? AND relation != '同素词'`,
//             [word]
//         );

//         const triples = rows.map(row => [row.subject, row.relation, row.object]);
//         console.log(`查询到的三元组数量: ${triples.length}`);

//         return {
//             status: 200,
//             data: { triples }
//         };

//     } catch (error) {
//         console.error(`❌ 查询知识图谱失败：${error}`);
//         console.error(`错误类型: ${error.name}`);
//         console.error(`错误信息: ${error.message}`);
//         if (error.sql) {
//             console.error(`执行的 SQL 语句: ${error.sql}`);
//         }
//         return {
//             status: 500,
//             data: { error: "服务器内部错误，查询知识图谱失败" }
//         };
//     }
// };


//////////////////////////believe me//////////////////////
const getSingleWordKnowledgeGraph = async (word) => {
    try {
        // 修改查询，排除同素词关系并限制返回数量为 36
        const [rows] = await zuizhongPool.execute(
            `SELECT subject, relation, object 
             FROM knowledge_graph 
             WHERE subject = ? AND relation != '同素词'
             LIMIT 36`,
            [word]
        );

        const triples = rows.map(row => [row.subject, row.relation, row.object]);
        console.log(`查询到的三元组数量: ${triples.length}`);

        return {
            status: 200,
            data: { triples }
        };

    } catch (error) {
        console.error(`❌ 查询知识图谱失败：${error}`);
        console.error(`错误类型: ${error.name}`);
        console.error(`错误信息: ${error.message}`);
        if (error.sql) {
            console.error(`执行的 SQL 语句: ${error.sql}`);
        }
        return {
            status: 500,
            data: { error: "服务器内部错误，查询知识图谱失败" }
        };
    }
};


// // 获取与单个词相关的三元组（网络关系）
// const getSingleWordFullKnowledgeGraph = async (word) => {
//     try {
//         // 步骤1: 获取以word为主语的三元组（排除同素词关系）
//         const [primaryRows] = await zuizhongPool.execute(
//             `SELECT subject, relation, object 
//              FROM knowledge_graph 
//              WHERE subject = ? AND relation != '同素词'`,
//             [word]
//         );

//         // 转换为三元组数组
//         const primaryTriples = primaryRows.map(row => [row.subject, row.relation, row.object]);

//         // 如果没有找到任何三元组，直接返回空结果
//         if (primaryTriples.length === 0) {
//             return {
//                 status: 200,
//                 data: { triples: [] }
//             };
//         }

//         // 步骤2: 收集所有对象词
//         const relatedObjects = primaryRows.map(row => row.object);

//         // 步骤3: 查询这些对象词之间的关系
//         // 构建查询条件：obj1和obj2都在relatedObjects中，且obj1 != obj2
//         let secondaryTriples = [];

//         if (relatedObjects.length > 1) {
//             // 只有当有多个对象词时才需要查询它们之间的关系
//             const placeholders = relatedObjects.map(() => '?').join(',');

//             const [secondaryRows] = await zuizhongPool.execute(
//                 `SELECT subject, relation, object 
//                  FROM knowledge_graph 
//                  WHERE subject IN (${placeholders}) 
//                  AND object IN (${placeholders})
//                  AND subject != object
//                  AND relation != '同素词'`,
//                 [...relatedObjects, ...relatedObjects]
//             );

//             secondaryTriples = secondaryRows.map(row => [row.subject, row.relation, row.object]);
//         }

//         // 步骤4: 合并所有三元组并返回
//         const allTriples = [...primaryTriples, ...secondaryTriples];

//         return {
//             status: 200,
//             data: { triples: allTriples }
//         };

//     } catch (error) {
//         console.error(`❌ 查询知识图谱失败：${error}`);
//         return {
//             status: 500,
//             data: { error: "服务器内部错误，查询知识图谱失败" }
//         };
//     }
// };
// 获取与单个词相关的三元组（网络关系）
const getSingleWordFullKnowledgeGraph = async (word) => {
    try {
        // 步骤1: 获取以word为主语的三元组（排除同素词关系）
        const [primaryRows] = await zuizhongPool.execute(
            `SELECT subject, relation, object 
             FROM knowledge_graph 
             WHERE subject = ? AND relation != '同素词'`,
            [word]
        );

        // 转换为三元组数组
        const primaryTriples = primaryRows.map(row => [row.subject, row.relation, row.object]);

        // 如果没有找到任何三元组，直接返回空结果
        if (primaryTriples.length === 0) {
            return {
                status: 200,
                data: { triples: [] }
            };
        }

        // 步骤2: 收集所有对象词
        const relatedObjects = primaryRows.map(row => row.object);

        // 步骤3: 查询这些对象词之间的关系
        // 构建查询条件：obj1和obj2都在relatedObjects中，且obj1 != obj2
        let secondaryTriples = [];

        if (relatedObjects.length > 1) {
            // 只有当有多个对象词时才需要查询它们之间的关系
            const placeholders = relatedObjects.map(() => '?').join(',');

            const [secondaryRows] = await zuizhongPool.execute(
                `SELECT subject, relation, object 
                 FROM knowledge_graph 
                 WHERE subject IN (${placeholders}) 
                 AND object IN (${placeholders})
                 AND subject != object
                 AND relation != '同素词'`,
                [...relatedObjects, ...relatedObjects]
            );

            secondaryTriples = secondaryRows.map(row => [row.subject, row.relation, row.object]);
        }

        // 步骤4: 合并所有三元组
        const allTriples = [...primaryTriples, ...secondaryTriples];

        // 用于记录已出现的节点
        const uniqueNodes = new Set();
        const limitedTriples = [];

        for (const triple of allTriples) {
            const [subject, , object] = triple;
            const newNodes = [subject, object].filter(node => !uniqueNodes.has(node));

            if (uniqueNodes.size + newNodes.length <= 36) {
                limitedTriples.push(triple);
                newNodes.forEach(node => uniqueNodes.add(node));
            } else {
                // 若添加新节点会超过 36 个，则停止添加三元组
                break;
            }
        }

        return {
            status: 200,
            data: { triples: limitedTriples }
        };

    } catch (error) {
        console.error(`❌ 查询知识图谱失败：${error}`);
        return {
            status: 500,
            data: { error: "服务器内部错误，查询知识图谱失败" }
        };
    }
};
///////////////////////////////////////////believe me ///////////////////////////////////////////////




app.post('/get_knowledge_graph', async (req, res) => {
    const { word } = req.body;
    try {
        const { status, data } = await getSingleWordKnowledgeGraph(word);
        if (typeof status !== 'number' || isNaN(status)) {
            console.error('Invalid status code returned from getSingleWordKnowledgeGraph');
            return res.status(500).json({ error: 'Invalid status code from server' });
        }
        res.status(status).json(data);
    } catch (error) {
        console.error('Error in /get_knowledge_graph:', error);
        res.status(500).json({ error: 'Server error' });
    }
});





app.get('/api/word-group-type', authMiddleware, async (req, res) => {
    const level = parseInt(req.query.level);
    // Get userId from authenticated user data
    const userId = req.user.userId;
    
    if (!level || level < 1 || level > 7) {
        return res.status(400).json({ error: '请输入合法的 level（1~7）' });
    }
    
    // Pass all required parameters
    const result = await getWordGroupType(level, false, userId);
    res.status(result.status).json(result.data);
});


// // 获取组知识图谱
// const getGroupKnowledgeGraph = async (level) => {
//     try {
//         const [rows] = await zuizhongPool.execute(
//             `SELECT subject, relation, object FROM knowledge_graph WHERE level = ? AND type = '泛称'`,
//             [level]
//         );

//         const triples = rows.map(row => [row.subject, row.relation, row.object]);

//         return {
//             status: 200,
//             data: { triples }
//         };

//     } catch (error) {
//         console.error(`❌ 查询知识图谱失败：${error}`);
//         return {
//             status: 500,
//             data: { error: "服务器内部错误，查询失败" }
//         };
//     }
// };

////////////////////////////////////believe me/////////////////////////////////////
// 获取组知识图谱
// 获取组知识图谱
const getGroupKnowledgeGraph = async (level, type) => {
    try {
        console.log('📝 准备执行 SQL 查询，等级:', level, '，词族类型:', type);
        // 查询知识图谱中的三元组
        const [rows] = await zuizhongPool.execute(
            `SELECT subject, relation, object FROM knowledge_graph WHERE level = ? AND type = ?`,
            [level, type]
        );
        console.log('📄 查询到的原始数据行数:', rows.length);
        console.log('📄 查询到的原始数据:', rows);

        const triples = rows.map(row => [row.subject, row.relation, row.object]);
        console.log('🔢 转换后的三元组数据:', triples);

        // 获取该词族下的所有词
        const [wordRows] = await zuizhongPool.execute(
            `SELECT word FROM word_list_level_${level} WHERE word_family = ?`,
            [type]
        );
        const allWords = wordRows.map(row => row.word);

        // 找出不在三元组中的词
        const allTripleWords = new Set();
        triples.forEach(triple => {
            allTripleWords.add(triple[0]);
            allTripleWords.add(triple[2]);
        });
        const singleNodes = allWords.filter(word =>!allTripleWords.has(word));

        if (triples.length === 0) {
            // 如果没有三元组，将所有词构建成一个大的知识图谱三元组
            for (let i = 0; i < allWords.length - 1; i++) {
                triples.push([allWords[i], '关联', allWords[i + 1]]);
            }
            if (allWords.length > 1) {
                triples.push([allWords[allWords.length - 1], '关联', allWords[0]]);
            }
        } else {
            // 有三元组时，将孤立节点与三元组连接起来
            const usedNodes = new Set(allTripleWords);
            singleNodes.forEach(singleNode => {
                // 简单策略：将孤立节点与第一个三元组的主语相连
                if (triples.length > 0) {
                    triples.push([singleNode, '关联', triples[0][0]]);
                }
            });
        }

        return {
            status: 200,
            data: { triples }
        };

    } catch (error) {
        console.error(`❌ 查询知识图谱失败：${error}`);
        return {
            status: 500,
            data: { error: "服务器内部错误，查询失败" }
        };
    }
};    
    
    


// app.post('/api/group-knowledge-graph', async (req, res) => {
//     const { level } = req.body;

//     if (!level || typeof level !== 'number') {
//         return res.status(400).json({ error: "请输入合法的等级（数字）" });
//     }

//     const { status, data } = await getGroupKnowledgeGraph(level);
//     res.status(status).json(data);
// });
//////////
//////////////////believe me///////////////////
app.post('/api/group-knowledge-graph', async (req, res) => {
    const { level, type } = req.body;
    console.log('📋 接收到的请求体:', req.body);

    if (!level || typeof level!== 'number') {
        console.error('❌ 无效的等级参数:', level);
        return res.status(400).json({ error: "请输入合法的等级（数字）" });
    }

    if (!type || typeof type!== 'string') {
        console.error('❌ 无效的词族类型参数:', type);
        return res.status(400).json({ error: "请输入合法的词族类型（字符串）" });
    }

    console.log('🔍 开始查询组知识图谱，等级:', level, '，词族类型:', type);
    const { status, data } = await getGroupKnowledgeGraph(level, type);
    console.log('📊 查询结果状态:', status, '，数据:', data);
    res.status(status).json(data);
});
/////////////////////////////believe me ///////////////////////




////新版连了数据库版本
app.get('/definition', async (req, res) => {
    console.log(`[请求到达] /definition 请求到达，查询参数: ${JSON.stringify(req.query)}`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const word = req.query.word;
    if (!word) {
        console.log(`[参数错误] 请求中未提供有效的单词，查询参数: ${JSON.stringify(req.query)}`);
        return res.status(400).json({ error: "Please provide a valid word" });
    }

    let connection;
    try {
        console.log('[数据库连接] 尝试获取数据库连接');
        connection = await zuizhongPool.getConnection();
        console.log('[数据库连接] 成功获取数据库连接');

        const levels = ["1", "2", "3", "4", "5", "6", "7"];
        let wordId;
        let classResults;
        let foundLevel;
        for (const level of levels) {
            const wordTable = `word_list_level_${level}`;
            console.log(`[数据库查询] 开始在 ${wordTable} 中查询单词 "${word}" 的 ID`);
            const [wordResults] = await connection.execute(`SELECT id FROM ${wordTable} WHERE word = ?`, [word]);
            console.log(`[数据库查询] 结束在 ${wordTable} 中查询单词 "${word}" 的 ID，查询结果数量: ${wordResults.length}`);
            if (wordResults.length > 0) {
                wordId = wordResults[0].id;
                console.log(`[查询成功] 在 ${wordTable} 中找到单词 "${word}" 的 ID 为: ${wordId}`);

                const classTable = `word_class_level_${level}`;
                console.log(`[数据库查询] 开始在 ${classTable} 中查询单词 ID 为 ${wordId} 的分类信息`);
                [classResults] = await connection.execute(`SELECT id, class FROM ${classTable} WHERE word_id = ?`, [wordId]);
                console.log(`[数据库查询] 结束在 ${classTable} 中查询单词 ID 为 ${wordId} 的分类信息，查询结果数量: ${classResults.length}`);
                if (classResults.length > 0) {
                    foundLevel = level;
                    break;
                }
            }
        }

        if (!wordId || !classResults || classResults.length === 0) {
            console.log(`[查询失败] 未找到单词 "${word}" 的记录或分类信息`);
            return res.status(404).json({ error: "Word or class information not found" });
        }

        const entries = [];
        for (const cls of classResults) {
            const definitionTable = `word_definition_level_${foundLevel}`;
            console.log(`[数据库查询] 开始在 ${definitionTable} 中查询分类 ID 为 ${cls.id} 的释义信息`);
            const [defResults] = await connection.execute(`SELECT definition FROM ${definitionTable} WHERE word_class_id = ?`, [cls.id]);
            console.log(`[数据库查询] 结束在 ${definitionTable} 中查询分类 ID 为 ${cls.id} 的释义信息，查询结果数量: ${defResults.length}`);
            const definition = defResults.map(d => d.definition).join('; ');
            entries.push({
                pinyin: cls.class,
                part_of_speech: "",
                definition: definition
            });
        }

        console.log(`[响应准备] 返回单词 "${word}" 的释义信息，entries 数量: ${entries.length}`);
        return res.json({ entries });
    } catch (error) {
        console.error(`[错误发生] 获取单词 "${word}" 的释义时出错:`, error);
        return res.status(500).json({ error: "Error processing definition request" });
    } finally {
        if (connection) {
            console.log('[数据库连接] 释放数据库连接');
            connection.release();
        }
    }
});


///////////////
// 关系查询接口
// app.get('/relations', async (req, res) => {
//     res.setHeader('Content-Type', 'application/json; charset=utf-8');
//     const word = req.query.word;
//     if (!word) return res.status(400).json({ error: "请输入有效的词语" });

//     try {
//         const relatedTriples = await findRelatedTriples(word);

//         // 使用 Set 对每条三元组进行去重（即使数据库中有重复）
//         const tripleSet = new Set();
//         const uniqueTriples = [];

//         for (const [subject, relation, object] of relatedTriples) {
//             const key = `${subject}||${relation}||${object}`; // 唯一标识
//             if (!tripleSet.has(key)) {
//                 tripleSet.add(key);
//                 uniqueTriples.push([subject, relation, object]);
//             }
//         }

//         res.json({ data: uniqueTriples });

//     } catch (error) {
//         console.error(`处理 /relations 接口时出错，关键词为 "${word}"：`, error);
//         res.status(500).json({ error: "服务器内部错误" });
//     }
// });

app.get('/relations', async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const word = req.query.word;
    if (!word) return res.status(400).json({ error: "请输入有效的词语" });

    try {
        const { status, data } = await getSingleWordKnowledgeGraph(word);
        if (status === 200) {
            const { triples } = data;
            // 使用 Set 对每条三元组进行去重（即使数据库中有重复）
            const tripleSet = new Set();
            const uniqueTriples = [];

            for (const [subject, relation, object] of triples) {
                const key = `${subject}||${relation}||${object}`; // 唯一标识
                if (!tripleSet.has(key)) {
                    tripleSet.add(key);
                    uniqueTriples.push([subject, relation, object]);
                }
            }

            res.json({ data: uniqueTriples });
        } else {
            res.status(status).json(data);
        }
    } catch (error) {
        console.error(`处理 /relations 接口时出错，关键词为 "${word}"：`, error);
        res.status(500).json({ error: "服务器内部错误" });
    }
});

app.get('/fullgraph', async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const word = req.query.word;
    if (!word) return res.status(400).json({ error: "请输入有效的词语" });

    try {
        const { status, data } = await getSingleWordFullKnowledgeGraph(word);
        if (status === 200) {
            const { triples } = data;
            // 使用 Set 对每条三元组进行去重（即使数据库中有重复）
            const tripleSet = new Set();
            const uniqueTriples = [];

            for (const [subject, relation, object] of triples) {
                const key = `${subject}||${relation}||${object}`; // 唯一标识
                if (!tripleSet.has(key)) {
                    tripleSet.add(key);
                    uniqueTriples.push([subject, relation, object]);
                }
            }

            res.json({ data: uniqueTriples });
        } else {
            res.status(status).json(data);
        }
    } catch (error) {
        console.error(`处理 /fullgraph 接口时出错，关键词为 "${word}"：`, error);
        res.status(500).json({ error: "服务器内部错误" });
    }
});



// 单词关系接口
app.get('/api/relationship', async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const { word1, word2 } = req.query;
    if (!word1 || !word2) {
        return res.status(400).json({ error: "请输入两个有效的字" });
    }

    try {
        const relationship = await findRelationshipBetweenWords(word1, word2);
        return res.json({ message: relationship || "未找到字之间的关系" });
    } catch (error) {
        console.error(`查找 "${word1}" 与 "${word2}" 的关系时出错:`, error);
        return res.status(500).json({ error: "服务器内部错误" });
    }
});

//////////////////////
//新加接口用于最后知识图谱展示的click

app.get('/api/word/:word', authMiddleware, async (req, res) => {
    console.log('[请求到达] /api/word/:word 请求到达，查询参数:', req.query);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    const { word } = req.params;
    const { level } = req.query;
    const userId = parseInt(req.user?.userId);

    console.log('[参数解析] level:', level, 'word:', word, 'userId:', userId);

    // 检查 level 参数是否有效
    if (!level || !["1", "2", "3", "4", "5", "6", "7 - 9"].includes(level)) {
        console.log('[参数错误] 无效的 level 参数:', level);
        return res.status(400).json({ error: "Invalid level parameter" });
    }

    // 检查 userId 参数是否有效
    if (isNaN(userId)) {
        console.log('[参数错误] 无效的 userId 参数:', req.query.userId);
        return res.status(400).json({ error: "Invalid userId parameter" });
    }

    const levelMap = { "7 - 9": "7" };
    const actualLevel = levelMap[level] || level;
    console.log('[参数转换] 实际 level:', actualLevel);

    let connection;
    try {
        console.log('[处理单词请求] 尝试获取数据库连接');
        connection = await zuizhongPool.getConnection();
        console.log('[处理单词请求] 成功获取数据库连接');

        // 查询单词信息
        const wordTable = `word_list_level_${actualLevel}`;
        console.log('[处理单词请求] 开始查询单词信息，表名:', wordTable);
        const [words] = await connection.execute(
            `SELECT id, word, pinyin, sentence, sentence_pinyin FROM \`${wordTable}\` WHERE word = ?`,
            [word]
        );
        console.log('[处理单词请求] 查询单词信息结果，单词数量:', words.length);

        // 检查是否找到单词
        if (!words.length) {
            console.log('[处理单词请求] 未找到该单词');
            return res.status(404).json({ error: `Word ${word} not found` });
        }

        const wordData = words[0];
        const { id: wordId, pinyin, sentence, sentence_pinyin } = wordData;

        // 查询单词分类信息
        const classTable = `word_class_level_${actualLevel}`;
        console.log('[处理单词请求] 开始查询单词', word, '的分类信息，表名:', classTable);
        const [classes] = await connection.execute(
            `SELECT id, class FROM ${classTable} WHERE word_id = ?`,
            [wordId]
        );
        console.log('[处理单词请求] 查询单词', word, '的分类信息结果，分类数量:', classes.length);

        // 检查是否有分类信息
        if (!classes.length) {
            console.log('[处理单词请求] 单词', word, '没有分类信息');
            return res.status(404).json({ error: `No classification information for word ${word}` });
        }

        const pinyinList = classes.map(c => c.class); // class 字段就是拼音

        const entries = [];
        const definitionTable = `word_definition_level_${actualLevel}`;

        // 处理每个分类的定义信息
        for (const cls of classes) {
            console.log('[处理单词请求] 开始查询单词', word, '分类 ID 为', cls.id, '的定义信息，表名:', definitionTable);
            const [defs] = await connection.execute(
                `SELECT definition FROM ${definitionTable} WHERE word_class_id = ?`,
                [cls.id]
            );
            console.log('[处理单词请求] 查询单词', word, '分类 ID 为', cls.id, '的定义信息结果，定义数量:', defs.length);

            entries.push({
                pinyin: cls.class,           // 直接使用 class 字段
                part_of_speech: "",          // 暂时无词性字段，可扩展
                definition: defs.map(d => d.definition).join('; ')
            });
        }

        const relatedTriples = await findRelatedTriples(word);
        const relatedwords = relatedTriples.map(triple => triple[2]);

        const result = {
            word,
            level,
            pinyin: pinyinList,
            word_id: wordId,
            example: sentence || "暂无例句",
            examplePinyin: sentence_pinyin || "",
            entries,
            relatedwords
        };

        console.log('[处理单词请求] 最终返回的单词数据:', result);
        return res.json(result);

    } catch (error) {
        console.error('[处理单词请求] 数据库操作失败，错误信息:', error);
        return res.status(500).json({ error: "Database query exception" });
    } finally {
        if (connection) {
            console.log('[处理单词请求] 释放数据库连接');
            connection.release();
        }
    }
});


//更改计划清空learned_word相关信息
app.post('/api/level-change', authMiddleware, async (req, res) => {
    console.log('Received a POST request to /api/level-change');
    console.log('Request body:', req.body);
    try {
        const userId = req.user.userId; 
        const { previousLevel } = req.body;
        
        if (!userId || !previousLevel) {
            console.log('Missing userId or previousLevel in request body');
            return res.status(400).json({ error: 'Missing userId or previousLevel' });
        }
        
        // 处理 'advanced' 级别的特殊情况
        const deleteLevel = previousLevel === 'advanced' ? 7 : previousLevel;
        
        const query = 'DELETE FROM learned_words WHERE user_id = ? AND word_level = ?';
        
        console.log('Executing SQL query:', query);
        console.log('Query parameters:', [userId, deleteLevel]);
        
        const [result] = await zuizhongPool.execute(query, [userId, deleteLevel]);
        
        console.log('SQL query executed successfully. Rows affected:', result.affectedRows);
        res.status(200).json({ 
            message: 'Successfully deleted old level words', 
            deletedRows: result.affectedRows 
        });
    } catch (error) {
        console.error('Error deleting old level words:', error);
        res.status(500).json({ 
            error: 'Internal Server Error', 
            details: error.message 
        });
    }
});




///////////////////////////////////////////////////////
/////////////////////////////////////////////
///////////////////////////////////////////
//每日成语
//////////////////////////////
//////////////////////////////////////////
////////////////////////////////////////////////////////


function mapIdiomFields(row) {
    return {
        "成语": row.chengyu,
        "拼音": row.pinyin,
        "解释": row.jieshi,
        "出处": row.chuchu,
        "示例": row.shili,
        "近义词": row.jinyici,
        "反义词": row.fanyici,
        "语法": row.yufa,
        "典故": [row.diangu || ""],
        "例句": row.liju
    };
  }
  
  // 获取所有成语
  app.get('/api/idioms/all', async (req, res) => {
    try {
        const [results] = await zuizhongPool.query('SELECT * FROM idioms_zh');
        res.json({ idioms: results.map(mapIdiomFields) });
    } catch (err) {
        console.error('查询成语数据失败:', err);
        return res.status(500).json({ error: '数据库查询失败' });
    }
  });
  
  // 获取今日成语
  app.get('/api/idioms/today', async (req, res) => {
    try {
        const [results] = await zuizhongPool.query('SELECT * FROM idioms_zh');
        
        if (!results || results.length === 0) {
            return res.status(404).json({ error: '数据库中无成语数据' });
        }
  
        const now = new Date();
        const index = ((now.getFullYear() * 12 * 31) + (now.getMonth() * 31) + now.getDate()) % results.length;
        res.json({ idiom: mapIdiomFields(results[index]) });
    } catch (err) {
        console.error('查询今日成语失败:', err);
        return res.status(500).json({ error: '数据库查询失败' });
    }
  });
  
  // 分页与搜索成语
  app.get('/api/idioms', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const itemsPerPage = parseInt(req.query.itemsPerPage) || 10;
    const search = req.query.search || '';
  
    try {
        let query = 'SELECT * FROM idioms_zh';
        let params = [];
  
        if (search) {
            const fields = ['chengyu', 'pinyin', 'jieshi', 'chuchu', 'shili', 'jinyici', 'fanyici', 'yufa', 'diangu', 'liju'];
            query += ' WHERE ' + fields.map(field => `${field} LIKE ?`).join(' OR ');
            params = fields.map(() => `%${search}%`);
        }
  
        const [results] = await zuizhongPool.query(query, params);
        
        const totalPages = Math.ceil(results.length / itemsPerPage);
        const start = (page - 1) * itemsPerPage;
        const paginatedResults = results.slice(start, start + itemsPerPage);
  
        res.json({
            idioms: paginatedResults.map(mapIdiomFields),
            totalPages
        });
    } catch (err) {
        console.error('分页查询失败:', err);
        return res.status(500).json({ error: '数据库查询失败' });
    }
  });
  
  // 根据成语名称获取详细信息
  app.get('/api/idioms/:idiomName', async (req, res) => {
    const idiomName = req.params.idiomName;
  
    try {
        const [results] = await zuizhongPool.query('SELECT * FROM idioms_zh WHERE chengyu = ?', [idiomName]);
  
        if (results.length > 0) {
            res.json(mapIdiomFields(results[0]));
        } else {
            res.status(404).json({ error: '未找到该成语' });
        }
    } catch (err) {
        console.error('查询单个成语失败:', err);
        return res.status(500).json({ error: '数据库查询失败' });
    }
  });

////////////////////////////////////////////////////////
////////////////////////////////////////////
//复习///////
///////////////////////////////////////////
////////////////////////////////////////////////////

// 时间格式化函数
function getFormattedTime(date = new Date()) {
    return date.getFullYear() + '-' +
        String(date.getMonth() + 1).padStart(2, '0') + '-' +
        String(date.getDate()).padStart(2, '0') + ' ' +
        String(date.getHours()).padStart(2, '0') + ':' +
        String(date.getMinutes()).padStart(2, '0') + ':' +
        String(date.getSeconds()).padStart(2, '0');
}


app.get('/api/review/ai-questions', authMiddleware, async (req, res) => {
    const EbbinghausIntervals = [5, 30, 720, 1440, 2880, 5760, 10080, 21600];
    const MAX_REVIEW_COUNT = 8;
    const logRequest = req => console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`); 
    const user_id = req.user.userId;

    try {
        const conn = await zuizhongPool.getConnection();
        const currentTime = new Date(); 

        const formattedCurrentTime = currentTime.getFullYear() + '-' +
            String(currentTime.getMonth() + 1).padStart(2, '0') + '-' +
            String(currentTime.getDate()).padStart(2, '0') + ' ' +
            String(currentTime.getHours()).padStart(2, '0') + ':' +
            String(currentTime.getMinutes()).padStart(2, '0') + ':' +
            String(currentTime.getSeconds()).padStart(2, '0');

        const [rows] = await conn.execute(
            `SELECT word, pinyin, last_reviewed, reviewed, next_review 
             FROM learned_words
             WHERE user_id = ? AND reviewed < ? AND (next_review <= ? OR last_reviewed IS NULL)
             ORDER BY reviewed ASC, id ASC
             LIMIT 10`,
            [user_id, MAX_REVIEW_COUNT, formattedCurrentTime] 
        );

        if (rows.length === 0) {
            return res.status(200).json({ reading_content: "", questions: [] });
        }

        const selectedWords = rows.map(r => r.word);
        const readingMaterial = selectedWords.join(" ");
        const pyPath = path.join(__dirname, 'run_generator.py');
        const py = spawn('python', [pyPath, readingMaterial]);

        let output = '';
        py.on('close', async (code) => {
            try {
                const result = JSON.parse(output);
                
                for (const row of rows) {
                    const reviewCount = row.reviewed + 1;
                    if (reviewCount < MAX_REVIEW_COUNT) {
                        const intervalIndex = Math.min(reviewCount -1, EbbinghausIntervals.length - 1);
                        const intervalMinutes = EbbinghausIntervals[intervalIndex];
                        
                        const lastReviewed = row.last_reviewed ? new Date(row.last_reviewed) : new Date();
                        // 打印上次复习时间，格式化为 YYYY-MM-DD HH:mm:ss
                        console.log('上次复习时间:', 
                            lastReviewed.getFullYear() + '-' +
                            String(lastReviewed.getMonth() + 1).padStart(2, '0') + '-' +
                            String(lastReviewed.getDate()).padStart(2, '0') + ' ' +
                            String(lastReviewed.getHours()).padStart(2, '0') + ':' +
                            String(lastReviewed.getMinutes()).padStart(2, '0') + ':' +
                            String(lastReviewed.getSeconds()).padStart(2, '0')
                        );

                        // 直接基于 lastReviewed 计算下次复习时间，不使用 UTC
                        const nextReviewDate = new Date(lastReviewed.getTime());
                        nextReviewDate.setMinutes(nextReviewDate.getMinutes() + intervalMinutes);

                        // 格式化下次复习时间为 YYYY-MM-DD HH:mm:ss
                        const formattedDate = 
                            nextReviewDate.getFullYear() + '-' +
                            String(nextReviewDate.getMonth() + 1).padStart(2, '0') + '-' +
                            String(nextReviewDate.getDate()).padStart(2, '0') + ' ' +
                            String(nextReviewDate.getHours()).padStart(2, '0') + ':' +
                            String(nextReviewDate.getMinutes()).padStart(2, '0') + ':' +
                            String(nextReviewDate.getSeconds()).padStart(2, '0');

                        console.log('下次复习时间:', formattedDate);

                        await conn.execute(
                            `UPDATE learned_words 
                             SET reviewed = ?, last_reviewed = NOW(6), next_review = ? 
                             WHERE user_id = ? AND word = ?`,
                            [reviewCount, formattedDate, user_id, row.word]
                        );
                    } else {
                        await conn.execute(
                            `UPDATE learned_words 
                             SET reviewed = ?, last_reviewed = NOW(6), next_review = NULL 
                             WHERE user_id = ? AND word = ?`,
                            [reviewCount, user_id, row.word]
                        );
                    }
                }

                res.status(200).json(result[0]);
            } catch (e) {
                console.error('解析 Python 输出失败:', e);
                res.status(500).json({ error: '内部服务器错误' });
            } finally {
                conn.release();
            }
        });

        py.stdout.on('data', (data) => (output += data.toString()));
        py.stderr.on('data', (err) => console.error('Python 错误:', err.toString()));

    } catch (err) {
        console.error('数据库操作失败:', err);
        res.status(500).json({ error: '服务器内部错误' });
    }
});

// 模拟获取词汇列表的 API
app.get('/api/review/vocabulary', authMiddleware, async (req, res) => {
    logRequest(req);
    const user_id = req.user.userId;
    const MAX_REVIEW_COUNT = 8; // 最大复习次数

    try {
        const conn = await zuizhongPool.getConnection();

        // 获取当前时间
        const currentTime = new Date();
        const formattedCurrentTime = currentTime.getFullYear() + '-' +
            String(currentTime.getMonth() + 1).padStart(2, '0') + '-' +
            String(currentTime.getDate()).padStart(2, '0') + ' ' +
            String(currentTime.getHours()).padStart(2, '0') + ':' +
            String(currentTime.getMinutes()).padStart(2, '0') + ':' +
            String(currentTime.getSeconds()).padStart(2, '0');

        console.log('当前时间:', formattedCurrentTime);
        // 获取需要复习的词汇，同时查询下次复习时间
        const [rows] = await conn.execute(
            `SELECT word, pinyin, last_reviewed, reviewed, next_review 
             FROM learned_words
             WHERE user_id = ? AND reviewed < ? AND (next_review <= ? OR last_reviewed IS NULL)
             ORDER BY reviewed ASC, id ASC
             LIMIT 10`,
            [user_id, MAX_REVIEW_COUNT, formattedCurrentTime]
        );

        if (rows.length === 0) {
            conn.release();
            console.log('该用户目前没有需要复习的词汇');
            return res.status(200).json({ vocabulary: [] });
        }

        const vocabularyList = rows.map(row => ({
            word: row.word,
            pinyin: row.pinyin && row.pinyin.trim() !== '' ? row.pinyin : ' ',
            reviewed: row.reviewed
        }));

        conn.release();

        console.log('返回需要复习的词汇:', vocabularyList);
        res.status(200).json({ vocabulary: vocabularyList });

    } catch (error) {
        console.error('【/api/review/vocabulary 接口】处理请求时出错:', error);
        res.status(500).json({ code: 50003, message: '处理请求时出错' });
    }
});


app.get('/api/review/local-questions', authMiddleware, async (req, res) => {
    logRequest(req);
    const user_id = req.user.userId;
    const MAX_REVIEW_COUNT = 8; // 最大复习次数

    try {
        const questionsConn = await zuizhongPool.getConnection();

        const currentTime = new Date();
        const formattedCurrentTime = currentTime.getFullYear() + '-' +
            String(currentTime.getMonth() + 1).padStart(2, '0') + '-' +
            String(currentTime.getDate()).padStart(2, '0') + ' ' +
            String(currentTime.getHours()).padStart(2, '0') + ':' +
            String(currentTime.getMinutes()).padStart(2, '0') + ':' +
            String(currentTime.getSeconds()).padStart(2, '0');

        // 获取需要复习的词汇，同时查询下次复习时间
        const [rows] = await questionsConn.execute(
            `SELECT word, pinyin, last_reviewed, reviewed, next_review 
             FROM learned_words
             WHERE user_id = ? AND reviewed < ? AND (next_review <= ? OR last_reviewed IS NULL)
             ORDER BY reviewed ASC, id ASC
             LIMIT 10`,
            [user_id, MAX_REVIEW_COUNT, formattedCurrentTime]
        );

        const fixedWords = rows.map(row => row.word);
        const uniqueWords = [...new Set(fixedWords)]; // 去重

        // 生成占位符（如 "?, ?, ?, ?, ?"）
        const lowLevelPlaceholders = uniqueWords.map(() => '?').join(',');
        const lowLevelQuery = `
            SELECT word 
            FROM (
                SELECT word FROM word_list_level_1
                UNION  -- 去重，确保单词只出现一次
                SELECT word FROM word_list_level_2
                UNION  -- 去重，确保单词只出现一次
                SELECT word FROM word_list_level_3
            ) AS combined_words
            WHERE word IN (${lowLevelPlaceholders})
        `;

        // 执行查询，传入去重后的单词数组
        const [lowLevelRows] = await questionsConn.execute(lowLevelQuery, uniqueWords);
        const lowLevelWords = lowLevelRows.map(row => row.word);

        // 筛选高等级词汇（排除低等级）
        const highLevelWords = uniqueWords.filter(word => !lowLevelWords.includes(word));

        console.log("去重后的单词列表：", uniqueWords);
        console.log("低等级词汇（从数据库获取）：", lowLevelWords);
        console.log("高等级词汇（过滤结果）：", highLevelWords);

        // 从不同表中查询相应的复习问题
        let questionsList = [];

        // 查询小于等于2级的词汇对应的复习问题
        if (lowLevelWords.length > 0) {
            console.log(`尝试从表中查询与 ${lowLevelWords.join(', ')} 相关的小于等于2级的复习问题`);
            const placeholders = lowLevelWords.map(() => '?').join(',');

            // 移除不存在的 options 字段，仅查询实际存在的列
            const query = `
                SELECT 
                    word, 
                    pinyin 
                FROM 
                    word_list_level_1
                WHERE 
                    word IN (${placeholders})
                UNION ALL
                SELECT 
                    word, 
                    pinyin 
                FROM 
                    word_list_level_2
                WHERE 
                    word IN (${placeholders})
                UNION ALL
                SELECT 
                    word, 
                    pinyin 
                FROM 
                    word_list_level_3
                WHERE 
                    word IN (${placeholders})
            `;
            // 合并参数数组
            const params = [...lowLevelWords, ...lowLevelWords, ...lowLevelWords];
            const [lowLevelRows] = await questionsConn.execute(query, params);

            // 对查询结果进行去重
            const uniqueRows = Array.from(new Map(lowLevelRows.map(row => [row.word, row])).values());
            console.log(`从 word_list_level_1 和 word_list_level_2 表中获取的小于等于2级的复习问题数据：`, uniqueRows);

            const imageFolder = 'suxinhao'; // 图片文件夹路径
            const imageFiles = fs.readdirSync(imageFolder).filter(file => /\.(jpg|png)$/i.test(file));

            questionsList = questionsList.concat(uniqueRows.map(row => {
                const question = row.word;
                const options = [question];

                // 随机选择一个混淆项
                let randomIndex;
                do {
                    randomIndex = Math.floor(Math.random() * imageFiles.length);
                }
                while (imageFiles[randomIndex].replace(/\.(jpg|png)$/i, '') === question);
                const confusionOption = imageFiles[randomIndex].replace(/\.(jpg|png)$/i, '');
                options.push(confusionOption);

                const newOptions = options.map(option => {
                    const trimmedOption = option.trim();
                    return `${trimmedOption}.png`;
                });

                // 随机打乱选项顺序
                const shuffledOptions = newOptions.sort(() => Math.random() - 0.5);

                // 确定正确答案的位置
                const answerIndex = shuffledOptions.indexOf(`${question}.png`);
                const answer = String.fromCharCode(65 + answerIndex); // 将索引转换为 A、B 等

                return {
                    question: question, // 题目
                    question_pinyin: row.pinyin, // 拼音
                    options: shuffledOptions, // 处理后的选项
                    option_pinyin: "", // 拼音（若有）
                    answer: answer // 正确答案
                };
            }));
        }

        // 查询大于2级的词汇对应的复习问题
        if (highLevelWords.length > 0) {
            console.log(`尝试从表中查询与 ${highLevelWords.join(', ')} 相关的大于2级的复习问题`);
            const placeholders = highLevelWords.map(() => '?').join(',');
            const query = `
                SELECT id, word, sentence, hunxiaoci
                FROM hunxiaoci
                WHERE word IN (${placeholders})
            `;
            const [highLevelRows] = await questionsConn.execute(query, highLevelWords);
        
            console.log(`从表中获取的大于2级的复习问题数据：`, highLevelRows);
        
            // 按词汇分组，确保每个词汇生成2-3道题
            const wordGroup = {};
            highLevelRows.forEach(row => {
                if (!wordGroup[row.word]) {
                    wordGroup[row.word] = []; // 存储该词汇的所有题目
                }
                wordGroup[row.word].push(row); // 同一词汇的题目存入数组
            });
        
            // 遍历每个词汇，生成2-3道题
            Object.keys(wordGroup).forEach(word => {
                const rows = wordGroup[word];
                const maxQuestionsPerWord = 3; // 每个词汇最多生成3道题
                const minQuestionsPerWord = 2; // 每个词汇至少生成2道题
                const questionsToTake = Math.min(rows.length, maxQuestionsPerWord); // 避免题目不足时越界
        
                // 截取前n条记录（n=2或3，优先取满3条，不足则取全部）
                const selectedRows = rows.slice(0, questionsToTake);
        
                selectedRows.forEach(row => {
                    // 生成包含 word 和 hunxiaoci 的选项数组
                    const options = [row.word, row.hunxiaoci];
                    const shuffledOptions = options.sort(() => Math.random() - 0.5); // 随机打乱顺序
        
                    // 计算答案（A=1, B=2）
                    const answerPosition = shuffledOptions.indexOf(row.hunxiaoci) + 1;
                    const answer = answerPosition === 1 ? "A" : "B";
        
                    questionsList.push({
                        id: row.id,
                        type: "single_choice", // 明确题型
                        question: row.sentence,
                        question_pinyin: "",
                        options: shuffledOptions,
                        option_pinyin: [],
                        answer: answer
                    });
                });
            });
        }

        questionsConn.release();

        console.log('返回本地问题:', questionsList);
        res.status(200).json({ questions: questionsList });

    } catch (error) {
        console.error('【/api/review/local-questions 接口】处理请求时出错:', error);
        res.status(500).json({ code: 50003, message: '处理请求时出错' });
    }
});  


app.post('/api/review/wrong-answers', authMiddleware, async (req, res) => {
    const conn = await zuizhongPool.getConnection();
    const EbbinghausIntervals = [5, 30, 720, 1440, 2880, 5760, 10080, 21600]; // 复习间隔（分钟）

    try {
        logRequest(req);
        const userId = req.user.userId;
        const { wrongAnswers } = req.body;

        if (!userId || !Array.isArray(wrongAnswers) || wrongAnswers.length === 0) {
            return res.status(400).json({ error: '缺少必要参数：userId 或 wrongAnswers' });
        }

        const updatePromises = [];

        for (const wrongAnswer of wrongAnswers) {
            const { question, options, userAnswer, isImageQuestion } = wrongAnswer;
            const isLowLevel = isImageQuestion || (options && options.some(opt => /\.(jpg|png|gif)$/.test(opt)));
            const isHighLevel = !isLowLevel && options.length === 2;
            const targetWords = [];

            // 提取目标单词
            if (isLowLevel) {
                targetWords.push(question.trim());
            } else if (isHighLevel) {
                const errorOption = options[userAnswer]?.trim();
                if (errorOption) {
                    const words = errorOption.split(/\s+/).filter(word => word);
                    targetWords.push(...words);
                }
            } else {
                const currentTime = getFormattedTime();
                console.log(`[${currentTime}] 跳过非低等级或非两选项的题目`);
                continue;
            }

            const uniqueWords = [...new Set(targetWords.filter(word => word.trim() !== ''))];
            const currentTime = getFormattedTime();
            console.log(`[${currentTime}] 用户 ${userId} 本题（${isLowLevel ? '低等级' : '高等级'}）提取的单词:`, uniqueWords);

            for (const word of uniqueWords) {
                try {
                    const [rows] = await conn.execute(
                        'SELECT reviewed, last_reviewed FROM learned_words WHERE user_id = ? AND word = ?',
                        [userId, word]
                    );

                    if (rows.length > 0) {
                        const row = rows[0];
                        const reviewCount = row.reviewed;
                        const newReviewed = Math.max(reviewCount - 1, 0);

                        updatePromises.push(
                            conn.execute(
                                'UPDATE learned_words ' +
                                'SET reviewed = ?, ' +
                                '    last_reviewed = NOW() ' +
                                'WHERE user_id = ? AND word = ?',
                                [newReviewed, userId, word]
                            )
                        );

                        console.log(`[${currentTime}] 单词 ${word}：复习次数 ${reviewCount} → ${newReviewed}`);
                    } else {
                        console.log(`[${currentTime}] 单词 ${word}（用户 ${userId}）未找到记录，跳过更新`);
                    }
                } catch (error) {
                    console.error(`[${currentTime}] 处理单词 ${word} 时出错：`, error);
                }
            }
        }

        await Promise.all(updatePromises);
        res.status(200).json({
            message: `成功更新 ${updatePromises.length} 个单词的复习计划`,
            updatedWords: updatePromises.length
        });

    } catch (error) {
        const errorTime = getFormattedTime();
        console.error(`[${errorTime}] 批量更新复习记录失败：`, error);
        res.status(500).json({
            error: '服务器内部错误',
            details: error.message
        });
    } finally {
        conn.release();
    }
});    


// 全局错误处理
app.use((err, req, res, next) => {
    console.error('Global error - Uncaught exception:', {
        errorType: err.name,
        message: err.message,
        stack: err.stack,
        timestamp: new Date().toISOString()
    });
    res.status(500).json({ code: 50000, message: 'Internal server error' });
});

// 启动服务
Promise.all([loadRelationshipData(), loadVocabularyData()])
    .then(() => {
        app.listen(port, () => {
            console.log(`Server running at http://localhost:${port}`);
        });
    })
    .catch(error => {
        console.error('Failed to initialize server:', error);
    });