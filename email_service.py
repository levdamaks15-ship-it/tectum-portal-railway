import os
import smtplib
import socket
import requests
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional, Dict, Any

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
RESEND_FROM = os.getenv("RESEND_FROM", "Tectum Planner <onboarding@resend.dev>")

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "").replace(" ", "")
SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "Tectum Планнер")
PORTAL_URL = os.getenv("PORTAL_URL", "https://tectum-portal-railway-production.up.railway.app/tasks")

def _force_ipv4_socket():
    """
    На Railway и некоторых облачных платформах IPv6 недоступен.
    Принудительно перенаправляем socket.getaddrinfo на AF_INET (IPv4).
    """
    old_getaddrinfo = socket.getaddrinfo
    def getaddrinfo_ipv4(*args, **kwargs):
        if len(args) >= 3 and args[2] == 0:
            args = (args[0], args[1], socket.AF_INET) + args[3:]
        elif len(args) == 2:
            args = (args[0], args[1], socket.AF_INET)
        return old_getaddrinfo(*args, **kwargs)
    return getaddrinfo_ipv4

def send_task_html_email(
    to_email: str,
    subject: str,
    event_type: str,
    task_data: Dict[str, Any]
) -> (bool, Optional[str]):
    """
    Отправляет красивое брендированное HTML-письмо с уведомлением по задаче.
    В первую очередь использует Resend HTTPS API (порт 443, без блокировок фаерволами).
    При отсутствии Resend переключается на SMTP.
    """
    if not to_email or "@" not in to_email:
        err = f"Некорректный email получателя: '{to_email}'"
        print(f"[Email Service] {err}")
        return False, err

    text_content = _build_plain_text(event_type, task_data)
    html_content = _build_html_template(event_type, task_data)

    # 1. Отправка через Resend HTTPS API (Самый надежный способ для Railway)
    resend_key = os.getenv("RESEND_API_KEY", RESEND_API_KEY)
    if resend_key and resend_key.startswith("re_"):
        try:
            from_sender = os.getenv("RESEND_FROM", RESEND_FROM)
            reply_to_addr = os.getenv("REPLY_TO_EMAIL", "levdamaks15@gmail.com")
            task_id = task_data.get("id", "general")
            
            payload = {
                "from": from_sender,
                "to": [to_email.strip()],
                "reply_to": reply_to_addr,
                "subject": subject,
                "html": html_content,
                "text": text_content,
                "headers": {
                    "X-Entity-Ref-ID": f"tectum-task-{task_id}",
                    "Auto-Submitted": "auto-generated",
                    "X-Auto-Response-Suppress": "All"
                }
            }
            resp = requests.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {resend_key.strip()}",
                    "Content-Type": "application/json"
                },
                json=payload,
                timeout=10
            )

            if resp.status_code in [200, 201]:
                print(f"[Email Service Success: Resend API] Письмо успешно отправлено на {to_email}!")
                return True, None
            else:
                resp_json = resp.json() if resp.content else {}
                err_msg = resp_json.get("message") or resp.text
                print(f"[Email Service Warning: Resend API] Ошибка ({resp.status_code}): {err_msg}")
                # Если в Resend ошибка, пробуем запасной SMTP
        except Exception as ex:
            print(f"[Email Service Warning: Resend Exception] {ex}")

    # 2. Запасной путь: отправка через классический SMTP
    smtp_user = os.getenv("SMTP_USER", SMTP_USER)
    smtp_pass = os.getenv("SMTP_PASSWORD", SMTP_PASSWORD).replace(" ", "")
    smtp_host = os.getenv("SMTP_HOST", SMTP_HOST)
    smtp_port = int(os.getenv("SMTP_PORT", SMTP_PORT))
    from_name = os.getenv("SMTP_FROM_NAME", SMTP_FROM_NAME)

    if not smtp_user or not smtp_pass:
        return False, "Не удалось отправить: проверьте RESEND_API_KEY или SMTP_USER/SMTP_PASSWORD"

    # Включаем принудительный IPv4 резолвинг для обхода ограничений сети Railway
    original_getaddrinfo = socket.getaddrinfo
    socket.getaddrinfo = _force_ipv4_socket()

    ports_to_try = [smtp_port]
    # Если порт 587, запасной - 465, и наоборот
    if smtp_port == 587 and 465 not in ports_to_try:
        ports_to_try.append(465)
    elif smtp_port == 465 and 587 not in ports_to_try:
        ports_to_try.append(587)

    last_err = None
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{from_name} <{smtp_user}>"
        msg["To"] = to_email

        # Генерация текстовой и HTML версии
        text_content = _build_plain_text(event_type, task_data)
        html_content = _build_html_template(event_type, task_data)

        msg.attach(MIMEText(text_content, "plain", "utf-8"))
        msg.attach(MIMEText(html_content, "html", "utf-8"))

        for port in ports_to_try:
            try:
                if port == 465:
                    # SSL соединение
                    with smtplib.SMTP_SSL(smtp_host, port, timeout=12) as server:
                        server.login(smtp_user, smtp_pass)
                        server.sendmail(smtp_user, [to_email], msg.as_string())
                else:
                    # STARTTLS соединение
                    with smtplib.SMTP(smtp_host, port, timeout=12) as server:
                        server.ehlo()
                        server.starttls()
                        server.ehlo()
                        server.login(smtp_user, smtp_pass)
                        server.sendmail(smtp_user, [to_email], msg.as_string())

                print(f"[Email Service Success] Письмо успешно отправлено на {to_email} через порт {port} (Событие: {event_type})")
                return True, None

            except Exception as e:
                last_err = e
                print(f"[Email Service Debug] Попытка через порт {port} не удалась: {e}")
                continue

        err = f"Ошибка SMTP: {str(last_err)}"
        print(f"[Email Service Error] Все порты {ports_to_try} завершились ошибкой: {err}")
        return False, err

    finally:
        socket.getaddrinfo = original_getaddrinfo




def _build_plain_text(event_type: str, d: Dict[str, Any]) -> str:
    title = d.get("title", "")
    title_kz = d.get("title_kz", "")
    zone = d.get("zone", "Бережливое производство")
    due_date = d.get("due_date_str", "—")
    author = d.get("author_name", "—")
    assignee = d.get("assignee_name", "—")
    status = d.get("status", "—")
    comment = d.get("comment", "")
    photo = d.get("photo_link", "")
    week = d.get("week_label", "")
    month = d.get("month_label", "")

    lines = [
        f"TECTUM ENGINEERING — ПЛАННЕР ЗАДАЧ",
        f"Событие: {event_type}",
        f"--------------------------------------------------",
        f"Задача: {title}",
    ]
    if title_kz:
        lines.append(f"Задача (KZ): {title_kz}")
    lines.extend([
        f"Зона: {zone}",
        f"Период: {month} / {week}",
        f"Срок: {due_date}",
        f"Исполнитель: {assignee}",
        f"Автор задачи: {author}",
        f"Статус: {status}",
    ])
    if comment:
        lines.append(f"Факт / Результат: {comment}")
    if photo:
        lines.append(f"Фото: {photo}")
    lines.extend([
        f"--------------------------------------------------",
        f"Открыть Планнер: {PORTAL_URL}"
    ])
    return "\n".join(lines)


def _build_html_template(event_type: str, d: Dict[str, Any]) -> str:
    title = d.get("title", "—")
    title_kz = d.get("title_kz", "")
    code = d.get("code", "TSK")
    zone = d.get("zone", "Бережливое производство")
    due_date = d.get("due_date_str", "—")
    author = d.get("author_name", "—")
    assignee = d.get("assignee_name", "—")
    status = d.get("status", "—")
    comment = d.get("comment", "")
    photo = d.get("photo_link", "")
    week = d.get("week_label", "")
    month = d.get("month_label", "")

    # Цветовой акцент события
    if "выполнено" in event_type.lower():
        badge_bg = "#dcfce7"
        badge_color = "#15803d"
        badge_icon = "🟢"
        header_sub = "Задача успешно завершена и сдана"
    elif "перенесено" in event_type.lower():
        badge_bg = "#e0e7ff"
        badge_color = "#4338ca"
        badge_icon = "🔵"
        header_sub = "Срок задачи перенесен на следующую неделю"
    else:
        badge_bg = "#fef3c7"
        badge_color = "#b45309"
        badge_icon = "📌"
        header_sub = "Вам назначена новая задача"

    html = f"""<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{event_type}</title>
</head>
<body style="margin:0; padding:0; background-color:#f1f5f9; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f1f5f9; padding:24px 12px;">
    <tr>
      <td align="center">
        <!-- Main Card -->
        <table role="presentation" width="100%" style="max-width:580px; background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 12px rgba(0,0,0,0.06); border:1px solid #e2e8f0;" cellspacing="0" cellpadding="0">
          
          <!-- Header Banner -->
          <tr>
            <td style="background-color:#0f172a; padding:22px 28px; text-align:left;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <div style="font-size:11px; font-weight:800; letter-spacing:1.5px; color:#38bdf8; text-transform:uppercase;">TECTUM ENGINEERING</div>
                    <div style="font-size:18px; font-weight:700; color:#ffffff; margin-top:2px;">Планнер Задач</div>
                  </td>
                  <td align="right" style="vertical-align:middle;">
                    <span style="display:inline-block; padding:4px 10px; background-color:{badge_bg}; color:{badge_color}; font-size:12px; font-weight:700; border-radius:6px;">
                      {badge_icon} {event_type}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding:28px 28px 20px 28px;">
              <div style="font-size:13px; color:#64748b; margin-bottom:6px;">{header_sub}</div>
              
              <!-- Task Title Card -->
              <div style="background-color:#f8fafc; border-left:4px solid #2563eb; border:1px solid #e2e8f0; border-left-width:4px; padding:16px; border-radius:8px; margin-bottom:20px;">
                <div style="font-size:11px; font-weight:700; color:#2563eb; font-family:monospace; margin-bottom:4px;">{code} • ЗОНА: {zone.upper()}</div>
                <div style="font-size:16px; font-weight:700; color:#0f172a; line-height:1.4;">{title}</div>
                {f'<div style="font-size:13.5px; color:#475569; margin-top:6px; font-style:italic;">{title_kz}</div>' if title_kz else ''}
              </div>

              <!-- Details Table -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:13.5px; margin-bottom:20px; line-height:1.5;">
                <tr>
                  <td style="padding:6px 0; color:#64748b; width:130px;">Срок выполнения:</td>
                  <td style="padding:6px 0; font-weight:700; color:#0f172a;">📅 {due_date}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0; color:#64748b;">Исполнитель:</td>
                  <td style="padding:6px 0; font-weight:600; color:#0f172a;">👤 {assignee}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0; color:#64748b;">Автор задачи:</td>
                  <td style="padding:6px 0; color:#334155;">✍️ {author}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0; color:#64748b;">Период:</td>
                  <td style="padding:6px 0; color:#334155;">🗓️ {month} / {week}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0; color:#64748b;">Текущий статус:</td>
                  <td style="padding:6px 0; font-weight:600;">{status}</td>
                </tr>
                {f'''<tr>
                  <td style="padding:6px 0; color:#64748b; vertical-align:top;">Факт / Результат:</td>
                  <td style="padding:6px 0; font-weight:600; color:#15803d; background-color:#f0fdf4; padding:8px 10px; border-radius:6px;">{comment}</td>
                </tr>''' if comment else ''}
                {f'''<tr>
                  <td style="padding:6px 0; color:#64748b;">Фото фиксация:</td>
                  <td style="padding:6px 0;"><a href="{photo}" target="_blank" style="color:#2563eb; text-decoration:underline; font-weight:600;">📷 Просмотреть в Google Фото</a></td>
                </tr>''' if photo else ''}
              </table>

              <!-- Call to Action Button -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:24px; margin-bottom:10px;">
                <tr>
                  <td align="center">
                    <a href="{PORTAL_URL}" target="_blank" style="display:inline-block; background-color:#2563eb; color:#ffffff; text-decoration:none; padding:12px 28px; border-radius:8px; font-size:14px; font-weight:700; box-shadow:0 2px 6px rgba(37,99,235,0.35);">
                      Открыть Планнер Задач ➔
                    </a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f8fafc; border-top:1px solid #e2e8f0; padding:14px 28px; text-align:center; font-size:11.5px; color:#94a3b8;">
              Это автоматическое уведомление системы Tectum Engineering. Пожалуйста, не отвечайте на это письмо.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""
    return html
