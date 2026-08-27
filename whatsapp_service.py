import os
import requests
import json
from typing import Optional, Dict, Any, List

WHATSAPP_TOKEN = os.getenv("WHATSAPP_TOKEN", "").strip()
WHATSAPP_PHONE_ID = os.getenv("WHATSAPP_PHONE_ID", "1359400923912814").strip()
WHATSAPP_VERIFY_TOKEN = os.getenv("WHATSAPP_VERIFY_TOKEN", "tectum_wa_verify_token_2026").strip()

META_GRAPH_URL = f"https://graph.facebook.com/v22.0/{WHATSAPP_PHONE_ID}/messages"

def _normalize_phone(to_phone: str) -> str:
    clean = "".join(filter(str.isdigit, str(to_phone)))
    return clean

def send_whatsapp_text(to_phone: str, text: str) -> (bool, Optional[str]):
    """
    Отправляет текстовое сообщение в WhatsApp через официальный Cloud API.
    """
    token = os.getenv("WHATSAPP_TOKEN", WHATSAPP_TOKEN).strip()
    phone_id = os.getenv("WHATSAPP_PHONE_ID", WHATSAPP_PHONE_ID).strip()
    
    if not token:
        err = "WHATSAPP_TOKEN не задан в переменных окружения"
        print(f"[WhatsApp Service Error] {err}")
        return False, err
        
    clean_phone = _normalize_phone(to_phone)
    phones_to_try = [clean_phone]
    if clean_phone.startswith("77") and len(clean_phone) == 11:
        phones_to_try.append("78" + clean_phone[1:]) # 787472722804 для тестового режима Meta
    elif clean_phone.startswith("787") and len(clean_phone) == 12:
        phones_to_try.append("7" + clean_phone[2:])
        
    url = f"https://graph.facebook.com/v22.0/{phone_id}/messages"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    last_err = None
    for p in phones_to_try:
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": p,
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
                print(f"[WhatsApp Service] Сообщение успешно доставлено на {p}: {res_data}")
                return True, None
            else:
                last_err = f"Ошибка Meta API ({resp.status_code}): {res_data}"
                print(f"[WhatsApp Service Attempt Error on {p}] {last_err}")
        except Exception as e:
            last_err = str(e)
            print(f"[WhatsApp Service Exception on {p}] {last_err}")
            
    return False, last_err


def send_whatsapp_buttons(to_phone: str, body_text: str, buttons: List[Dict[str, str]], header_text: Optional[str] = None, footer_text: Optional[str] = "Tectum Portal") -> (bool, Optional[str]):
    """
    Отправляет интерактивное сообщение с кнопками (до 3 кнопок).
    """
    token = os.getenv("WHATSAPP_TOKEN", WHATSAPP_TOKEN).strip()
    phone_id = os.getenv("WHATSAPP_PHONE_ID", WHATSAPP_PHONE_ID).strip()
    
    if not token:
        return False, "WHATSAPP_TOKEN не задан"
        
    clean_phone = _normalize_phone(to_phone)
    phones_to_try = [clean_phone]
    if clean_phone.startswith("77") and len(clean_phone) == 11:
        phones_to_try.append("78" + clean_phone[1:])
    elif clean_phone.startswith("787") and len(clean_phone) == 12:
        phones_to_try.append("7" + clean_phone[2:])

    url = f"https://graph.facebook.com/v22.0/{phone_id}/messages"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    formatted_buttons = []
    for b in buttons[:3]:
        formatted_buttons.append({
            "type": "reply",
            "reply": {
                "id": str(b.get("id")),
                "title": str(b.get("title"))[:20]
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
        
    last_err = None
    for p in phones_to_try:
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": p,
            "type": "interactive",
            "interactive": interactive_obj
        }
        try:
            resp = requests.post(url, headers=headers, json=payload, timeout=20)
            res_data = resp.json()
            if resp.status_code in (200, 201):
                print(f"[WhatsApp Service] Кнопки успешно доставлены на {p}: {res_data}")
                return True, None
            else:
                last_err = f"Ошибка кнопок Meta API ({resp.status_code}): {res_data}"
                print(f"[WhatsApp Service Button Error on {p}] {last_err}")
        except Exception as e:
            last_err = str(e)
            
    return False, last_err

