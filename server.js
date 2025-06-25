require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use('/audio', express.static('public'));

// Создаем папку для аудио файлов
if (!fs.existsSync('public')) {
    fs.mkdirSync('public');
}

// Edge TTS endpoint (бесплатный Microsoft TTS)
app.post('/tts/edge', async (req, res) => {
    try {
        const { text, voice = 'en-US-AriaNeural', rate = '0%', pitch = '0Hz' } = req.body;
        
        if (!text) {
            return res.status(400).json({ error: 'Text is required' });
        }

        console.log('Generating speech with Edge TTS...');
        
        // Создаем уникальное имя файла
        const filename = `tts_edge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp3`;
        const filepath = path.join(__dirname, 'public', filename);
        
        // Используем edge-tts команду
        const command = `echo "${text.replace(/"/g, '\\"')}" | edge-tts --voice "${voice}" --rate="${rate}" --pitch="${pitch}" --write-media "${filepath}"`;
        
        await new Promise((resolve, reject) => {
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    console.error('Edge TTS Error:', error);
                    reject(error);
                } else {
                    resolve();
                }
            });
        });

        // Проверяем, что файл создался
        if (!fs.existsSync(filepath)) {
            throw new Error('Failed to generate audio file');
        }

        // Возвращаем URL
        const audioUrl = `https://${req.get('host')}/audio/${filename}`;
        
        res.json({ 
            success: true,
            url: audioUrl,
            filename: filename,
            provider: 'edge-tts'
        });

        // Удаляем файл через 10 минут
        setTimeout(() => {
            fs.unlink(filepath, (err) => {
                if (err) console.error('Error deleting file:', err);
            });
        }, 10 * 60 * 1000);

    } catch (error) {
        console.error('Edge TTS Error:', error);
        res.status(500).json({ 
            error: 'Edge TTS generation failed',
            details: error.message
        });
    }
});

// OpenAI TTS endpoint
app.post('/tts/openai', async (req, res) => {
    try {
        const { text, voice = 'alloy', model = 'tts-1' } = req.body;
        
        if (!text) {
            return res.status(400).json({ error: 'Text is required' });
        }

        if (!process.env.OPENAI_API_KEY) {
            return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
        }

        console.log('Making request to OpenAI TTS...');
        
        const response = await axios({
            method: 'POST',
            url: 'https://api.openai.com/v1/audio/speech',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            data: {
                model: model,
                input: text,
                voice: voice,
                response_format: 'mp3'
            },
            responseType: 'arraybuffer',
            timeout: 30000
        });

        const filename = `tts_openai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp3`;
        const filepath = path.join(__dirname, 'public', filename);
        
        fs.writeFileSync(filepath, response.data);

        const audioUrl = `https://${req.get('host')}/audio/${filename}`;
        
        res.json({ 
            success: true,
            url: audioUrl,
            filename: filename,
            provider: 'openai'
        });

        setTimeout(() => {
            fs.unlink(filepath, (err) => {
                if (err) console.error('Error deleting file:', err);
            });
        }, 10 * 60 * 1000);

    } catch (error) {
        console.error('OpenAI TTS Error:', error.response?.data || error.message);
        res.status(500).json({ 
            error: 'OpenAI TTS generation failed',
            details: error.response?.data || error.message
        });
    }
});

// ElevenLabs TTS endpoint
app.post('/tts/elevenlabs', async (req, res) => {
    try {
        const { text, voice_id = 'pNInz6obpgDQGcFmaJgB' } = req.body;
        
        if (!text) {
            return res.status(400).json({ error: 'Text is required' });
        }

        if (!process.env.ELEVEN_API_KEY) {
            return res.status(500).json({ error: 'ELEVEN_API_KEY not configured' });
        }

        // Массив разных User-Agent для маскировки
        const userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15'
        ];

        const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
        
        // Добавляем случайные задержки для имитации человека
        await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));

        console.log('Making request to Eleven Labs directly...');

        // Прямой запрос к Eleven Labs API
        const response = await axios({
            method: 'POST',
            url: `https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`,
            headers: {
                'Accept': 'audio/mpeg',
                'Content-Type': 'application/json',
                'xi-api-key': process.env.ELEVEN_API_KEY,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            data: {
                text: text,
                model_id: 'eleven_monolingual_v1',
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.5
                }
            },
            responseType: 'arraybuffer',
            timeout: 30000
        });

        const filename = `tts_eleven_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp3`;
        const filepath = path.join(__dirname, 'public', filename);
        
        fs.writeFileSync(filepath, response.data);

        const audioUrl = `https://${req.get('host')}/audio/${filename}`;
        
        res.json({ 
            success: true,
            url: audioUrl,
            filename: filename,
            provider: 'elevenlabs'
        });

        setTimeout(() => {
            fs.unlink(filepath, (err) => {
                if (err) console.error('Error deleting file:', err);
            });
        }, 10 * 60 * 1000);

    } catch (error) {
        console.error('ElevenLabs TTS Error:', error.response?.data || error.message);
        res.status(500).json({ 
            error: 'ElevenLabs TTS generation failed',
            details: error.response?.data || error.message
        });
    }
});

// Универсальный TTS endpoint
app.post('/tts', async (req, res) => {
    const { text, provider = 'auto', voice } = req.body;
    
    if (!text) {
        return res.status(400).json({ error: 'Text is required' });
    }

    // Автоматический выбор: Edge TTS (всегда работает) > OpenAI > ElevenLabs
    let selectedProvider = provider;
    if (provider === 'auto') {
        selectedProvider = 'edge';  // Edge TTS как приоритет
    }

    console.log(`Using TTS provider: ${selectedProvider}`);

    try {
        if (selectedProvider === 'edge') {
            return await edgeTTSHandler(req, res);
        } else if (selectedProvider === 'openai' && process.env.OPENAI_API_KEY) {
            return await openaiTTSHandler(req, res);
        } else if (selectedProvider === 'elevenlabs' && process.env.ELEVEN_API_KEY) {
            // Eleven Labs заблокирован в Турции, возвращаем ошибку
            return res.status(503).json({ 
                error: 'ElevenLabs not available from this region',
                suggestion: 'Use Edge TTS instead'
            });
        } else {
            return res.status(400).json({ error: 'No valid TTS provider available' });
        }
    } catch (error) {
        console.error('TTS routing error:', error);
        res.status(500).json({ error: 'TTS routing failed', details: error.message });
    }
});

// Вспомогательные функции для обработки
async function edgeTTSHandler(req, res) {
    const { text, voice = 'en-US-AriaNeural' } = req.body;
    
    try {
        const filename = `tts_edge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp3`;
        const filepath = path.join(__dirname, 'public', filename);
        
        const command = `echo "${text.replace(/"/g, '\\"')}" | edge-tts --voice "${voice}" --write-media "${filepath}"`;
        
        await new Promise((resolve, reject) => {
            exec(command, (error) => {
                if (error) reject(error);
                else resolve();
            });
        });

        if (!fs.existsSync(filepath)) {
            throw new Error('Failed to generate audio file');
        }

        const audioUrl = `https://${req.get('host')}/audio/${filename}`;
        
        res.json({ 
            success: true,
            url: audioUrl,
            filename: filename,
            provider: 'edge-tts'
        });

        setTimeout(() => {
            fs.unlink(filepath, (err) => {
                if (err) console.error('Error deleting file:', err);
            });
        }, 10 * 60 * 1000);

    } catch (error) {
        throw error;
    }
}

async function openaiTTSHandler(req, res) {
    // Реализация OpenAI (аналогично выше)
    throw new Error('OpenAI handler not implemented in routing');
}

async function elevenLabsTTSHandler(req, res) {
    // Реализация ElevenLabs (аналогично выше)
    throw new Error('ElevenLabs handler not implemented in routing');
}

// Health check
app.get('/health', (req, res) => {
    const providers = ['edge-tts']; // Edge TTS всегда доступен
    if (process.env.OPENAI_API_KEY) providers.push('openai');
    if (process.env.ELEVEN_API_KEY) providers.push('elevenlabs');
    
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        providers: providers,
        default: 'edge-tts'
    });
});

// Список доступных голосов
app.get('/voices', (req, res) => {
    const voices = {
        'edge-tts': [
            { id: 'en-US-AriaNeural', name: 'Aria (English US)', gender: 'female' },
            { id: 'en-US-JennyNeural', name: 'Jenny (English US)', gender: 'female' },
            { id: 'en-US-GuyNeural', name: 'Guy (English US)', gender: 'male' },
            { id: 'en-GB-SoniaNeural', name: 'Sonia (English UK)', gender: 'female' },
            { id: 'ru-RU-SvetlanaNeural', name: 'Svetlana (Russian)', gender: 'female' }
        ],
        openai: [
            { id: 'alloy', name: 'Alloy', gender: 'neutral' },
            { id: 'echo', name: 'Echo', gender: 'male' },
            { id: 'fable', name: 'Fable', gender: 'male' },
            { id: 'onyx', name: 'Onyx', gender: 'male' },
            { id: 'nova', name: 'Nova', gender: 'female' },
            { id: 'shimmer', name: 'Shimmer', gender: 'female' }
        ],
        elevenlabs: [
            { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', gender: 'male' },
            { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', gender: 'female' },
            { id: 'VR6AewLTigWG4xSOukaG', name: 'Antoni', gender: 'male' }
        ]
    };
    
    res.json(voices);
});

// Добавить в конец файла server.js перед app.listen()
app.post('/chat', async (req, res) => {
    try {
        const { messages } = req.body;
        
        const response = await axios({
            method: 'POST',
            url: 'https://api.groq.com/openai/v1/chat/completions',
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            data: {
                model: 'llama-3.1-8b-instant',
                messages: messages,
                max_tokens: 150,
                temperature: 0.7
            }
        });
        
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`TTS Proxy server running on port ${PORT}`);
    console.log('Available providers:');
    console.log('- Edge TTS (Microsoft) - FREE');
    if (process.env.OPENAI_API_KEY) console.log('- OpenAI TTS');
    if (process.env.ELEVEN_API_KEY) console.log('- ElevenLabs TTS');
});
