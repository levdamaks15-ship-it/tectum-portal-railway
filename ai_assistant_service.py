import os
import json
import logging
from typing import Generator, List, Dict, Any, Optional
import requests

logger = logging.getLogger("ai_assistant")

KB_FILE_PATH = os.path.join(os.path.dirname(__file__), "data", "kb", "ЭНЦИКЛОПЕДИЯ_РЕГЛАМЕНТОВ_ТЕКТУМ.md")
_KB_CACHE: Optional[str] = None


def get_kb_content() -> str:
    """Загружает и кэширует в памяти текст энциклопедии регламентов Тектум."""
    global _KB_CACHE
    if _KB_CACHE is not None:
        return _KB_CACHE
    
    if os.path.exists(KB_FILE_PATH):
        try:
            with open(KB_FILE_PATH, "r", encoding="utf-8") as f:
                _KB_CACHE = f.read()
                logger.info("База знаний регламентов успешно загружена в память (%d символов)", len(_KB_CACHE))
                return _KB_CACHE
        except Exception as e:
            logger.error("Ошибка чтения базы знаний %s: %s", KB_FILE_PATH, e)
    
    logger.warning("Файл базы знаний не найден по пути: %s", KB_FILE_PATH)
    return ""


SYSTEM_PROMPT_TEMPLATE = """Ты — опытный старший технолог и наставник на заводе хризотилцементных изделий «Тектум».
Твоя задача — помогать мастерам смен, операторам, механикам и руководству быстро и четко разбираться в регламентах, параметрах работы оборудования, устранении дефектов и запуске линии.

ОСНОВНЫЕ ПРАВИЛА ТВОЕЙ РЕЧИ:
1. Говори на обычном, понятном рабочем языке производственника. Без лишней заумной «воды» и пустых канцеляризмов.
2. Отвечай прямо на вопрос. Структурируй ответ:
   - Сразу суть / главный ответ в 1-2 предложениях.
   - Четкие пошаговые действия: что проверить, что подкрутить, куда смотреть.
   - Частые «засады» или на что обратить особое внимание.
3. Используй правильную терминологию завода «Тектум»:
   - Узлы: заготовительное отделение (ЗО), листоформовочная машина (ЛФМ), сетчатые цилиндры, ванны, сукно, нож, стакер, дестакер, автоклавы, пропарочные камеры.
   - Продукция: шифер 8-волновой (рифленый / гладкий), плоский лист, хризотилцементные трубы.
   - Брак и дефекты: скол, царапина, срез, разнотолщинность, залипание, прогиб, бой.
4. Строго опирайся на приведенные ниже регламенты завода «Тектум». Не придумывай несуществующих инструкций. Если точного ответа в регламентах нет, честно скажи об этом и посоветуй обратиться к главному технологу или механику.

--- РЕГЛАМЕНТЫ ЗАВОДА ТЕКТУМ ---
{kb_content}
--------------------------------
"""


def build_system_prompt() -> str:
    kb_text = get_kb_content()
    return SYSTEM_PROMPT_TEMPLATE.format(kb_content=kb_text)


def stream_deepseek_chat(messages: List[Dict[str, str]]) -> Generator[str, None, None]:
    """
    Генерирует синхронный поток частей ответа от DeepSeek API через requests(stream=True).
    Совместимо со StreamingResponse в FastAPI.
    """
    api_key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        yield "⚠️ Ошибка конфигурации: переменная окружения DEEPSEEK_API_KEY не задана на сервере. Пожалуйста, укажите API-ключ в настройках Railway или файле .env."
        return

    system_prompt = build_system_prompt()
    api_messages = [{"role": "system", "content": system_prompt}]
    
    recent_history = messages[-12:]
    for msg in recent_history:
        api_messages.append({
            "role": msg.get("role", "user"),
            "content": msg.get("content", "")
        })

    url = "https://api.deepseek.com/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": "deepseek-chat",
        "messages": api_messages,
        "stream": True,
        "temperature": 0.3,
        "max_tokens": 2048
    }

    try:
        with requests.post(url, headers=headers, json=payload, stream=True, timeout=60) as resp:
            if resp.status_code != 200:
                logger.error("DeepSeek API error %s: %s", resp.status_code, resp.text)
                yield f"⚠️ Ошибка вызова DeepSeek API (код {resp.status_code}). Попробуйте позже или проверьте баланс/ключ."
                return

            for line in resp.iter_lines(decode_unicode=True):
                if not line:
                    continue
                line = line.strip()
                if line.startswith("data: "):
                    data_str = line[6:].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        data_json = json.loads(data_str)
                        delta = data_json.get("choices", [{}])[0].get("delta", {})
                        content_piece = delta.get("content", "")
                        if content_piece:
                            yield content_piece
                    except Exception as parse_err:
                        logger.debug("Пропуск чанка стриминга: %s", parse_err)
    except requests.exceptions.Timeout:
        yield "⚠️ Превышено время ожидания ответа от сервера DeepSeek (таймаут 60 сек). Повторите запрос."
    except Exception as e:
        logger.exception("Исключение при обращении к DeepSeek API: %s", e)
        yield f"⚠️ Произошла сетевая ошибка при обращении к ИИ-ассистенту: {str(e)}"

