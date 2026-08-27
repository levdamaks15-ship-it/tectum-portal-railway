import os
import requests
from typing import Optional, Dict, Any, List

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "8980370531:AAGGhgbRH04LT_KOMUHr02ms1X4wZ0b3LwY").strip()
TELEGRAM_API_URL = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}"

def get_main_reply_keyboard() -> Dict[str, Any]:
    """
    Постоянная клавиатура внизу экрана (Reply Keyboard).
    """
    return {
        "keyboard": [
            [
                {"text": "📊 Сводка за сегодня"},
                {"text": "📌 Активные задачи"}
            ],
            [
                {"text": "🎯 План-факт (Месяц)"},
                {"text": "⏱ Простои линий"}
            ],
            [
                {"text": "📦 Остатки сырья"},
                {"text": "🌐 Портал завода"}
            ]
        ],
        "resize_keyboard": True,
        "is_persistent": True
    }


def send_telegram_message(
    chat_id: str | int, 
    text: str, 
    reply_markup: Optional[Dict[str, Any]] = None,
    parse_mode: str = "HTML"
) -> (bool, Optional[str]):
    """
    Отправляет текстовое сообщение в Telegram (в группу или личный чат).
    """
    token = os.getenv("TELEGRAM_BOT_TOKEN", TELEGRAM_BOT_TOKEN).strip()
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": parse_mode,
        "disable_web_page_preview": False
    }
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
        
    try:
        resp = requests.post(url, json=payload, timeout=15)
        res_data = resp.json()
        if res_data.get("ok"):
            return True, None
        else:
            err = f"Telegram API Error: {res_data.get('description')}"
            print(f"[Telegram Service Error] {err}")
            return False, err
    except Exception as e:
        err = f"Telegram Request Exception: {str(e)}"
        print(f"[Telegram Service Exception] {err}")
        return False, err


def send_telegram_task_card(
    chat_id: str | int,
    task_code: str,
    title: str,
    assignee_name: str,
    due_date_str: str,
    author_name: Optional[str] = None
) -> (bool, Optional[str]):
    """
    Отправляет красивую карточку задачи с инлайн-кнопками.
    """
    text = (
        f"📌 <b>Новая задача в Планнере Tectum!</b>\n\n"
        f"🛠 <b>Задача:</b> {title}\n"
        f"🔢 <b>Код:</b> <code>{task_code or 'Без кода'}</code>\n"
        f"👤 <b>Исполнитель:</b> {assignee_name or 'Не назначен'}\n"
        f"⏰ <b>Срок выполнения:</b> {due_date_str or '—'}\n"
    )
    if author_name:
        text += f"✍️ <b>Постановщик:</b> {author_name}\n"
        
    keyboard = {
        "inline_keyboard": [
            [
                {"text": "📋 Открыть в Планнере", "url": "https://tectum-portal-railway-production.up.railway.app/tasks"}
            ]
        ]
    }
    return send_telegram_message(chat_id, text, reply_markup=keyboard, parse_mode="HTML")
