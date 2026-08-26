import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional, Dict, Any

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "").replace(" ", "")
SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "Tectum Планнер")
PORTAL_URL = os.getenv("PORTAL_URL", "https://tectum-portal-railway-production.up.railway.app/tasks")

def send_task_html_email(
    to_email: str,
    subject: str,
    event_type: str,
    task_data: Dict[str, Any]
) -> (bool, Optional[str]):
    """
    Отправляет красивое брендированное HTML-письмо с уведомлением по задаче через SMTP.
    Возвращает (успех: bool, текст_ошибки: Optional[str]).
    """
    if not to_email or "@" not in to_email:
        err = f"Некорректный email получателя: '{to_email}'"
        print(f"[Email Service] {err}")
        return False, err

    smtp_user = os.getenv("SMTP_USER", SMTP_USER)
    smtp_pass = os.getenv("SMTP_PASSWORD", SMTP_PASSWORD).replace(" ", "")
    smtp_host = os.getenv("SMTP_HOST", SMTP_HOST)
    smtp_port = int(os.getenv("SMTP_PORT", SMTP_PORT))
    from_name = os.getenv("SMTP_FROM_NAME", SMTP_FROM_NAME)

    if not smtp_user:
        err = "Переменная SMTP_USER не найдена в окружении Railway"
        print(f"[Email Service Warning] {err}")
        return False, err

    if not smtp_pass:
        err = "Переменная SMTP_PASSWORD не найдена в окружении Railway"
        print(f"[Email Service Warning] {err}")
        return False, err

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

        if smtp_port == 465:
            # SSL
            with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=15) as server:
                server.login(smtp_user, smtp_pass)
                server.sendmail(smtp_user, [to_email], msg.as_string())
        else:
            # STARTTLS (порт 587 по умолчанию)
            with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
                server.ehlo()
                server.starttls()
                server.ehlo()
                server.login(smtp_user, smtp_pass)
                server.sendmail(smtp_user, [to_email], msg.as_string())

        print(f"[Email Service Success] Письмо успешно отправлено на {to_email} (Событие: {event_type})")
        return True, None

    except Exception as e:
        err = f"Ошибка SMTP ({type(e).__name__}): {str(e)}"
        print(f"[Email Service Error] Ошибка отправки на {to_email}: {err}")
        return False, err



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
