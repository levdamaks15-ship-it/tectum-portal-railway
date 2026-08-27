import os
import requests
import json
from typing import Optional, Dict, Any, List

WHATSAPP_TOKEN = os.getenv("WHATSAPP_TOKEN", "").strip()
WHATSAPP_PHONE_ID = os.getenv("WHATSAPP_PHONE_ID", "1359400923912814").strip()
WHATSAPP_VERIFY_TOKEN = os.getenv("WHATSAPP_VERIFY_TOKEN", "tectum_wa_verify_token_2026").strip()

META_GRAPH_URL = f"https://graph.facebook.com/v22.0/{WHATSAPP_PHONE_ID}/messages"

def send_whatsapp_text(to_phone: str, text: str) -> (bool, Optional[str]):
    """
    Отправляет текстовое сообщение в WhatsApp через официальный Cloud API.
    to_phone: номер телефона в международном формате без плюса, например '77472722804'
    """
    token = os.getenv("WHATSAPP_TOKEN", WHATSAPP_TOKEN).strip()
    phone_id = os.getenv("WHATSAPP_PHONE_ID", WHATSAPP_PHONE_ID).strip()
    
    if not token:
        err = "WHATSAPP_TOKEN не задан в переменных окружения"
        print(f"[WhatsApp Service Error] {err}")
        return False, err
        
    # Очищаем номер от плюсов, пробелов и скобок
    clean_phone = "".join(filter(str.isdigit, str(to_phone)))
    
    url = f"https://graph.facebook.com/v22.0/{phone_id}/messages"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": clean_phone,
        "type": "text",
        "text": {
            "preview_url": True,
            "body": text
        }
    }
    
    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=20)
        res_data = resp.json()
        if resp.status_code in (200, 201):
            print(f"[WhatsApp Service] Сообщение успешно отправлено на {clean_phone}: {res_data}")
            return True, None
        else:
            err = f"Ошибка Meta API ({resp.status_code}): {res_data}"
            print(f"[WhatsApp Service Error] {err}")
            return False, err
    except Exception as e:
        err = f"Исключение при отправке WhatsApp: {str(e)}"
        print(f"[WhatsApp Service Exception] {err}")
        return False, err


def send_whatsapp_buttons(to_phone: str, body_text: str, buttons: List[Dict[str, str]], header_text: Optional[str] = None, footer_text: Optional[str] = "Tectum Portal") -> (bool, Optional[str]):
    """
    Отправляет интерактивное сообщение с кнопками (до 3 кнопок).
    buttons: [{'id': 'btn_done_12', 'title': '✅ Выполнено'}, {'id': 'btn_help', 'title': 'Помощь'}]
    """
    token = os.getenv("WHATSAPP_TOKEN", WHATSAPP_TOKEN).strip()
    phone_id = os.getenv("WHATSAPP_PHONE_ID", WHATSAPP_PHONE_ID).strip()
    
    if not token:
        return False, "WHATSAPP_TOKEN не задан"
        
    clean_phone = "".join(filter(str.isdigit, str(to_phone)))
    url = f"https://graph.facebook.com/v22.0/{phone_id}/messages"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    formatted_buttons = []
    for b in buttons[:3]: # Meta разрешает максимум 3 кнопки в одном сообщении
        formatted_buttons.append({
            "type": "reply",
            "reply": {
                "id": str(b.get("id")),
                "title": str(b.get("title"))[:20] # Максимум 20 символов на название кнопки
            }
        })
        
    interactive_obj = {
        "type": "button",
        "body": {"text": body_text},
        "action": {"buttons": formatted_buttons}
    }
    
    if header_text:
        interactive_obj["header"] = {"type": "text", "text": header_text[:60]}
    if footer_text:
        interactive_obj["footer"] = {"text": footer_text[:60]}
        
    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": clean_phone,
        "type": "interactive",
        "interactive": interactive_obj
    }
    
    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=20)
        res_data = resp.json()
        if resp.status_code in (200, 201):
            return True, None
        else:
            err = f"Ошибка кнопок Meta API ({resp.status_code}): {res_data}"
            print(f"[WhatsApp Service Error] {err}")
            return False, err
    except Exception as e:
        return False, str(e)
