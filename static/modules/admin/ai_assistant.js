// static/js/ai_assistant.js - ИИ-Ассистент по регламентам Тектум
let currentAiConversationId = null;
let isAiGenerating = false;

document.addEventListener('DOMContentLoaded', () => {
    // При открытии админки проверяем параметры или инициализируем
});

async function loadAiConversations() {
    const listEl = document.getElementById('ai-conversations-list');
    if (!listEl) return;
    try {
        const resp = await fetch('/api/ai/conversations');
        if (!resp.ok) {
            if (resp.status === 403) {
                listEl.innerHTML = '<div style="padding: 10px; color: #ef4444; font-size: 0.8rem;">Требуются права администратора</div>';
            }
            return;
        }
        const convs = await resp.json();
        renderAiConversationsList(convs);
        if (!currentAiConversationId && convs.length > 0) {
            selectAiConversation(convs[0].id);
        } else if (convs.length === 0) {
            resetAiChatView();
        }
    } catch (e) {
        console.error('Error loading AI conversations:', e);
    }
}


function renderAiConversationsList(convs) {
    const listEl = document.getElementById('ai-conversations-list');
    if (!listEl) return;
    if (!convs || convs.length === 0) {
        listEl.innerHTML = `
            <div style="padding: 1rem; text-align: center; color: #94a3b8; font-size: 0.85rem;">
                <i class="fa-regular fa-comments" style="font-size: 1.5rem; margin-bottom: 0.4rem; display: block; opacity: 0.5;"></i>
                Нет сохраненных диалогов.<br>Задайте вопрос, чтобы начать!
            </div>
        `;
        return;
    }

    let html = '';
    convs.forEach(c => {
        const isActive = c.id === currentAiConversationId;
        const dt = new Date(c.updated_at);
        const timeStr = dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' ' +
                        dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        html += `
            <div class="ai-conv-item ${isActive ? 'active' : ''}" onclick="selectAiConversation(${c.id})" id="conv-item-${c.id}">
                <div style="flex-grow: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    <div class="ai-conv-title" title="${escapeHtml(c.title || 'Диалог')}">${escapeHtml(c.title || 'Новый диалог')}</div>
                    <div class="ai-conv-date">${timeStr}</div>
                </div>
                <button class="ai-conv-del-btn" onclick="deleteAiConversation(event, ${c.id})" title="Удалить диалог">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>
        `;
    });
    listEl.innerHTML = html;
}

async function selectAiConversation(convId) {
    currentAiConversationId = convId;
    document.querySelectorAll('.ai-conv-item').forEach(el => el.classList.remove('active'));
    const item = document.getElementById(`conv-item-${convId}`);
    if (item) item.classList.add('active');

    const messagesBox = document.getElementById('ai-chat-messages');
    if (messagesBox) {
        messagesBox.innerHTML = '<div style="text-align: center; padding: 2rem; color: #94a3b8;"><i class="fa-solid fa-spinner fa-spin"></i> Загрузка диалога...</div>';
    }

    try {
        const resp = await fetch(`/api/ai/conversations/${convId}/messages`);
        if (!resp.ok) throw new Error('Не удалось загрузить историю');
        const msgs = await resp.json();
        renderAiMessages(msgs);
    } catch (e) {
        console.error(e);
        if (messagesBox) {
            messagesBox.innerHTML = `<div style="color: #ef4444; padding: 1rem;">Ошибка загрузки сообщений: ${e.message}</div>`;
        }
    }
}

function renderAiMessages(messages) {
    const messagesBox = document.getElementById('ai-chat-messages');
    if (!messagesBox) return;
    if (!messages || messages.length === 0) {
        resetAiChatView();
        return;
    }

    messagesBox.innerHTML = '';
    messages.forEach(m => {
        appendMessageToUI(m.role, m.content, false);
    });
    scrollAiToBottom();
}

function resetAiChatView() {
    const messagesBox = document.getElementById('ai-chat-messages');
    if (!messagesBox) return;
    messagesBox.innerHTML = `
        <div class="ai-welcome-box">
            <div class="ai-welcome-icon"><i class="fa-solid fa-robot"></i></div>
            <h3>ИИ-Ассистент по регламентам Тектум</h3>
            <p>Задайте любой практический вопрос по технологическому процессу, параметрам ЛФМ, дестакеру, устранению дефектов или регламентам смен.</p>
            <div class="ai-quick-questions">
                <div class="ai-quick-btn" onclick="useQuickQuestion('Какие ключевые действия при подготовке и запуске линии ЛФМ?')">🚀 Подготовка и пуск линии ЛФМ</div>
                <div class="ai-quick-btn" onclick="useQuickQuestion('Какие причины разнотолщинности шифера и как их устранить?')">📏 Причины разнотолщинности листа</div>
                <div class="ai-quick-btn" onclick="useQuickQuestion('Действия оператора при залипании или сбое на дестакере')">⚙️ Сбой и залипание на дестакере</div>
                <div class="ai-quick-btn" onclick="useQuickQuestion('Нормативы расхода сырья на шифер 8-волновой рифленый')">📊 Нормы расхода на 8-волновой шифер</div>
            </div>
        </div>
    `;
}

function startNewAiConversation() {
    currentAiConversationId = null;
    document.querySelectorAll('.ai-conv-item').forEach(el => el.classList.remove('active'));
    resetAiChatView();
    const input = document.getElementById('ai-chat-input');
    if (input) {
        input.value = '';
        input.focus();
    }
}

async function deleteAiConversation(event, convId) {
    if (event) event.stopPropagation();
    if (!confirm('Удалить этот диалог?')) return;

    try {
        const resp = await fetch(`/api/ai/conversations/${convId}`, { method: 'DELETE' });
        if (!resp.ok) throw new Error('Ошибка удаления');
        if (currentAiConversationId === convId) {
            currentAiConversationId = null;
            resetAiChatView();
        }
        await loadAiConversations();
    } catch (e) {
        alert('Не удалось удалить: ' + e.message);
    }
}

function useQuickQuestion(text) {
    const input = document.getElementById('ai-chat-input');
    if (input) {
        input.value = text;
        sendAiMessage();
    }
}

async function sendAiMessage() {
    if (isAiGenerating) return;
    const input = document.getElementById('ai-chat-input');
    const sendBtn = document.getElementById('ai-send-btn');
    if (!input) return;

    const content = input.value.trim();
    if (!content) return;

    // Double-Submit Guard
    isAiGenerating = true;
    input.disabled = true;
    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    }

    // Если был экран приветствия, очищаем
    const welcome = document.querySelector('.ai-welcome-box');
    if (welcome) {
        document.getElementById('ai-chat-messages').innerHTML = '';
    }

    // Рендерим сообщение пользователя
    appendMessageToUI('user', content, true);
    input.value = '';

    // Контейнер для потокового ответа ассистента
    const aiBubbleContent = appendMessageToUI('assistant', '', true);
    let fullText = '';

    try {
        const response = await fetch('/api/ai/chat/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                conversation_id: currentAiConversationId,
                content: content
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({ detail: response.statusText }));
            throw new Error(errData.detail || 'Ошибка сервера при запросе к ИИ');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Оставляем неполную строку

            let currentEvent = null;
            for (let line of lines) {
                line = line.trim();
                if (!line) continue;
                if (line.startsWith('event: ')) {
                    currentEvent = line.substring(7).trim();
                    continue;
                }
                if (line.startsWith('data: ')) {
                    const dataStr = line.substring(6).trim();
                    if (dataStr === '[DONE]') {
                        break;
                    }
                    try {
                        const parsed = JSON.parse(dataStr);
                        if (currentEvent === 'conv_id' && parsed.conversation_id) {
                            currentAiConversationId = parsed.conversation_id;
                        } else if (parsed.chunk) {
                            fullText += parsed.chunk;
                            aiBubbleContent.innerHTML = formatMarkdownText(fullText);
                            scrollAiToBottom();
                        }
                    } catch (pe) {
                        // Plain text fallback
                        if (dataStr !== '[DONE]') {
                            fullText += dataStr;
                            aiBubbleContent.innerHTML = formatMarkdownText(fullText);
                            scrollAiToBottom();
                        }
                    }
                }
            }
        }

        if (!fullText) {
            aiBubbleContent.innerHTML = '<span style="color: #94a3b8; font-style: italic;">Ответ не получен</span>';
        }

        // Обновляем список диалогов слева
        loadAiConversations();
    } catch (e) {
        console.error('AI chat error:', e);
        aiBubbleContent.innerHTML = `<span style="color: #ef4444;"><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(e.message)}</span>`;
    } finally {
        isAiGenerating = false;
        input.disabled = false;
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i>';
        }
        input.focus();
        scrollAiToBottom();
    }
}

function appendMessageToUI(role, text, shouldScroll = true) {
    const messagesBox = document.getElementById('ai-chat-messages');
    if (!messagesBox) return null;

    const row = document.createElement('div');
    row.className = `ai-msg-row ${role === 'user' ? 'user-row' : 'ai-row'}`;

    const iconHtml = role === 'user'
        ? '<div class="ai-avatar user-avatar"><i class="fa-solid fa-user"></i></div>'
        : '<div class="ai-avatar ai-bot-avatar"><i class="fa-solid fa-robot"></i></div>';

    const bubble = document.createElement('div');
    bubble.className = `ai-msg-bubble ${role === 'user' ? 'user-bubble' : 'ai-bubble'}`;
    
    const contentEl = document.createElement('div');
    contentEl.className = 'ai-msg-text';
    contentEl.innerHTML = text ? formatMarkdownText(text) : '<span class="ai-typing-cursor">▋</span>';

    bubble.appendChild(contentEl);

    if (role === 'user') {
        row.appendChild(bubble);
        row.appendChild(document.createRange().createContextualFragment(iconHtml));
    } else {
        row.appendChild(document.createRange().createContextualFragment(iconHtml));
        row.appendChild(bubble);
    }

    messagesBox.appendChild(row);
    if (shouldScroll) scrollAiToBottom();
    return contentEl;
}

function scrollAiToBottom() {
    const messagesBox = document.getElementById('ai-chat-messages');
    if (messagesBox) {
        messagesBox.scrollTop = messagesBox.scrollHeight;
    }
}

function formatMarkdownText(raw) {
    if (!raw) return '';
    let text = escapeHtml(raw);

    // Жирный текст **текст**
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // Курсив *текст*
    text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // Блоки кода или моноширинные фрагменты `код`
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Нумерованные и маркированные списки
    text = text.replace(/^(\d+)\.\s+(.*)$/gm, '<div class="ai-list-item"><span class="ai-num">$1.</span> $2</div>');
    text = text.replace(/^[-•*]\s+(.*)$/gm, '<div class="ai-list-item"><span class="ai-bullet">•</span> $1</div>');

    // Переносы строк
    text = text.replace(/\n\n/g, '<div style="height: 0.6rem;"></div>');
    text = text.replace(/\n/g, '<br>');

    return text;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
