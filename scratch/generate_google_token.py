import os
from google_auth_oauthlib.flow import InstalledAppFlow

# Этот скрипт нужен только для единоразового получения REFRESH_TOKEN
# Для работы потребуется скачать client_secrets.json из Google Cloud Console (тип: Desktop App)

SCOPES = ["https://www.googleapis.com/auth/drive"]

def get_refresh_token():
    if not os.path.exists("client_secrets.json"):
        print("ОШИБКА: Файл client_secrets.json не найден в текущей папке.")
        print("Пожалуйста, скачайте его из Google Cloud Console (APIs & Services -> Credentials -> OAuth 2.0 Client IDs -> Desktop App)")
        return

    print("Запускаем процесс авторизации...")
    # Откроется браузер для входа в ваш Google аккаунт
    flow = InstalledAppFlow.from_client_secrets_file("client_secrets.json", SCOPES)
    
    # Нам нужен оффлайн доступ, чтобы получить refresh token
    creds = flow.run_local_server(port=0, prompt='consent', access_type='offline')

    print("\n" + "="*50)
    print("УСПЕШНО! Вот ваши переменные для Railway:")
    print("="*50)
    
    print(f"GOOGLE_CLIENT_ID={creds.client_id}")
    print(f"GOOGLE_CLIENT_SECRET={creds.client_secret}")
    print(f"GOOGLE_REFRESH_TOKEN={creds.refresh_token}")
    
    print("="*50)
    if not creds.refresh_token:
        print("ВНИМАНИЕ: Refresh Token не получен! Если вы уже авторизовывались ранее, вам нужно зайти в настройки безопасности Google, удалить доступ для этого приложения и запустить скрипт заново.")

if __name__ == "__main__":
    get_refresh_token()
