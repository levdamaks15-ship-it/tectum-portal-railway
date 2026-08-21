import os
import sys
import io
import json
import time
import urllib.request
import urllib.error

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def test_gemini_api(api_key: str = None):
    if not api_key:
        from dotenv import load_dotenv
        load_dotenv()
        api_key = os.getenv("GEMINI_API_KEY")

    if not api_key:
        print("❌ ОШИБКА: GEMINI_API_KEY не найден в переменных окружения / .env файле.")
        return

    masked_key = f"{api_key[:6]}...{api_key[-4:]}"
    print(f"🔑 Проверяем ключ: {masked_key}\n")

    # 1. Запрашиваем список всех доступных моделей аккаунта
    print("1️⃣ Получение актуального списка Flash-моделей из вашего аккаунта...")
    list_url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
    
    available_models = []
    try:
        req = urllib.request.Request(list_url)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            models_list = data.get("models", [])
            for m in models_list:
                name = m.get("name", "").replace("models/", "")
                methods = m.get("supportedGenerationMethods", [])
                if "generateContent" in methods and "flash" in name.lower() and not any(x in name for x in ["tts", "image"]):
                    available_models.append(name)
            print(f"   Активные Flash-модели для текста: {available_models}\n")
    except Exception as e:
        print(f"   ⚠️ Не удалось получить список моделей: {e}\n")

    candidate_models = available_models if available_models else [
        "gemini-2.5-flash",
        "gemini-flash-latest",
        "gemini-2.5-flash-lite",
        "gemini-3.5-flash",
        "gemini-3.7-flash"
    ]

    test_prompt = "Ты классификатор поломок завода Tectum. Текст: 'Ковшевая мишалка заклинело на ЗО'. Ответь строго в JSON: {\"department\": \"Заготовительное отделение (ЗО)\", \"node\": \"Ковшевая мешалка\", \"category\": \"Механические\"}"

    print("2️⃣ Тестирование генерации и скорости актуальных моделей:")
    print("----------------------------------------------------------------------")
    working_models = []

    for model_name in candidate_models:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
        payload = {
            "contents": [{"parts": [{"text": test_prompt}]}],
            "generationConfig": {
                "temperature": 0.1,
                "responseMimeType": "application/json"
            }
        }
        
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )

        t_start = time.time()
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                elapsed = time.time() - t_start
                data = json.loads(resp.read().decode("utf-8"))
                text_out = data["candidates"][0]["content"]["parts"][0]["text"].strip()
                
                # Проверяем валидность JSON
                if text_out.startswith("```"):
                    import re
                    text_out = re.sub(r"^```(?:json)?\s*", "", text_out)
                    text_out = re.sub(r"\s*```$", "", text_out)
                parsed = json.loads(text_out)
                
                print(f"✅ Модель: {model_name:<30} | Время: {elapsed:.2f} сек | Результат: {parsed}")
                working_models.append((model_name, elapsed))
        except urllib.error.HTTPError as http_err:
            err_body = http_err.read().decode("utf-8", errors="ignore")
            print(f"❌ Модель: {model_name:<30} | Ошибка {http_err.code}: {err_body[:100]}...")
        except Exception as ex:
            print(f"❌ Модель: {model_name:<30} | Ошибка: {str(ex)[:100]}")

    print("----------------------------------------------------------------------")
    if working_models:
        working_models.sort(key=lambda x: x[1])
        fastest = working_models[0]
        print(f"\n🏆 САМАЯ БЫСТРАЯ РАБОЧАЯ МОДЕЛЬ: '{fastest[0]}' ({fastest[1]:.2f} сек)")
        print(f"📋 Все проверенные рабочие модели: {[m[0] for m in working_models]}")
    else:
        print("\n⚠️ Ни одна модель не ответила успешно.")

if __name__ == "__main__":
    key_arg = sys.argv[1] if len(sys.argv) > 1 else None
    test_gemini_api(key_arg)
