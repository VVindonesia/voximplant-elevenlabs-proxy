// ГОЛОСОВОЙ AI АССИСТЕНТ С GROQ
// Voximplant + STT + Groq LLM + ElevenLabs TTS

// Настройки сервисов
const CONFIG = {
    TTS_SERVER: 'https://voximplant-elevenlabs-proxy.onrender.com',
    GROQ_API: 'https://api.groq.com/openai/v1/chat/completions',
    GROQ_MODEL: 'llama-3.1-70b-versatile', // Быстрая модель
    // Альтернативы: 'mixtral-8x7b-32768', 'llama-3.1-8b-instant'
};

// Главный обработчик звонков
VoxEngine.addEventListener(AppEvents.CallAlerting, (e) => {
    Logger.write("🔥 Новый звонок от: " + e.call.number());
    
    e.call.answer();
    
    // Контекст беседы для каждого звонящего
    const conversationContext = {
        messages: [
            {
                role: "system", 
                content: `Ты профессиональный телефонный помощник российской IT компании. 
                
                Правила:
                - Отвечай КРАТКО (максимум 2-3 предложения)
                - Говори естественно, как живой человек
                - Если не знаешь ответ - честно скажи об этом
                - Будь вежливым но не заискивающим
                - Помогай решать вопросы клиентов
                
                Информация о компании:
                - Занимаемся разработкой ПО и IT-консалтингом
                - Работаем пн-пт с 9 до 18
                - Есть техподдержка и отдел продаж`
            }
        ],
        phoneNumber: e.call.number(),
        callStartTime: new Date()
    };
    
    e.call.addEventListener(CallEvents.Connected, async () => {
        Logger.write("✅ Звонок подключен, запускаем Groq AI ассистента");
        
        // Приветствие
        await speakToUser(e.call, "Здравствуйте! Меня зовут Алиса, я AI помощник нашей компании. Как дела? Чем могу помочь?");
        
        // Запускаем диалог
        startConversation(e.call, conversationContext);
    });
    
    e.call.addEventListener(CallEvents.Disconnected, () => {
        Logger.write("📞 Звонок завершен. Длительность: " + 
            Math.round((new Date() - conversationContext.callStartTime) / 1000) + " сек");
    });
});

// Функция TTS через ElevenLabs
async function speakToUser(call, text) {
    Logger.write("🗣️ AI говорит: " + text);
    
    try {
        const response = await Net.httpRequestAsync(CONFIG.TTS_SERVER + '/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            postData: JSON.stringify({
                text: text,
                provider: 'elevenlabs'
            }),
            timeout: 15000
        });
        
        if (response.code === 200) {
            const result = JSON.parse(response.text);
            if (result.success && result.url) {
                Logger.write("🎵 Воспроизводим: " + result.url);
                
                return new Promise((resolve) => {
                    call.startPlayback(result.url, false);
                    call.addEventListener(CallEvents.PlaybackFinished, () => {
                        resolve();
                    });
                });
            }
        }
        
        throw new Error("TTS failed");
        
    } catch (error) {
        Logger.write("❌ Ошибка TTS: " + error);
        // Fallback на встроенный TTS
        call.say(text, Language.RU_RUSSIAN_FEMALE);
        return Promise.resolve();
    }
}

// Запуск диалогового цикла
function startConversation(call, context) {
    Logger.write("👂 Слушаем пользователя...");
    
    // Запускаем запись с автоматическим распознаванием
    call.record({
        record_on_answer: false,
        stereo: false,
        max_duration: 15000,      // 15 секунд максимум
        silence_timeout: 3000,    // 3 секунды тишины = конец фразы
        transcribe: true,         // Включаем транскрипцию Voximplant
        language: "ru-RU"
    });
    
    // Обработка распознанной речи
    call.addEventListener(CallEvents.RecordStopped, async (e) => {
        Logger.write("🎤 Запись завершена");
        
        if (e.transcription && e.transcription.trim().length > 0) {
            const userText = e.transcription.trim();
            Logger.write("📝 Пользователь: " + userText);
            
            // Проверяем на команды завершения
            if (isGoodbyeMessage(userText)) {
                await speakToUser(call, "Спасибо за обращение! Всего доброго!");
                setTimeout(() => call.hangup(), 2000);
                return;
            }
            
            // Получаем ответ от Groq
            const aiResponse = await getGroqResponse(userText, context);
            
            if (aiResponse) {
                // Говорим ответ
                await speakToUser(call, aiResponse);
                
                // Продолжаем диалог
                setTimeout(() => {
                    startConversation(call, context);
                }, 500);
            } else {
                // Ошибка AI - переспрашиваем
                await speakToUser(call, "Извините, не расслышал. Повторите, пожалуйста?");
                setTimeout(() => {
                    startConversation(call, context);
                }, 1000);
            }
            
        } else {
            Logger.write("⚠️ Речь не распознана");
            await speakToUser(call, "Простите, плохо слышно. Говорите громче, пожалуйста.");
            setTimeout(() => {
                startConversation(call, context);
            }, 1000);
        }
    });
    
    // Обработка ошибок записи
    call.addEventListener(CallEvents.RecordFailed, async (e) => {
        Logger.write("❌ Ошибка записи: " + e.reason);
        await speakToUser(call, "Возникли технические проблемы. Попробуйте позвонить позже.");
        call.hangup();
    });
}

// Запрос к Groq LLM
async function getGroqResponse(userMessage, context) {
    Logger.write("🤖 Отправляем в Groq: " + userMessage);
    
    try {
        // Добавляем сообщение пользователя в контекст
        context.messages.push({
            role: "user",
            content: userMessage
        });
        
        // Ограничиваем историю (последние 10 сообщений)
        if (context.messages.length > 11) {
            context.messages = [
                context.messages[0], // Системное сообщение
                ...context.messages.slice(-10)
            ];
        }
        
        const response = await Net.httpRequestAsync(CONFIG.GROQ_API, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + 'YOUR_GROQ_API_KEY' // Замените на ваш ключ
            },
            postData: JSON.stringify({
                model: CONFIG.GROQ_MODEL,
                messages: context.messages,
                max_tokens: 150,        // Короткие ответы
                temperature: 0.7,      // Немного креативности
                stream: false
            }),
            timeout: 10000
        });
        
        Logger.write("📡 Ответ Groq (код): " + response.code);
        
        if (response.code === 200) {
            const result = JSON.parse(response.text);
            const aiMessage = result.choices[0].message.content.trim();
            
            // Добавляем ответ AI в контекст
            context.messages.push({
                role: "assistant",
                content: aiMessage
            });
            
            Logger.write("🤖 Groq ответил: " + aiMessage);
            return aiMessage;
            
        } else {
            Logger.write("❌ Ошибка Groq API: " + response.text);
            return "Извините, возникла техническая проблема. Можете повторить вопрос?";
        }
        
    } catch (error) {
        Logger.write("❌ Ошибка при обращении к Groq: " + error);
        return "Простите, сейчас есть проблемы с AI. Могу переключить на оператора?";
    }
}

// Проверка на фразы завершения
function isGoodbyeMessage(text) {
    const goodbyePhrases = [
        'спасибо', 'пока', 'до свидания', 'всё', 'хватит', 
        'конец', 'завершить', 'закончить', 'всего доброго'
    ];
    
    const lowerText = text.toLowerCase();
    return goodbyePhrases.some(phrase => lowerText.includes(phrase));
}

// Функция для переключения на оператора
async function transferToOperator(call, reason = "по запросу") {
    Logger.write("👥 Переключение на оператора: " + reason);
    
    await speakToUser(call, "Хорошо, переключаю вас на живого оператора. Один момент.");
    
    // Здесь код для перевода на оператора
    // const operatorCall = VoxEngine.callSIP("operator@company.com");
    // ... логика соединения
    
    // Пока просто информируем
    await speakToUser(call, "К сожалению, все операторы заняты. Оставьте сообщение после сигнала.");
}

// Обработка ошибок
VoxEngine.addEventListener(AppEvents.CallFailed, (e) => {
    Logger.write("❌ Ошибка звонка: " + e.reason);
});

VoxEngine.addEventListener(AppEvents.Terminating, () => {
    Logger.write("🔚 Завершение работы AI ассистента");
});

// Логирование для отладки
function debugLog(stage, data) {
    Logger.write(`[DEBUG ${stage}] ${JSON.stringify(data)}`);
}
