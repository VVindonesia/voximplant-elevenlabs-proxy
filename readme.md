# Voximplant + ElevenLabs TTS Proxy

Прокси сервер для использования ElevenLabs TTS в Voximplant.

## Использование в VoxEngine

```javascript
const response = await Net.httpRequestAsync('https://your-app.onrender.com/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    postData: JSON.stringify({
        text: 'Привет, это тест'
    })
});

const result = JSON.parse(response.text);
if (result.success) {
    call.startPlayback(result.url);
}
